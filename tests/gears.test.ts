import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import opencascade from 'replicad-opencascadejs';
import { loadFont, makeBaseBox, makeCylinder, measureVolume, setOC, type Shape3D } from 'replicad';
import { beforeAll, describe, expect, it } from 'vitest';
import { BUILDERS, loadedFonts, ParamError, type BuildResult, type Stage } from '../src/generators/build';
import { FONTS } from '../src/generators/fonts';
import { GENERATORS } from '../src/generators/meta';
import { defaults, fromTemplate, newItem, sanitize, type GeneratorId, type ListParam, type Params } from '../src/generators/types';
import { lithophaneMesh, type LithophaneParams } from '../src/generators/build/lithophane';
import { qrMatrix } from '../src/generators/build/qr';
import { areaOf, covers, distanceField, frameOf, gridRegions, sampleMask, traceBand, traceRegions } from '../src/generators/build/trace';
import { decodeImage, encodeImage, fromRgba, type Bitmap } from '../src/generators/image';
import { meshPart, vertexNormals, write3mf, writeStl, type WeldedMesh } from '../src/engine/export';
import { formatLength, parseLength, setUnit } from '../src/units';

beforeAll(async () => {
  const wasm = createRequire(import.meta.url).resolve('replicad-opencascadejs/wasm');
  const oc = await (opencascade as unknown as (o: object) => Promise<never>)({ wasmBinary: readFileSync(wasm) });
  setOC(oc);
  for (const font of FONTS) {
    const file = readFileSync(new URL(`../src/fonts/${font}.woff`, import.meta.url));
    await loadFont(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer, font);
    loadedFonts.add(font);
  }
}, 60_000);

function run(id: GeneratorId, overrides: Params = {}): { result: BuildResult; stages: Stage[] } {
  const gen = BUILDERS[id]({ ...defaults(GENERATORS[id]), ...overrides });
  const stages: Stage[] = [];
  for (;;) {
    const step = gen.next();
    if (step.done) return { result: step.value, stages };
    stages.push(step.value);
  }
}

const size = (s: Shape3D) => {
  const [[x0, y0, z0], [x1, y1, z1]] = s.boundingBox.bounds;
  return [x1 - x0, y1 - y0, z1 - z0];
};
const warnings = (r: BuildResult) => r.notes.filter((n) => n.level === 'warn').map((n) => n.key);

const opening = (o: Params): Params => ({ ...newItem(GENERATORS.enclosure.params.find((d) => d.key === 'openings') as ListParam), ...o });
const plain: Params = { openings: [], lidVent: 'none', bodyVent: 'none' };
const volumes = (overrides: Params) => run('enclosure', overrides).result.parts.map((part) => measureVolume(part.shape));

describe('gear', () => {
  const spurVolume = () => measureVolume(run('gear').result.parts[0].shape);

  it('builds an involute gear on its pitch circle', () => {
    const { result } = run('gear');
    const [gear] = result.parts;
    const [w, d, h] = size(gear.shape);
    // Module 1.5 × 20 teeth: pitch Ø 30, tips one module further out
    expect(w).toBeCloseTo(33, 1);
    expect(d).toBeGreaterThan(32.5);
    expect(h).toBeCloseTo(8, 3);
    expect(gear.shape.solids.length).toBe(1);
    const vol = measureVolume(gear.shape);
    const bore = Math.PI * 2.5 ** 2 * 8;
    expect(vol).toBeGreaterThan(Math.PI * 13.125 ** 2 * 8 - bore);
    expect(vol).toBeLessThan(Math.PI * 16.5 ** 2 * 8 - bore);
    expect(result.notes.find((n) => n.key === 'note.gearSize')?.vars).toMatchObject({ d: 30, o: 33 });
  });

  it('makes a second gear that meshes with the first', () => {
    const { result } = run('gear', { teeth: 16, teeth2: 32, bore: 'none' });
    const [first, second] = result.parts;
    expect(result.notes.find((n) => n.key === 'note.gearPair')?.vars).toMatchObject({ a: 36, i: 2 });
    // Laid out apart for printing …
    expect(measureVolume(first.shape.clone().intersect(second.shape.clone()))).toBeLessThan(0.01);
    // … and free of each other at the centre distance: teeth sit in gaps.
    const [dx] = second.assembled!.offset;
    const meshed = second.shape.clone().translate([dx, 0, 0]) as Shape3D;
    expect(meshed.boundingBox.center[0]).toBeCloseTo(36, 1);
    expect(measureVolume(first.shape.clone().intersect(meshed))).toBeLessThan(0.5);
    // Turned by half a tooth they would collide.
    const clash = meshed.clone().rotate(180 / 32, [36, 0, 0], [0, 0, 1]) as Shape3D;
    expect(measureVolume(first.shape.clone().intersect(clash))).toBeGreaterThan(20);
  });

  it('twists the teeth into a helix or a herringbone without changing their volume', () => {
    const straight = spurVolume();
    const helical = run('gear', { helix: 20 }).result.parts[0].shape;
    expect(measureVolume(helical)).toBeGreaterThan(straight * 0.985);
    expect(measureVolume(helical)).toBeLessThan(straight * 1.015);
    const herringbone = run('gear', { helix: 25, herringbone: true }).result.parts[0].shape;
    expect(herringbone.solids.length).toBe(1);
    expect(measureVolume(herringbone)).toBeGreaterThan(straight * 0.97);
    expect(measureVolume(herringbone)).toBeLessThan(straight * 1.03);
  });

  it('cuts the bore and adds a hub', () => {
    const solid = measureVolume(run('gear', { bore: 'none' }).result.parts[0].shape);
    const round = measureVolume(run('gear', { bore: 'round', boreDiameter: 6 }).result.parts[0].shape);
    const flat = measureVolume(run('gear', { bore: 'd', boreDiameter: 6, boreFlat: 1 }).result.parts[0].shape);
    const hex = measureVolume(run('gear', { bore: 'hex', boreDiameter: 6 }).result.parts[0].shape);
    expect(solid - round).toBeCloseTo(Math.PI * 9 * 8, 0);
    expect(flat).toBeGreaterThan(round + 5);
    expect(solid - hex).toBeCloseTo((Math.sqrt(3) / 2) * 36 * 8, 0);
    const hub = run('gear', { hubHeight: 6, hubDiameter: 14 }).result.parts[0].shape;
    expect(size(hub)[2]).toBeCloseTo(14, 2);
    expect(hub.solids.length).toBe(1);
    expect(() => run('gear', { boreDiameter: 40 })).toThrow(ParamError);
  });

  it('builds a rack with the same pitch', () => {
    const { result } = run('gear', { kind: 'rack', rackTeeth: 10, module: 2, rackHeight: 5, thickness: 6 });
    const [l, h, t] = size(result.parts[0].shape);
    expect(l).toBeCloseTo(10 * Math.PI * 2, 2);
    expect(h).toBeCloseTo(5 + 2.25 * 2, 2);
    expect(t).toBeCloseTo(6, 3);
  });

  it('cuts a ring gear from the inside', () => {
    const { result } = run('gear', { kind: 'ring', teeth: 40, module: 1.5, rim: 4 });
    const ring = result.parts[0].shape;
    expect(ring.solids.length).toBe(1);
    // Pitch Ø 60; the gaps reach 1.25 modules further out, then the rim
    expect(size(ring)[0]).toBeCloseTo(60 + 2 * 1.875 + 8, 1);
    expect(size(ring)[2]).toBeCloseTo(8, 3);
    const outer = Math.PI * 35.875 ** 2 * 8;
    expect(measureVolume(ring)).toBeGreaterThan(outer - Math.PI * 31.875 ** 2 * 8);
    expect(measureVolume(ring)).toBeLessThan(outer - Math.PI * 28.5 ** 2 * 8);
  });

  it('builds a planetary set whose gears mesh', () => {
    const { result } = run('gear', { kind: 'planetary', teeth: 14, planetTeeth: 13, planets: 3 });
    expect(result.parts.map((part) => part.name)).toEqual(['sun', 'planet', 'ring', 'carrier']);
    expect(result.notes.find((n) => n.key === 'note.planetary')?.vars).toMatchObject({ r: 40, i: 3.857 });
    const fitted = (name: string, k = 0, extra = 0): Shape3D => {
      const part = result.parts.find((candidate) => candidate.name === name)!;
      const [x, y, z, turn = 0] = part.assembled!.places?.[k] ?? part.assembled!.offset;
      return part.shape.clone().rotate(turn + extra, [0, 0, 0], [0, 0, 1]).translate([x, y, z]) as Shape3D;
    };
    for (let k = 0; k < 3; k++) {
      expect(measureVolume(fitted('sun').intersect(fitted('planet', k))), `sun/${k}`).toBeLessThan(0.3);
      expect(measureVolume(fitted('ring').intersect(fitted('planet', k))), `ring/${k}`).toBeLessThan(0.3);
    }
    expect(measureVolume(fitted('carrier').intersect(fitted('planet')))).toBeLessThan(0.01);
    // Half a tooth further round, a planet would run into both.
    expect(measureVolume(fitted('sun').intersect(fitted('planet', 1, 180 / 13)))).toBeGreaterThan(5);
    expect(measureVolume(fitted('ring').intersect(fitted('planet', 1, 180 / 13)))).toBeGreaterThan(5);
    // The planets are laid out side by side for printing, once in the file.
    expect(result.parts[1].instances).toHaveLength(3);
    expect(() => run('gear', { kind: 'planetary', teeth: 14, planetTeeth: 13, planets: 4 })).toThrow(ParamError);
    expect(() => run('gear', { kind: 'planetary', teeth: 8, planetTeeth: 40, planets: 6 })).toThrow(ParamError);
    expect(run('gear', { kind: 'planetary', teeth: 14, planetTeeth: 13, carrier: false }).result.parts).toHaveLength(3);
  });

  // A part where "Assembled" shows it: tipped over, then moved.
  const inMesh = (part: BuildResult['parts'][number], spin = 0): Shape3D => {
    const fit = part.assembled!;
    let shape = part.shape.clone() as Shape3D;
    const [[x0, y0], [x1, y1]] = shape.boundingBox.bounds;
    if (spin) shape = shape.rotate(spin, [(x0 + x1) / 2, (y0 + y1) / 2, 0], [0, 0, 1]) as Shape3D;
    if (fit.tilt) shape = shape.rotate(fit.tilt, [0, 0, 0], [0, 1, 0]) as Shape3D;
    return shape.translate(fit.offset) as Shape3D;
  };

  it('builds bevel gears whose cones share their tip', () => {
    const { result } = run('gear', { kind: 'bevel', module: 1.5, teeth: 16, teeth2: 24, thickness: 8, bore: 'none' });
    expect(warnings(result)).toEqual([]);
    const [a, b] = result.parts;
    expect(a.shape.solids.length).toBe(1);
    expect(b.shape.solids.length).toBe(1);
    const note = result.notes.find((n) => n.key === 'note.bevel')!.vars!;
    expect(note.a).toBeCloseTo(33.7, 1);
    expect(note.i).toBe(1.5);
    // The tip of each cone lies where the other gear's pitch circle is: 18 and 12 mm up.
    expect(note.h1).toBeCloseTo(18, 1);
    expect(note.h2).toBeCloseTo(12, 1);
    // Teeth taper towards the tip of the cone: the top is smaller than the bottom.
    const [w, , h] = size(a.shape);
    expect(w).toBeGreaterThan(24);
    expect(w).toBeLessThan(28.5);
    expect(h).toBeCloseTo(8 * Math.cos(Math.atan(16 / 24)), 2);
    expect(measureVolume(a.shape)).toBeLessThan(Math.PI * 12 ** 2 * h * 0.95);
    // Fitted, one lies on its side and they mesh; half a tooth on, they would collide.
    expect(b.assembled!.tilt).toBe(90);
    expect(measureVolume(inMesh(a).intersect(inMesh(b)))).toBeLessThan(0.05);
    expect(measureVolume(inMesh(a).intersect(inMesh(b, 180 / 24)))).toBeGreaterThan(5);
    const miter = run('gear', { kind: 'bevel', teeth: 20, teeth2: 0, bore: 'none' }).result.parts;
    expect(measureVolume(miter[0].shape)).toBeCloseTo(measureVolume(miter[1].shape), 0);
    expect(measureVolume(inMesh(miter[0]).intersect(inMesh(miter[1])))).toBeLessThan(0.3);
  });

  it('meshes bevel gears at other shaft angles and steep ratios', () => {
    for (const [shaftAngle, teeth, teeth2] of [[60, 16, 24], [120, 20, 20], [90, 16, 48], [105, 16, 24]]) {
      const { result } = run('gear', { kind: 'bevel', module: 1.5, teeth, teeth2, thickness: 8, shaftAngle, bore: 'none' });
      const [a, b] = result.parts;
      const label = `${shaftAngle}° ${teeth}/${teeth2}`;
      const vars = result.notes.find((n) => n.key === 'note.bevel')!.vars!;
      // The two cone angles make up the angle between the axes.
      expect((vars.a as number) + (vars.b as number), label).toBeCloseTo(shaftAngle, 0);
      expect(b.assembled!.tilt, label).toBe(shaftAngle);
      expect(measureVolume(inMesh(a).intersect(inMesh(b))), label).toBeLessThan(0.05);
      expect(measureVolume(inMesh(a).intersect(inMesh(b, 180 / teeth2))), label).toBeGreaterThan(2);
    }
    // One gear nearly flat, its teeth pointing along the axis: that is not what this builds.
    expect(() => run('gear', { kind: 'bevel', teeth: 12, teeth2: 60, shaftAngle: 135 })).toThrow(ParamError);
  });

  it('builds a GT2 belt pulley', () => {
    const { result } = run('gear', { kind: 'pulley', teeth: 20, beltWidth: 6, flanges: 'both', bore: 'round', boreDiameter: 5 });
    const pulley = result.parts[0].shape;
    expect(pulley.solids.length).toBe(1);
    // 20 teeth of 2 mm pitch: pitch Ø 12.73, the rim 0.254 mm inside it all round, flanges 1.2 mm beyond
    const outer = 40 / Math.PI - 0.508;
    expect(result.notes.find((n) => n.key === 'note.pulley')?.vars).toMatchObject({ n: 20, d: 12.73, o: 12.22 });
    const [w, , h] = size(pulley);
    expect(w).toBeCloseTo(outer + 2.4, 1);
    expect(h).toBeCloseTo(1 + 7 + 1.5, 3);
    const bare = run('gear', { kind: 'pulley', teeth: 20, beltWidth: 6, flanges: 'none', bore: 'none' }).result.parts[0].shape;
    // A groove faces each way along X, so the widest it measures is across the edges of two grooves.
    expect(size(bare)[0]).toBeGreaterThan(outer - 0.12);
    expect(size(bare)[0]).toBeLessThanOrEqual(outer + 0.001);
    expect(size(bare)[2]).toBeCloseTo(7, 1);
    // Twenty grooves 0.8 mm deep: between the full rim and a disc at their bottom
    expect(measureVolume(bare)).toBeLessThan(Math.PI * (outer / 2) ** 2 * 7.2 * 0.95);
    expect(measureVolume(bare)).toBeGreaterThan(Math.PI * (outer / 2 - 0.8) ** 2 * 7.2);
    // A belt tooth sits in a groove; between grooves there is rim.
    const probe = (angle: number) => measureVolume(bare.clone().intersect((makeBaseBox(0.2, 0.2, 2) as Shape3D).translate([-0.1 + (outer / 2 - 0.4) * Math.cos(angle), -0.1 + (outer / 2 - 0.4) * Math.sin(angle), 2])));
    expect(probe(0)).toBeLessThan(0.001);
    expect(probe(Math.PI / 20)).toBeCloseTo(0.08, 2);
    expect(run('gear', { kind: 'pulley', teeth: 20, hubHeight: 6, hubDiameter: 12, flanges: 'both' }).result.parts[0].shape.solids.length).toBe(1);
    expect(() => run('gear', { kind: 'pulley', teeth: 10, boreDiameter: 8 })).toThrow(ParamError);
  });

  it('builds a worm that drives its wheel', () => {
    const { result } = run('gear', { kind: 'worm', module: 1.5, teeth: 30, wormStarts: 1, wormDiameter: 16, wormLength: 30, thickness: 10, pressureAngle: '25', backlash: 0.15, bore: 'round', boreDiameter: 5 });
    expect(result.parts.map((part) => part.name)).toEqual(['wheel', 'worm']);
    const [wheel, worm] = result.parts;
    expect(wheel.shape.solids.length).toBe(1);
    expect(worm.shape.solids.length).toBe(1);
    expect(result.notes.find((n) => n.key === 'note.worm')?.vars).toMatchObject({ a: 30.5, i: 30 });
    // Pitch Ø 16, tips a module further out, standing 30 mm tall
    const [w, , h] = size(worm.shape);
    expect(w).toBeGreaterThan(18.5);
    expect(w).toBeLessThanOrEqual(19.01);
    expect(h).toBeCloseTo(30, 3);
    // One turn of thread per 4.71 mm: between the cylinders of root and tip
    expect(measureVolume(worm.shape)).toBeGreaterThan(Math.PI * (6.125 ** 2 - 2.5 ** 2) * 30);
    expect(measureVolume(worm.shape)).toBeLessThan(Math.PI * 9.5 ** 2 * 30);
    // Fitted, the worm lies across in front of the wheel. Where they meet, a tooth of the wheel
    // sits in a gap of the worm, with thread to either side of it. (Small probes at the pitch
    // point stand in for intersecting the two, which takes the kernel a minute.)
    expect(worm.assembled!.tilt).toBe(90);
    const probe = (x: number) => (makeBaseBox(0.3, 0.3, 0.3) as Shape3D).translate([x - 0.15, -30.5 + 8 - 0.15, 5 - 0.15]) as Shape3D;
    const pitch = Math.PI * 1.5;
    const [meshedWheel, meshedWorm] = [inMesh(wheel), inMesh(worm)];
    expect(measureVolume(meshedWheel.clone().intersect(probe(0)))).toBeCloseTo(0.027, 3);
    expect(measureVolume(meshedWorm.clone().intersect(probe(0)))).toBeLessThan(0.0001);
    for (const x of [pitch / 2, -pitch / 2]) expect(measureVolume(meshedWheel.clone().intersect(probe(x))), String(x)).toBeLessThan(0.0001);
    expect(measureVolume(meshedWorm.clone().intersect(probe(pitch / 2)))).toBeCloseTo(0.027, 3);
    expect(() => run('gear', { kind: 'worm', module: 3, wormDiameter: 8 })).toThrow(ParamError);
    expect(run('gear', { kind: 'worm', wormStarts: 2, teeth: 30 }).result.notes.find((n) => n.key === 'note.worm')?.vars).toMatchObject({ i: 15 });
  }, 180_000);

  it('builds every gear template cleanly', () => {
    for (const name of Object.keys(GENERATORS.gear.templates!)) {
      const { result } = run('gear', fromTemplate(GENERATORS.gear, name));
      expect(warnings(result), name).toEqual([]);
      for (const part of result.parts) expect(part.shape.solids.length, name).toBe(1);
    }
  });
});
