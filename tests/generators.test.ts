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

describe('enclosure', () => {
  it('builds body and lid with the requested outer size', () => {
    const { result, stages } = run('enclosure');
    const [body, lid] = result.parts;
    const [l, w, h] = size(body.shape);
    expect(l).toBeCloseTo(120, 1);
    expect(w).toBeCloseTo(80, 1);
    expect(h).toBeCloseTo(33, 1);
    expect(size(lid.shape)[2]).toBeCloseTo(5, 1);
    expect(lid.shape.boundingBox.bounds[0][2]).toBeCloseTo(0, 3);
    expect(stages.length).toBeGreaterThanOrEqual(4);
    expect(warnings(result)).toEqual([]);
    // Floor ~19 cm³ + walls ~24 cm³ + corner posts and standoffs ~5 cm³
    const vol = measureVolume(body.shape);
    expect(vol).toBeGreaterThan(43_000);
    expect(vol).toBeLessThan(50_000);
    expect(body.shape.solids.length).toBe(1);
    expect(lid.shape.solids.length).toBe(1);
  });

  it('cuts a port through the chosen wall', () => {
    const [closed] = volumes(plain);
    for (const face of ['front', 'back', 'left', 'right']) {
      const [open] = volumes({ ...plain, openings: [opening({ type: 'usbc', face, height: 8.2 })] });
      // 9.4 × 3.6 mm slot through a 2 mm wall, minus rounded corners
      expect(closed - open).toBeGreaterThan(55);
      expect(closed - open).toBeLessThan(70);
    }
  });

  it('places wall openings to the right as seen from outside', () => {
    const at = (face: string) => {
      const { result } = run('enclosure', { ...plain, pcb: false, lidFix: 'none', openings: [opening({ type: 'round', face, diameter: 6, offset: 20 })] });
      const solid = run('enclosure', { ...plain, pcb: false, lidFix: 'none' }).result.parts[0].shape;
      const plug = solid.cut(result.parts[0].shape) as Shape3D;
      const [[x0, y0], [x1, y1]] = plug.boundingBox.bounds;
      return [(x0 + x1) / 2, (y0 + y1) / 2];
    };
    expect(at('front')[0]).toBeCloseTo(20, 1);
    expect(at('back')[0]).toBeCloseTo(-20, 1);
    expect(at('right')[1]).toBeCloseTo(20, 1);
    expect(at('left')[1]).toBeCloseTo(-20, 1);
  });

  it('opens lid and floor, and several openings add up', () => {
    const [body0, lid0] = volumes(plain);
    const [body1, lid1] = volumes({
      ...plain,
      openings: [
        opening({ type: 'round', face: 'lid', preset: 'sma', offset: 30 }),
        opening({ type: 'round', face: 'floor', diameter: 10, offset: -30, offsetY: 20 }),
        opening({ type: 'rect', face: 'back', width: 20, rectHeight: 10 }),
      ],
    });
    expect(lid0 - lid1).toBeCloseTo(Math.PI * 3.25 ** 2 * 2, -1);
    expect(body0 - body1).toBeCloseTo(Math.PI * 25 * 2 + 20 * 10 * 2, -1);
  });

  it('mirrors lid openings so they line up once the lid is flipped over', () => {
    const { result } = run('enclosure', { ...plain, openings: [opening({ type: 'round', face: 'lid', diameter: 10, offset: 30 })] });
    const flat = run('enclosure', plain).result.parts[1].shape;
    const plug = flat.cut(result.parts[1].shape) as Shape3D;
    const [[x0], [x1]] = plug.boundingBox.bounds;
    const centre = (flat.boundingBox.bounds[0][0] + flat.boundingBox.bounds[1][0]) / 2;
    expect((x0 + x1) / 2 - centre).toBeCloseTo(-30, 1);
  });

  it('fits a speaker with grille and locating ring, and a fan', () => {
    const [, lid0] = volumes(plain);
    const { result } = run('enclosure', { ...plain, openings: [opening({ type: 'speaker', face: 'lid', speaker: '40' })] });
    expect(warnings(result)).toEqual([]);
    const lid = result.parts[1].shape;
    expect(lid.solids.length).toBe(1);
    expect(size(lid)[2]).toBeCloseTo(5, 1);
    const open = volumes({ ...plain, openings: [opening({ type: 'speaker', face: 'lid', speaker: '40', grille: 'open', ring: false })] })[1];
    expect(lid0 - open).toBeCloseTo(Math.PI * 17 ** 2 * 2, -2);
    const fan = volumes({ ...plain, openings: [opening({ type: 'fan', face: 'lid', fan: '40', grille: 'open' })] })[1];
    expect(lid0 - fan).toBeGreaterThan(2200);
    // Every guard pattern lets air through but keeps more material than the open cutout.
    for (const pattern of ['holes', 'hex', 'grid', 'slots', 'triangles']) {
      const guarded = run('enclosure', { ...plain, openings: [opening({ type: 'fan', face: 'lid', fan: '40', grille: pattern })] });
      expect(warnings(guarded.result), pattern).toEqual([]);
      const vol = measureVolume(guarded.result.parts[1].shape);
      expect(vol, pattern).toBeLessThan(lid0 - 400);
      expect(vol, pattern).toBeGreaterThan(fan + 300);
      expect(guarded.result.parts[1].shape.solids.length).toBe(1);
    }
    const wallFan = run('enclosure', { ...plain, height: 60, pcb: false, openings: [opening({ type: 'fan', face: 'back', fan: '40', height: 26 })] });
    expect(warnings(wallFan.result)).toEqual([]);
  });

  it('cuts every vent pattern into lid, walls and floor', () => {
    const [body0, lid0] = volumes(plain);
    for (const pattern of ['slots', 'holes', 'hex', 'triangles', 'grid']) {
      const sized = { lidVentSize: 4, bodyVentSize: 4 };
      const { result } = run('enclosure', { ...plain, ...sized, lidVent: pattern, bodyVent: pattern, bodyVentWalls: 'all' });
      expect(warnings(result)).toEqual([]);
      expect(measureVolume(result.parts[0].shape)).toBeLessThan(body0 - 100);
      expect(measureVolume(result.parts[1].shape)).toBeLessThan(lid0 - 100);
      expect(result.parts[0].shape.solids.length).toBe(1);
      expect(result.parts[1].shape.solids.length).toBe(1);
    }
    const floorOnly = volumes({ ...plain, bodyVent: 'hex', bodyVentWalls: 'none', bodyVentFloor: true, bodyVentSize: 5 })[0];
    const wallsOnly = volumes({ ...plain, bodyVent: 'hex', bodyVentWalls: 'sides', bodyVentSize: 5 })[0];
    const both = volumes({ ...plain, bodyVent: 'hex', bodyVentWalls: 'sides', bodyVentFloor: true, bodyVentSize: 5 })[0];
    expect(floorOnly).toBeLessThan(body0 - 100);
    expect(wallsOnly).toBeLessThan(body0 - 100);
    // Walls and floor are chosen independently and add up.
    expect(body0 - both).toBeCloseTo(body0 - floorOnly + (body0 - wallsOnly), 0);
    // Lid and body are independent.
    const [body, lid] = volumes({ ...plain, lidVent: 'holes' });
    expect(body).toBeCloseTo(body0, 3);
    expect(lid).toBeLessThan(lid0 - 50);
  });

  it('sizes PCB and lid screws independently, with inserts and recessed heads', () => {
    const base = volumes(plain);
    const pcbM2 = volumes({ ...plain, pcbScrew: 'M2' });
    expect(pcbM2[0]).not.toBeCloseTo(base[0], 0);
    expect(pcbM2[1]).toBeCloseTo(base[1], 3);
    const lidM4 = volumes({ ...plain, lidScrew: 'M4' });
    expect(lidM4[1]).toBeLessThan(base[1] - 5);

    const sunk = run('enclosure', { ...plain, lidHead: 'countersunk' });
    expect(warnings(sunk.result)).toEqual([]);
    // Four cones from Ø 3.4 to Ø 6.4, 1.5 mm deep, minus the through hole: 15.55 mm³ each
    expect(base[1] - measureVolume(sunk.result.parts[1].shape)).toBeCloseTo(4 * 15.55, 0);
    expect(warnings(run('enclosure', { ...plain, lidHead: 'counterbore' }).result)).toContain('note.lidTooThin');
    expect(warnings(run('enclosure', { ...plain, lidHead: 'counterbore', lidThickness: 4.5 }).result)).toEqual([]);

    const inserts = run('enclosure', { ...plain, lidHole: 'insert', pcbHole: 'insert', standoffHeight: 6 });
    expect(warnings(inserts.result)).toEqual([]);
    expect(inserts.result.notes.map((n) => n.key)).toEqual(expect.arrayContaining(['note.lidScrews.insert', 'note.pcbScrews.insert']));
    expect(warnings(run('enclosure', { ...plain, pcbHole: 'insert', standoffHeight: 2 }).result)).toContain('note.standoffShort');
  });

  it('snaps the lid on instead of screwing it', () => {
    const none = run('enclosure', { ...plain, lidFix: 'none' }).result.parts;
    const { result } = run('enclosure', { ...plain, lidFix: 'snap' });
    expect(warnings(result)).toEqual([]);
    expect(result.notes.map((n) => n.key)).toContain('note.snaps');
    const [body, lid] = result.parts;
    expect(measureVolume(body.shape)).toBeLessThan(measureVolume(none[0].shape) - 5); // grooves
    expect(size(lid.shape)[2]).toBeCloseTo(8, 1); // taller lip
    expect(lid.shape.solids.length).toBe(1);
    // The noses reach past the lip into the wall, but stay inside the outline.
    expect(size(lid.shape)[0]).toBeCloseTo(120, 1);
    expect(warnings(run('enclosure', { ...plain, lidFix: 'snap', wall: 0.8 }).result)).toContain('note.noRoomSnaps');
  });

  it('builds round and polygonal enclosures', () => {
    const round = run('enclosure', { shape: 'round', diameter: 100, pcbLength: 60, pcbWidth: 40, bodyVent: 'slots', bodyVentWalls: 'all' });
    expect(warnings(round.result)).toEqual([]);
    expect(size(round.result.parts[0].shape)[0]).toBeCloseTo(100, 1);
    expect(size(round.result.parts[1].shape)[1]).toBeCloseTo(100, 1);
    expect(round.result.parts[0].shape.solids.length).toBe(1);

    for (const sides of [3, 4, 5, 6, 8, 12]) {
      for (const lidFix of ['screws', 'snap']) {
        const { result } = run('enclosure', { shape: 'polygon', sides, diameter: 140, pcbLength: 40, pcbWidth: 30, lidFix, bodyVent: 'holes', bodyVentWalls: 'all', ears: 'two' });
        expect(warnings(result), `${sides} sides, ${lidFix}`).toEqual([]);
        expect(result.parts[0].shape.solids.length).toBe(1);
        expect(result.parts[1].shape.solids.length).toBe(1);
      }
    }
    // A flat faces the front, so a front opening goes straight through it.
    const tri = { ...plain, shape: 'polygon', sides: 3, diameter: 140, pcb: false, cornerRadius: 0 };
    const [closed] = volumes(tri);
    const [open] = volumes({ ...tri, openings: [opening({ type: 'round', face: 'front', diameter: 10 })] });
    expect(closed - open).toBeCloseTo(Math.PI * 25 * 2, 0);
  });

  it('adds mounting ears and cable gland threads', () => {
    const [w0] = size(run('enclosure', plain).result.parts[0].shape);
    const eared = run('enclosure', { ...plain, ears: 'four' }).result.parts[0].shape;
    expect(size(eared)[0]).toBeGreaterThan(w0 + 20);
    expect(eared.solids.length).toBe(1);
    // Ears stay outside: the interior is as empty as without them.
    const interior = () => makeBaseBox(116 - 0.2, 76 - 0.2, 3).translate(0, 0, 2.1) as Shape3D;
    const bare = run('enclosure', { ...plain, pcb: false, lidFix: 'none' }).result.parts[0].shape;
    const withEars = run('enclosure', { ...plain, pcb: false, lidFix: 'none', ears: 'four' }).result.parts[0].shape;
    expect(measureVolume(withEars.intersect(interior()) as Shape3D)).toBeCloseTo(measureVolume(bare.intersect(interior()) as Shape3D), 3);
    // Side, spacing and offset are free.
    const front = run('enclosure', { ...plain, ears: 'four', earSides: 'frontback', earSpacing: 40, earOffset: 15 }).result.parts[0].shape;
    expect(size(front)[0]).toBeCloseTo(120, 1);
    expect(size(front)[1]).toBeGreaterThan(80 + 20);

    const hole = volumes({ ...plain, openings: [opening({ type: 'gland', thread: 'PG9', height: 15 })] })[0];
    const { result } = run('enclosure', { ...plain, openings: [opening({ type: 'gland', thread: 'PG9', height: 15, printThread: true })] });
    expect(warnings(result)).toEqual([]);
    expect(result.parts[0].shape.solids.length).toBe(1);
    // The thread leaves more material than the clearance hole and adds a boss inside.
    expect(measureVolume(result.parts[0].shape)).toBeGreaterThan(hole + 100);
    expect(run('enclosure', { ...plain, openings: [opening({ type: 'gland', face: 'lid', thread: 'M16', printThread: true })] }).result.parts[1].shape.solids.length).toBe(1);
  }, 60_000);

  it('works without a lid', () => {
    const { result } = run('enclosure', { lid: false, openings: [opening({ type: 'round', face: 'lid' })] });
    expect(result.parts).toHaveLength(1);
    expect(size(result.parts[0].shape)[2]).toBeCloseTo(35, 1);
    expect(warnings(result)).toEqual([]);
  });

  it('hinges the lid on the back wall', () => {
    const { result } = run('enclosure', { ...plain, lidFix: 'snap', hinge: true });
    expect(warnings(result)).toEqual([]);
    const [body, lid] = result.parts;
    expect(body.shape.solids.length).toBe(1);
    expect(lid.shape.solids.length).toBe(1);
    // Knuckles stick out behind the back wall only, on both parts.
    expect(body.shape.boundingBox.bounds[0][1]).toBeCloseTo(-40, 1);
    expect(body.shape.boundingBox.bounds[1][1]).toBeGreaterThan(45);
    expect(lid.shape.boundingBox.bounds[1][1]).toBeCloseTo(body.shape.boundingBox.bounds[1][1], 1);
    expect(lid.shape.boundingBox.bounds[0][2]).toBeCloseTo(0, 3);
    expect(lid.assembled).toBeDefined();
    expect(result.notes.find((n) => n.key === 'note.snaps')!.vars!.n).toBe(1); // only opposite the hinge
    expect(warnings(run('enclosure', { shape: 'round', hinge: true }).result)).toContain('note.needsFlatBack');
  });

  it('adds a gasket groove, a DIN rail clip and a twist lock', () => {
    const [body0] = volumes({ ...plain, wall: 3 });
    const sealed = run('enclosure', { ...plain, wall: 3, gasket: true });
    expect(warnings(sealed.result)).toEqual([]);
    expect(measureVolume(sealed.result.parts[0].shape)).toBeLessThan(body0 - 300);
    expect(sealed.result.parts[0].shape.solids.length).toBe(1);
    expect(warnings(run('enclosure', { ...plain, gasket: true, gasketWidth: 2 }).result)).toContain('note.noRoomGasket');

    const clipped = run('enclosure', { ...plain, din: 'back' }).result.parts[0].shape;
    expect(clipped.solids.length).toBe(1);
    expect(clipped.boundingBox.bounds[1][1]).toBeCloseTo(44.4, 1);
    const left = run('enclosure', { ...plain, din: 'left', dinOffset: 10 }).result.parts[0].shape;
    expect(left.boundingBox.bounds[0][0]).toBeCloseTo(-64.4, 1);
    expect(left.boundingBox.bounds[1][1]).toBeCloseTo(40, 1);
    // Under the floor the clip lifts the body, and the assembled lid follows.
    const under = run('enclosure', { ...plain, din: 'floor' }).result.parts;
    expect(under[0].shape.solids.length).toBe(1);
    expect(under[0].shape.boundingBox.bounds[0][2]).toBeCloseTo(0, 1);
    expect(size(under[0].shape)[2]).toBeCloseTo(33 + 4.4, 1);
    expect(under[1].assembled!.offset[2]).toBeCloseTo(35 + 4.4, 5);
    expect(warnings(run('enclosure', { shape: 'round', din: 'back' }).result)).toContain('note.needsFlatWall');

    const twist = run('enclosure', { ...plain, shape: 'round', diameter: 80, pcb: false, lidFix: 'twist' });
    expect(warnings(twist.result)).toEqual([]);
    expect(twist.result.parts[0].shape.solids.length).toBe(1);
    expect(twist.result.parts[1].shape.solids.length).toBe(1);
    const loose = volumes({ ...plain, shape: 'round', diameter: 80, pcb: false, lidFix: 'none' });
    expect(measureVolume(twist.result.parts[0].shape)).toBeLessThan(loose[0] - 50);
    expect(warnings(run('enclosure', { lidFix: 'twist' }).result)).toContain('note.twistRoundOnly');
  });

  it('builds every template cleanly', () => {
    for (const name of Object.keys(GENERATORS.enclosure.templates!)) {
      const gen = BUILDERS.enclosure(fromTemplate(GENERATORS.enclosure, name));
      let step = gen.next();
      while (!step.done) step = gen.next();
      expect(warnings(step.value), name).toEqual([]);
      for (const part of step.value.parts) expect(part.shape.solids.length, `${name} ${part.name}`).toBe(1);
    }
  }, 120_000);

  it('puts standoffs on the hole pattern of a known board', () => {
    const bare = volumes({ ...plain, pcb: false, length: 140 })[0];
    const uno = volumes({ ...plain, pcbBoard: 'uno', length: 140 })[0];
    const mega = volumes({ ...plain, pcbBoard: 'mega', length: 140 })[0];
    const post = (uno - bare) / 4;
    expect(post).toBeGreaterThan(80);
    expect(mega - bare).toBeCloseTo(6 * post, 0);
  });

  it('survives extreme parameters', () => {
    run('enclosure', { length: 20, width: 20, height: 10, wall: 6, cornerRadius: 30 });
    run('enclosure', { cornerRadius: 0, lidFix: 'none', pcb: false, lidVent: 'triangles', bodyVent: 'grid' });
    run('enclosure', { shape: 'round', diameter: 20, height: 10 });
    run('enclosure', { shape: 'polygon', sides: 3, diameter: 20, height: 10, cornerRadius: 60 });
    expect(warnings(run('enclosure', { pcbLength: 200 }).result)).toContain('note.pcbTooLarge');
    expect(warnings(run('enclosure', { openings: [opening({ type: 'usbc', height: 40 })] }).result)).toContain('note.portOutside');
  });
});

describe('enclosure lid text', () => {
  const lidVolume = (overrides: Params) => measureVolume(run('enclosure', { ...plain, ...overrides }).result.parts[1].shape);

  it('engraves text into the lid, never through it', () => {
    const blank = lidVolume({});
    const shallow = blank - lidVolume({ lidText: 'ON' });
    const deep = blank - lidVolume({ lidText: 'ON', lidTextDepth: 5 });
    expect(shallow).toBeGreaterThan(5);
    expect(deep / shallow).toBeCloseTo(1.6 / 0.6, 1); // limited to the lid thickness less 0.4 mm
    const { result } = run('enclosure', { ...plain, lidText: 'ON', lidTextDepth: 5 });
    expect(result.parts[1].shape.solids.length).toBe(1);
  });

  it('raises text and keeps the lid on the bed', () => {
    const { result } = run('enclosure', { ...plain, lidText: 'Power\nSupply', lidTextStyle: 'raised', lidTextDepth: 1, lidTextTurn: '90', lidTextFont: 'oswald' });
    const lid = result.parts[1].shape;
    expect(lid.boundingBox.bounds[0][2]).toBeCloseTo(0, 3);
    expect(measureVolume(lid)).toBeGreaterThan(lidVolume({}) + 20);
    expect(result.notes.map((n) => n.key)).toContain('note.lidTextRaised');
  });
});

describe('adapter', () => {

  it('builds a straight reducer', () => {
    const { result } = run('adapter', { barbs2: false });
    const [l, w, h] = size(result.parts[0].shape);
    // end 1 slides over 32 mm: OD = 32 + 0.3 + 2·2; end 2 plugs into 40 mm: OD = 39.7
    expect(l).toBeCloseTo(39.7, 1);
    expect(w).toBeCloseTo(39.7, 1);
    expect(h).toBeCloseTo(60, 1);
    expect(measureVolume(result.parts[0].shape)).toBeGreaterThan(10_000);
  });

  it('adds barbs', () => {
    const plain = measureVolume(run('adapter', { barbs2: false }).result.parts[0].shape);
    const barbed = measureVolume(run('adapter', { barbs2: true }).result.parts[0].shape);
    expect(barbed).toBeGreaterThan(plain + 100);
  });

  it('bends into one connected solid', () => {
    const straight = measureVolume(run('adapter', { barbs2: false }).result.parts[0].shape);
    const shape = run('adapter', { barbs2: false, angle: 45 }).result.parts[0].shape;
    const [[x0], [x1]] = shape.boundingBox.bounds;
    expect(x1).toBeGreaterThan(-x0 + 10); // leans towards +X
    expect(measureVolume(shape)).toBeGreaterThan(straight * 1.2);
    expect(shape.solids.length).toBe(1);
  });

  it('stretches steep transitions and rejects a closed bore', () => {
    const { result } = run('adapter', { d1: 10, d2: 100, transition: 0 });
    expect(result.notes.map((n) => n.key)).toContain('note.transitionStretched');
    expect(() => run('adapter', { d1: 3, fit1: 'inside', wall: 3 })).toThrow(ParamError);
  });

  it('keeps the entered diameter as the mating surface, whatever the wall', () => {
    for (const wall of [1, 2, 6]) {
      const end = (n: number) => run('adapter', { wall, chamfer: 0 }).result.notes.find((note) => note.key.startsWith('note.adapterEnd') && note.vars?.n === n)!.vars!;
      expect(end(1).id).toBeCloseTo(32.3, 5); // slides over 32 mm: the bore stays
      expect(end(1).od).toBeCloseTo(32.3 + 2 * wall, 5);
      expect(end(2).od).toBeCloseTo(39.7, 5); // plugs into 40 mm: the outside stays
      expect(end(2).id).toBeCloseTo(39.7 - 2 * wall, 5);
    }
  });

  it('adds a flange and adjustable barbs', () => {
    const plainVol = measureVolume(run('adapter', { barbs2: false }).result.parts[0].shape);
    const flanged = run('adapter', { barbs2: false, flange: 'end1', flangeHoles: 0 }).result.parts[0].shape;
    expect(size(flanged)[0]).toBeCloseTo(70, 1);
    expect(flanged.solids.length).toBe(1);
    // A 4 mm ring from Ø 36.3 (minus the lead-in chamfer it replaces) to Ø 70
    expect(measureVolume(flanged) - plainVol).toBeCloseTo((Math.PI / 4) * (70 ** 2 - 36.3 ** 2) * 4, -2);
    const drilled = run('adapter', { barbs2: false, flange: 'end1', flangeHoles: 4 });
    expect(warnings(drilled.result)).toEqual([]);
    expect(measureVolume(flanged) - measureVolume(drilled.result.parts[0].shape)).toBeCloseTo(4 * Math.PI * 2.25 ** 2 * 4, 0);
    expect(run('adapter', { flange: 'between', angle: 45 }).result.parts[0].shape.solids.length).toBe(1);
    expect(warnings(run('adapter', { flange: 'end1', flangeDiameter: 40 }).result)).toContain('note.flangeNoRoomHoles');

    const two = run('adapter', { barbCount2: 2 });
    const five = run('adapter', { barbCount2: 5 });
    expect(measureVolume(five.result.parts[0].shape)).toBeGreaterThan(measureVolume(two.result.parts[0].shape) + 100);
    const tall = run('adapter', { barbHeight2: 2 });
    const note = tall.result.notes.find((n) => n.key === 'note.barbs')!.vars!;
    expect(note.d).toBeCloseTo(39.7, 5); // the sleeve itself keeps the entered fit
    expect(note.peak).toBeCloseTo(43.7, 5);
    expect(size(tall.result.parts[0].shape)[0]).toBeCloseTo(43.7, 1);
  });

  it('sets barbs on both ends independently', () => {
    const { result } = run('adapter', { fit1: 'inside', barbs1: true, barbCount1: 2, barbHeight1: 1.5, barbCount2: 5 });
    const [one, other] = result.notes.filter((n) => n.key === 'note.barbs').map((n) => n.vars!);
    expect([one.count, other.count]).toEqual([2, 5]);
    expect(one.peak).toBeCloseTo(31.7 + 3, 5);
    expect(other.peak).toBeCloseTo(39.7 + 1.6, 5);
  });

  it('uses standard sizes and cuts G threads', () => {
    const hose = run('adapter', { std1: 'hose13', barbs1: true, std2: 'ht50' }).result;
    const ends = hose.notes.filter((n) => n.key.startsWith('note.adapterEnd'));
    expect(ends.map((n) => n.key)).toEqual(['note.adapterEnd.inside', 'note.adapterEnd.over']);
    expect(ends[0].vars!.od).toBeCloseTo(12.7, 5);
    expect(ends[1].vars!.id).toBeCloseTo(50.3, 5);

    const male = run('adapter', { std1: 'g34m', len1: 14, std2: 'hose13', chamfer: 0, clearance: 0, barbs2: false });
    const shape = male.result.parts[0].shape;
    expect(shape.solids.length).toBe(1);
    expect(size(shape)[0]).toBeCloseTo(26.14, 1); // crests reach the major diameter
    // More than a sleeve at the root diameter, less than one at the crest diameter
    const ring = (od: number) => (Math.PI / 4) * (od ** 2 - (26.14 - 2 * 0.98 - 4) ** 2) * 14;
    const rest = measureVolume(run('adapter', { std1: 'hose13', len1: 1, std2: 'hose13', chamfer: 0, clearance: 0, barbs2: false, transition: 0 }).result.parts[0].shape);
    expect(measureVolume(shape)).toBeGreaterThan(ring(26.14 - 2 * 0.98) + rest / 2);
    expect(measureVolume(shape)).toBeLessThan(ring(26.14) + 2 * rest + 2000);
    expect(male.result.notes.map((n) => n.key)).toContain('note.adapterEnd.male');

    const female = run('adapter', { std1: 'g12f', len1: 14, std2: 'g34m', len2: 14, wall: 3 });
    expect(female.result.parts[0].shape.solids.length).toBe(1);
    expect(run('adapter', { std1: 'g34f', std2: 'g34m', angle: 90 }).result.parts[0].shape.solids.length).toBe(1);
  });

  it('builds every adapter template cleanly', () => {
    for (const name of Object.keys(GENERATORS.adapter.templates!)) {
      const { result } = run('adapter', fromTemplate(GENERATORS.adapter, name));
      expect(warnings(result), name).toEqual([]);
      expect(result.parts[0].shape.solids.length, name).toBe(1);
    }
  });

  it('chamfers the open ends and bends up to 180°', () => {
    const sharp = measureVolume(run('adapter', { chamfer: 0 }).result.parts[0].shape);
    const eased = run('adapter', { chamfer: 1 }).result.parts[0].shape;
    expect(sharp - measureVolume(eased)).toBeGreaterThan(50);
    expect(size(eased)[2]).toBeCloseTo(60, 1);
    const u = run('adapter', { angle: 180, wall: 12, d1: 60, d2: 80 }).result.parts[0].shape;
    expect(u.solids.length).toBe(1);
  });
});

describe('organizer', () => {
  it('fills the drawer with equal boxes', () => {
    const { result } = run('organizer');
    const part = result.parts[0];
    expect(part.instances).toHaveLength(12);
    const [w, d, h] = size(part.shape);
    expect(w).toBeCloseTo(287 / 3 - 0.5, 1);
    expect(d).toBeCloseTo(410 / 4 - 0.5, 1);
    expect(h).toBeCloseTo(40, 1);
    expect(result.frame).toEqual([287, 410]);
  });

  it('adds dividers', () => {
    const plain = measureVolume(run('organizer').result.parts[0].shape);
    const divided = measureVolume(run('organizer', { dividersX: 2, dividersY: 1 }).result.parts[0].shape);
    expect(divided).toBeGreaterThan(plain + 5_000);
  });

  it('lowers dividers, drains the floor, notches the rim and adds a label ledge', () => {
    const plainBox = measureVolume(run('organizer').result.parts[0].shape);
    const full = measureVolume(run('organizer', { dividersX: 2 }).result.parts[0].shape);
    const low = measureVolume(run('organizer', { dividersX: 2, dividerDrop: 20 }).result.parts[0].shape);
    expect(low).toBeLessThan(full - 2_000);
    for (const drain of ['holes', 'slots', 'hex', 'grid']) {
      const { result } = run('organizer', { drain });
      expect(warnings(result)).toEqual([]);
      expect(measureVolume(result.parts[0].shape)).toBeLessThan(plainBox - 100);
      expect(result.parts[0].shape.solids.length).toBe(1);
    }
    const one = plainBox - measureVolume(run('organizer', { grip: 'front' }).result.parts[0].shape);
    const four = plainBox - measureVolume(run('organizer', { grip: 'all' }).result.parts[0].shape);
    // 30 × 10 mm notch through a 1.2 mm wall, minus the rounded corners
    expect(one).toBeGreaterThan(300);
    expect(one).toBeLessThan(360);
    expect(four).toBeCloseTo(4 * one, 0);
    const labelled = run('organizer', { label: true }).result.parts[0].shape;
    expect(measureVolume(labelled)).toBeGreaterThan(plainBox + 5_000);
    expect(size(labelled)[2]).toBeCloseTo(40, 1);
    expect(labelled.solids.length).toBe(1);
  });

  it('mixes box sizes from custom ratios', () => {
    const { result } = run('organizer', { layout: 'custom', colRatios: '2, 1, 1', rowRatios: '1 1' });
    expect(warnings(result)).toEqual([]);
    expect(result.parts).toHaveLength(2); // wide and narrow, each once
    expect(result.parts.reduce((n, part) => n + part.instances!.length, 0)).toBe(6);
    const [wide, narrow] = result.parts;
    expect(size(wide.shape)[0]).toBeCloseTo(287 / 2 - 0.5, 1);
    expect(size(narrow.shape)[0]).toBeCloseTo(287 / 4 - 0.5, 1);
    // Laid out side by side for export
    expect(narrow.shape.boundingBox.bounds[0][0]).toBeGreaterThan(wide.shape.boundingBox.bounds[1][0] + 5);
    // …and shown at their place in the drawer
    const xs = narrow.instances!.map(([x]) => x + (narrow.shape.boundingBox.bounds[0][0] + narrow.shape.boundingBox.bounds[1][0]) / 2);
    expect(Math.max(...xs)).toBeCloseTo(287 / 2 - 287 / 8, 1);
  });

  it('rolls a random mix of box sizes that fills the drawer', () => {
    const roll = (seed: number) => run('organizer', { layout: 'random', seed, drawerWidth: 400, drawerDepth: 400, targetSize: 100 }).result;
    const result = roll(3);
    expect(warnings(result)).toEqual([]);
    expect(result.parts.length).toBeGreaterThan(1);
    expect(result.parts.length).toBeLessThanOrEqual(4);
    // Footprints, play included, add up to the drawer
    const area = result.parts.reduce((sum, part) => sum + part.instances!.length * (size(part.shape)[0] + 0.5) * (size(part.shape)[1] + 0.5), 0);
    expect(area).toBeCloseTo(400 * 400, 0);
    for (const part of result.parts) expect(Math.max(...size(part.shape))).toBeLessThanOrEqual(220);
    // The same number gives the same arrangement, another number a different one
    const layout = (r: BuildResult) => JSON.stringify(r.parts.map((part) => [part.name, part.instances]));
    expect(layout(roll(3))).toBe(layout(result));
    expect(layout(roll(4))).not.toBe(layout(result));
  });

  it('builds every organizer template cleanly', () => {
    for (const name of Object.keys(GENERATORS.organizer.templates!)) {
      const { result } = run('organizer', fromTemplate(GENERATORS.organizer, name));
      expect(warnings(result), name).toEqual([]);
      for (const part of result.parts) expect(part.shape.solids.length, name).toBe(1);
    }
  });

  it('never exceeds the print bed in auto layout', () => {
    const { result } = run('organizer', { drawerWidth: 900, targetSize: 400, maxPrint: 200 });
    expect(size(result.parts[0].shape)[0]).toBeLessThanOrEqual(200);
    expect(warnings(result)).toEqual([]);
  });
});

describe('gridfinity', () => {
  const one = (r: BuildResult) => r.parts[0].shape;

  it('builds a bin on the 42 mm grid with a foot per cell', () => {
    const { result, stages } = run('gridfinity');
    expect(stages.length).toBeGreaterThanOrEqual(2);
    expect(warnings(result)).toEqual([]);
    expect(one(result).solids.length).toBe(1);
    const [l, w, h] = size(one(result));
    expect(l).toBeCloseTo(83.5, 1);
    expect(w).toBeCloseTo(41.5, 1);
    expect(h).toBeCloseTo(21 + 4.1, 1); // three units plus the stacking lip
    // The feet leave a gap along the grid line between the two cells
    const slice = one(result).intersect(makeBaseBox(0.3, 30, 4).translate(0, 0, 0.2)) as Shape3D;
    expect(measureVolume(slice)).toBeLessThan(0.01);
  });

  it('drops the lip, and fills the bin when asked', () => {
    const plain = one(run('gridfinity', { lip: false }).result);
    expect(size(plain)[2]).toBeCloseTo(21, 1);
    const solid = one(run('gridfinity', { lip: false, fill: 'solid' }).result);
    expect(measureVolume(solid)).toBeGreaterThan(measureVolume(plain) * 3);
  });

  it('adds dividers, scoop and label ledges inside', () => {
    const base = measureVolume(one(run('gridfinity').result));
    for (const extra of [{ divX: 2, divY: 1 }, { scoop: 10 }, { label: 'full' }, { label: 'center', divX: 1 }] as Params[]) {
      const { result } = run('gridfinity', extra);
      expect(warnings(result), JSON.stringify(extra)).toEqual([]);
      expect(one(result).solids.length, JSON.stringify(extra)).toBe(1);
      expect(measureVolume(one(result)), JSON.stringify(extra)).toBeGreaterThan(base + 50);
    }
  });

  it('cuts magnet and screw holes into the feet', () => {
    const base = measureVolume(one(run('gridfinity').result));
    const corners = base - measureVolume(one(run('gridfinity', { baseHoles: 'magnets' }).result));
    const all = base - measureVolume(one(run('gridfinity', { baseHoles: 'magnets', baseHolesAt: 'all' }).result));
    const magnet = Math.PI * 3.25 ** 2 * 2.4;
    // Raising the floor above the holes adds a little material back
    expect(corners).toBeGreaterThan(4 * magnet * 0.5);
    expect(all - corners).toBeCloseTo(4 * magnet, 0);
    expect(one(run('gridfinity', { baseHoles: 'both', baseHolesAt: 'all' }).result).solids.length).toBe(1);
  });

  it('makes a holder with a field of pockets', () => {
    const solid = measureVolume(one(run('gridfinity', { fill: 'solid' }).result));
    for (const holePreset of ['bit', 'aa', 'custom']) {
      const { result } = run('gridfinity', { fill: 'holes', holePreset });
      expect(warnings(result), holePreset).toEqual([]);
      expect(one(result).solids.length, holePreset).toBe(1);
      expect(measureVolume(one(result)), holePreset).toBeLessThan(solid - 500);
    }
  });

  it('builds a baseplate whose sockets take a bin', () => {
    const { result } = run('gridfinity', { kind: 'baseplate', plateX: 2, plateY: 2 });
    expect(warnings(result)).toEqual([]);
    const plate = one(result);
    expect(plate.solids.length).toBe(1);
    expect(size(plate)[0]).toBeCloseTo(84, 1);
    expect(size(plate)[2]).toBeCloseTo(4.65, 2);
    // A 2 × 2 bin set into the plate does not collide with it
    const bin = one(run('gridfinity', { unitsX: 2, unitsY: 2 }).result);
    expect(measureVolume(plate.intersect(bin) as Shape3D)).toBeLessThan(0.5);
  });

  it('gives the baseplate a floor for magnets and screws', () => {
    const { result } = run('gridfinity', { kind: 'baseplate', plateX: 2, plateY: 2, plateMagnets: true, plateScrews: 'corners' });
    expect(warnings(result)).toEqual([]);
    expect(one(result).solids.length).toBe(1);
    expect(size(one(result))[2]).toBeCloseTo(2.4 + 0.8 + 4.65, 2);
  });

  it('fills a drawer with plates that fit the printer', () => {
    const { result } = run('gridfinity', { kind: 'baseplate', plateSize: 'drawer', drawerWidth: 400, drawerDepth: 300, maxPrint: 220 });
    expect(warnings(result)).toEqual([]);
    let area = 0;
    for (const part of result.parts) {
      const [l, w] = size(part.shape);
      expect(Math.max(l, w)).toBeLessThanOrEqual(220);
      expect(part.shape.solids.length).toBe(1);
      area += l * w * part.instances!.length;
    }
    expect(area).toBeCloseTo(400 * 300, 0);
    expect(result.frame).toEqual([400, 300]);
    expect(new Set(result.parts.map((part) => part.name)).size).toBe(result.parts.length);
  });

  it('builds plates once that only differ by half a turn', () => {
    // 9 × 6 cells in 3 × 2 plates with a rim all round: two corner plates and two in the middle
    const { result } = run('gridfinity', { kind: 'baseplate', plateSize: 'drawer', drawerWidth: 400, drawerDepth: 260, maxPrint: 220, plateScrews: 'corners' });
    expect(result.parts).toHaveLength(3);
    const placements = result.parts.flatMap((part) => part.instances!);
    expect(placements).toHaveLength(6);
    expect(placements.filter(([, , , turn]) => turn === 180)).toHaveLength(3);
    // Off-centre, opposite rims differ and every plate is its own
    const offCentre = run('gridfinity', { kind: 'baseplate', plateSize: 'drawer', drawerWidth: 400, drawerDepth: 260, maxPrint: 220, alignX: 'left', alignY: 'front' }).result;
    expect(offCentre.parts.length).toBeGreaterThan(3);
  });

  it('builds every gridfinity template cleanly', () => {
    for (const name of Object.keys(GENERATORS.gridfinity.templates!)) {
      const { result } = run('gridfinity', fromTemplate(GENERATORS.gridfinity, name));
      expect(warnings(result), name).toEqual([]);
      for (const part of result.parts) expect(part.shape.solids.length, name).toBe(1);
    }
  });
});

describe('hook', () => {
  const one = (r: BuildResult) => r.parts[0].shape;

  it('builds a hook lying on its side', () => {
    const { result } = run('hook');
    expect(warnings(result)).toEqual([]);
    const shape = one(result);
    expect(shape.solids.length).toBe(1);
    const [out, up, width] = size(shape);
    expect(width).toBeCloseTo(20, 1);
    expect(up).toBeCloseTo(60, 1);
    expect(out).toBeGreaterThan(4 + 30);
    expect(shape.boundingBox.bounds[0][2]).toBeCloseTo(0, 3);
  });

  it('cuts the screw holes, countersunk or plain', () => {
    const none = measureVolume(one(run('hook', { mount: 'tape' }).result));
    const plain = none - measureVolume(one(run('hook', { countersunk: false }).result));
    const sunk = none - measureVolume(one(run('hook').result));
    expect(plain).toBeCloseTo(2 * Math.PI * 2.25 ** 2 * 4, 0);
    expect(sunk).toBeGreaterThan(plain * 1.3);
  });

  it('fits a cradle to the diameter', () => {
    const { result } = run('hook', { type: 'cradle', diameter: 40 });
    expect(warnings(result)).toEqual([]);
    expect(one(result).solids.length).toBe(1);
    expect(size(one(result))[0]).toBeCloseTo(4 + 40 + 5, 1);
  });

  it('builds a shelf bracket with a rib and holes for the shelf', () => {
    const { result } = run('hook', fromTemplate(GENERATORS.hook, 'shelf'));
    expect(warnings(result)).toEqual([]);
    expect(one(result).solids.length).toBe(1);
    const noRib = run('hook', { ...fromTemplate(GENERATORS.hook, 'shelf'), rib: 0 }).result;
    expect(measureVolume(one(result))).toBeGreaterThan(measureVolume(one(noRib)) + 1000);
  });

  it('puts several hooks on one rail, printed on its back', () => {
    const { result } = run('hook', { count: 4, spacing: 50 });
    expect(warnings(result)).toEqual([]);
    const shape = one(result);
    expect(shape.solids.length).toBe(1);
    const [length, up, out] = size(shape);
    expect(length).toBeCloseTo(200, 1);
    expect(up).toBeCloseTo(60, 1);
    expect(out).toBeGreaterThan(34);
  });

  it('hangs over a door or on a pegboard', () => {
    const wall = size(one(run('hook', { mount: 'tape' }).result))[0];
    const door = run('hook', { mount: 'door', doorThickness: 40 }).result;
    expect(one(door).solids.length).toBe(1);
    expect(size(one(door))[0]).toBeCloseTo(wall + 40 + 4, 1);
    const peg = run('hook', { mount: 'pegboard' }).result;
    expect(one(peg).solids.length).toBe(1);
    expect(size(one(peg))[0]).toBeCloseTo(wall + 5.4 + 4.3, 1);
  });

  it('builds every hook template cleanly', () => {
    for (const name of Object.keys(GENERATORS.hook.templates!)) {
      const { result } = run('hook', fromTemplate(GENERATORS.hook, name));
      expect(warnings(result), name).toEqual([]);
      expect(one(result).solids.length, name).toBe(1);
    }
  });
});

describe('text', () => {
  it('raises text on a plate sized to fit it', () => {
    const { result } = run('text');
    expect(warnings(result)).toEqual([]);
    expect(result.parts).toHaveLength(1);
    const [w, h, t] = size(result.parts[0].shape);
    expect(t).toBeCloseTo(2.4 + 1.2, 2);
    expect(h).toBeGreaterThan(12 + 10 - 0.1); // capital height plus padding
    expect(h).toBeLessThan(12 + 10 + 6); // … and the descender of the g
    expect(w).toBeGreaterThan(40);
    expect(result.parts[0].shape.solids.length).toBe(1);
  });

  it('sets the capital height in every font', () => {
    for (const font of FONTS) {
      const { result } = run('text', { text: 'HE', font, style: 'letters', textHeight: 2, bar: false });
      expect(size(result.parts[0].shape)[1], font).toBeCloseTo(12, 0);
    }
  });

  it('engraves, cuts through and makes loose letters', () => {
    expect(() => run('text', { text: '  ' })).toThrow(ParamError);
    const blank = 80 * 30 * 2.4;
    const engraved = measureVolume(run('text', { text: 'Hi', plateWidth: 80, plateHeight: 30, cornerRadius: 0, style: 'engraved', textHeight: 1 }).result.parts[0].shape);
    const cut = measureVolume(run('text', { text: 'Hi', plateWidth: 80, plateHeight: 30, cornerRadius: 0, style: 'cutout' }).result.parts[0].shape);
    expect(engraved).toBeLessThan(blank - 20);
    expect(blank - cut).toBeCloseTo((blank - engraved) * 2.4, 0);
    const letters = run('text', { text: 'HL', style: 'letters', textHeight: 3 }).result.parts[0].shape;
    expect(letters.solids.length).toBe(1); // joined by the bar
  });

  it('stacks lines and keeps a separate part for a second colour', () => {
    const oneLine = size(run('text').result.parts[0].shape)[1];
    const { result } = run('text', { text: 'Genstrio\nGenstrio', separate: true });
    expect(result.parts.map((part) => part.name)).toEqual(['plate', 'text']);
    expect(size(result.parts[0].shape)[1]).toBeCloseTo(oneLine + 12 * 1.5, 1);
    expect(result.parts[1].shape.boundingBox.bounds[0][2]).toBeCloseTo(2.4, 3);
  });

  it('adds holes and a border, on every plate shape', () => {
    for (const plateShape of ['rect', 'pill', 'ellipse']) {
      for (const hole of ['left', 'top', 'both', 'corners']) {
        const { result } = run('text', { plateShape, hole, border: 1.5 });
        expect(warnings(result)).toEqual([]);
        expect(result.parts[0].shape.solids.length, `${plateShape}/${hole}`).toBe(1);
      }
    }
  });

  it('mirrors the text for a stamp', () => {
    const centre = (mirror: boolean) => {
      const shape = run('text', { text: 'L', style: 'letters', bar: false, mirror, font: 'bebas-neue' }).result.parts[0].shape;
      const foot = shape.intersect(makeBaseBox(200, 2, 50).translate(0, shape.boundingBox.bounds[0][1] + 1, -10)) as Shape3D;
      return (foot.boundingBox.bounds[0][0] + foot.boundingBox.bounds[1][0]) / 2 - (shape.boundingBox.bounds[0][0] + shape.boundingBox.bounds[1][0]) / 2;
    };
    expect(centre(false)).toBeCloseTo(0, 1); // the foot of an L spans its whole width
    const stem = (mirror: boolean) => {
      const shape = run('text', { text: 'L', style: 'letters', bar: false, mirror, font: 'bebas-neue' }).result.parts[0].shape;
      const head = shape.intersect(makeBaseBox(200, 2, 50).translate(0, shape.boundingBox.bounds[1][1] - 1, -10)) as Shape3D;
      return (head.boundingBox.bounds[0][0] + head.boundingBox.bounds[1][0]) / 2 - (shape.boundingBox.bounds[0][0] + shape.boundingBox.bounds[1][0]) / 2;
    };
    expect(stem(false)).toBeLessThan(-1);
    expect(stem(true)).toBeGreaterThan(1);
  });

  it('builds every text template cleanly', () => {
    for (const name of Object.keys(GENERATORS.text.templates!)) {
      const { result } = run('text', fromTemplate(GENERATORS.text, name));
      expect(warnings(result), name).toEqual([]);
      expect(result.parts.length, name).toBeGreaterThan(0);
    }
  });
});

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

  it('builds every gear template cleanly', () => {
    for (const name of Object.keys(GENERATORS.gear.templates!)) {
      const { result } = run('gear', fromTemplate(GENERATORS.gear, name));
      expect(warnings(result), name).toEqual([]);
      for (const part of result.parts) expect(part.shape.solids.length, name).toBe(1);
    }
  });
});

describe('tracing', () => {
  it('finds the outline of a shape and grows it by any distance', () => {
    const field = distanceField(sampleMask('circle'), { pad: 40 });
    const frame = frameOf(field, 50)!;
    expect(frame.width).toBeCloseTo(50, 1);
    expect(frame.height).toBeCloseTo(50, 1);
    const circle = traceRegions(field, frame);
    expect(circle).toHaveLength(1);
    expect(circle[0].holes).toHaveLength(0);
    expect(areaOf(circle) / (Math.PI * 25 ** 2)).toBeCloseTo(1, 2);
    expect(areaOf(traceRegions(field, frame, 3)) / (Math.PI * 28 ** 2)).toBeCloseTo(1, 2);
    expect(areaOf(traceRegions(field, frame, -5)) / (Math.PI * 20 ** 2)).toBeCloseTo(1, 2);
    // A wall of constant width around it
    const wall = traceBand(field, frame, 0, 2);
    expect(wall).toHaveLength(1);
    expect(wall[0].holes).toHaveLength(1);
    expect(areaOf(wall) / (Math.PI * (27 ** 2 - 25 ** 2))).toBeCloseTo(1, 1);
    expect(covers(wall, [26, 0])).toBe(true);
    expect(covers(wall, [0, 0])).toBe(false);
  });

  it('keeps holes, or closes them for an outline only', () => {
    const moon = sampleMask('circle');
    // Punch a hole into the disc
    const ring: Bitmap = { ...moon, data: moon.data.map((v, i) => (Math.hypot((i % moon.width) - 100, Math.floor(i / moon.width) - 100) < 40 ? 0 : v)) };
    const open = distanceField(ring);
    expect(traceRegions(open, frameOf(open, 50)!)[0].holes).toHaveLength(1);
    const closed = distanceField(ring, { fillHoles: true });
    expect(traceRegions(closed, frameOf(closed, 50)!)[0].holes).toHaveLength(0);
    expect(frameOf(distanceField({ width: 20, height: 20, data: new Uint8Array(400) }), 50)).toBeNull();
  });

  it('mirrors on request and reads light on dark when inverted', () => {
    const half: Bitmap = { width: 40, height: 20, data: new Uint8Array(800).map((_, i) => (i % 40 < 10 ? 255 : 0)) };
    const field = distanceField(half, { pad: 6 });
    // Ten pixels wide, twenty high: its middle lies between pixel centres.
    const [px, py] = [6 + 4.5, 6 + 9.5];
    expect(frameOf(field, 30)!.toMm([px, py])[0]).toBeCloseTo(0, 6);
    expect(frameOf(field, 30)!.toMm([px, py])[1]).toBeCloseTo(0, 6);
    expect(frameOf(field, 30)!.width).toBeCloseTo(15, 6);
    const wide = distanceField(half, { pad: 6, invert: true });
    expect(frameOf(wide, 30)!.width).toBeCloseTo(30, 0);
    expect(frameOf(wide, 30, true)!.toMm([0, 0])[0]).toBeCloseTo(-frameOf(wide, 30)!.toMm([0, 0])[0], 6);
  });

  it('packs a picture into text and back', () => {
    const bitmap = sampleMask('star', 64);
    const text = encodeImage(bitmap);
    expect(text.startsWith('64x64:')).toBe(true);
    expect(decodeImage(text)).toEqual(bitmap);
    expect(decodeImage('64x64:AAAA')).toBeNull();
    expect(decodeImage('nonsense')).toBeNull();
  });

  it('reads a shape from a picture by transparency or by darkness, cropped to it', () => {
    const rgba = (alpha: boolean) => {
      const data = new Uint8Array(4 * 100 * 80).fill(255);
      for (let y = 0; y < 80; y++) {
        for (let x = 0; x < 100; x++) {
          const inside = x >= 20 && x < 60 && y >= 10 && y < 30;
          // Either black on white, or a white shape on nothing
          if (alpha) data[4 * (y * 100 + x) + 3] = inside ? 255 : 0;
          else if (inside) data.fill(0, 4 * (y * 100 + x), 4 * (y * 100 + x) + 3);
        }
      }
      return data;
    };
    for (const alpha of [false, true]) {
      const mask = fromRgba(rgba(alpha), 100, 80, 'mask', 200);
      expect([mask.width, mask.height], String(alpha)).toEqual([40, 20]);
      expect(mask.data.every((v) => v === 255)).toBe(true);
    }
    const small = fromRgba(rgba(false), 100, 80, 'mask', 10);
    expect([small.width, small.height]).toEqual([10, 5]);
    const photo = fromRgba(rgba(true), 100, 80, 'photo', 50);
    expect([photo.width, photo.height]).toEqual([50, 40]);
    // Transparent counts as white paper
    expect(photo.data[0]).toBe(255);
  });
});

describe('qr', () => {
  it('encodes text into a code with its three finder patterns', () => {
    const small = qrMatrix('HI', 'L');
    expect(small.count).toBe(21);
    expect(small.version).toBe(1);
    for (const [r, c] of [[0, 0], [0, 20], [20, 0]]) {
      // A 7 × 7 frame around a 3 × 3 block, in three corners
      const dr = r === 0 ? 1 : -1;
      const dc = c === 0 ? 1 : -1;
      expect(small.dark(r, c)).toBe(true);
      expect(small.dark(r + dr, c + dc)).toBe(false);
      expect(small.dark(r + 3 * dr, c + 3 * dc)).toBe(true);
    }
    expect(qrMatrix('x'.repeat(200), 'H').count).toBeGreaterThan(small.count);
    expect(() => qrMatrix('x'.repeat(3000), 'H')).toThrow(ParamError);
    // Umlauts take two bytes each in UTF-8, so they need the larger code.
    expect(qrMatrix('ä'.repeat(15), 'L').count).toBeGreaterThan(qrMatrix('a'.repeat(15), 'L').count);
  });

  it('traces the dark modules exactly, the right way round', () => {
    const matrix = qrMatrix('https://example.com', 'M');
    const n = matrix.count;
    const regions = gridRegions(matrix.dark, n, 2, 0.01);
    let dark = 0;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (matrix.dark(r, c)) dark++;
        // Row 0 is at the top, column 0 at the left.
        expect(covers(regions, [(c + 0.5 - n / 2) * 2, (n / 2 - r - 0.5) * 2]), `${r}/${c}`).toBe(matrix.dark(r, c));
      }
    }
    expect(areaOf(gridRegions(matrix.dark, n, 2))).toBeCloseTo(dark * 4, 6);
    // Modules that touch only at a corner are parted, so no outline touches another.
    const corners = regions.flatMap((region) => [region.outer, ...region.holes]).flat().map(([x, y]) => `${x.toFixed(4)}/${y.toFixed(4)}`);
    expect(new Set(corners).size).toBe(corners.length);
  });

  it('raises the code on a plate with a quiet zone', () => {
    const { result } = run('qr', { text: 'https://example.com', size: 50, quiet: 4, separate: true });
    const [plate, code] = result.parts;
    const matrix = qrMatrix('https://example.com', 'M');
    const cell = 50 / matrix.count;
    const [w, h, t] = size(plate.shape);
    expect(w).toBeCloseTo(50 + 8 * cell, 2);
    expect(h).toBeCloseTo(50 + 8 * cell, 2);
    expect(t).toBeCloseTo(1.6, 3);
    expect(size(code.shape)[0]).toBeCloseTo(50, 1);
    expect(code.shape.boundingBox.bounds[0][2]).toBeCloseTo(1.6, 3);
    let dark = 0;
    for (let r = 0; r < matrix.count; r++) for (let c = 0; c < matrix.count; c++) if (matrix.dark(r, c)) dark++;
    expect(measureVolume(code.shape) / (dark * cell * cell * 0.6)).toBeCloseTo(1, 1);
    // In one piece, the plate carries the same code.
    const joined = run('qr', { text: 'https://example.com', size: 50 }).result.parts;
    expect(joined).toHaveLength(1);
    expect(joined[0].shape.solids.length).toBe(1);
    expect(measureVolume(joined[0].shape)).toBeCloseTo(measureVolume(plate.shape) + measureVolume(code.shape), -1);
  });

  it('engraves, labels and adds a hole', () => {
    const flat = measureVolume(run('qr', { style: 'engraved', relief: 0.01 }).result.parts[0].shape);
    const { result } = run('qr', { style: 'engraved', relief: 0.8 });
    expect(measureVolume(result.parts[0].shape)).toBeLessThan(flat - 100);
    expect(size(result.parts[0].shape)[2]).toBeCloseTo(1.6, 3);
    const plain = size(run('qr').result.parts[0].shape);
    const labelled = size(run('qr', { label: 'WiFi', labelSize: 6 }).result.parts[0].shape);
    expect(labelled[1]).toBeGreaterThan(plain[1] + 6);
    expect(labelled[0]).toBeCloseTo(plain[0], 2);
    expect(size(run('qr', { hole: 'top', holeDiameter: 4 }).result.parts[0].shape)[1]).toBeCloseTo(plain[1] + 8, 2);
    expect(warnings(run('qr', { size: 12 }).result)).toEqual(['note.qrFine']);
    expect(() => run('qr', { text: '   ' })).toThrow(ParamError);
  });

  it('builds every QR template cleanly', () => {
    for (const name of Object.keys(GENERATORS.qr.templates!)) {
      const { result } = run('qr', fromTemplate(GENERATORS.qr, name));
      expect(warnings(result), name).toEqual([]);
      expect(result.parts[0].shape.solids.length, name).toBe(1);
    }
  });
});

// A dark square with a square hole, off-centre on white: 60 × 60 px in a 100 × 80 picture
const framePicture = (): string => {
  const data = new Uint8Array(100 * 80);
  for (let y = 10; y < 70; y++) for (let x = 20; x < 80; x++) if (x < 35 || x >= 65 || y < 25 || y >= 55) data[y * 100 + x] = 255;
  return encodeImage({ width: 100, height: 80, data });
};

describe('relief', () => {
  it('raises a shape on a plate sized to fit it', () => {
    const { result } = run('relief');
    expect(warnings(result)).toEqual([]);
    const [w, h, t] = size(result.parts[0].shape);
    const motif = result.notes.find((n) => n.key === 'note.motifSize')!.vars!;
    expect(motif.w).toBeCloseTo(60, 0);
    expect(w).toBeCloseTo(60 + 10, 0);
    expect(h).toBeCloseTo((motif.h as number) + 10, 0);
    expect(t).toBeCloseTo(2.4 + 1.2, 2);
    expect(result.parts[0].shape.solids.length).toBe(1);
  });

  it('traces a picture, holes included', () => {
    const { result } = run('relief', { shape: 'image', image: framePicture(), size: 60, smooth: 0, style: 'shape', relief: 2 });
    const [w, h, t] = size(result.parts[0].shape);
    expect(w).toBeCloseTo(60, 0);
    expect(h).toBeCloseTo(60, 0);
    expect(t).toBeCloseTo(2, 3);
    // 60 × 60 less the 30 × 30 window, corners slightly rounded
    expect(measureVolume(result.parts[0].shape) / ((3600 - 900) * 2)).toBeCloseTo(1, 1);
    // Inverted, the window and the surroundings are the shape; the frame is not.
    const inverse = run('relief', { shape: 'image', image: framePicture(), invert: true, size: 60, style: 'shape', relief: 2 }).result;
    expect(measureVolume(inverse.parts[0].shape)).toBeGreaterThan(900 * 2);
    expect(() => run('relief', { shape: 'image' })).toThrow(ParamError);
    expect(() => run('relief', { shape: 'image', image: framePicture(), threshold: 5, invert: false, size: 60 })).not.toThrow();
  });

  it('engraves, cuts through and keeps a separate part for a second colour', () => {
    const plate = 70 * (run('relief').result.notes.find((n) => n.key === 'note.plateSize')!.vars!.h as number) * 2.4;
    const engraved = run('relief', { style: 'engraved', relief: 1 }).result;
    const cutout = run('relief', { style: 'cutout' }).result;
    const separate = run('relief', { separate: true }).result;
    expect(size(engraved.parts[0].shape)[2]).toBeCloseTo(2.4, 3);
    expect(measureVolume(engraved.parts[0].shape)).toBeLessThan(plate - 500);
    expect(measureVolume(cutout.parts[0].shape)).toBeLessThan(measureVolume(engraved.parts[0].shape));
    expect(separate.parts.map((part) => part.name)).toEqual(['plate', 'motif']);
    expect(separate.parts[1].shape.boundingBox.bounds[0][2]).toBeCloseTo(2.4, 3);
  });

  it('lets the plate follow the outline, with a lug for a ring', () => {
    const rect = measureVolume(run('relief', { style: 'engraved', relief: 0.01 }).result.parts[0].shape);
    const contour = run('relief', { plateShape: 'contour', padding: 3, style: 'engraved', relief: 0.01 }).result;
    expect(warnings(contour)).toEqual([]);
    expect(contour.parts[0].shape.solids.length).toBe(1);
    expect(measureVolume(contour.parts[0].shape)).toBeLessThan(rect * 0.7);
    // The margin goes round the tips of the star in an arc.
    expect(size(contour.parts[0].shape)[0]).toBeGreaterThan(65.5);
    expect(size(contour.parts[0].shape)[0]).toBeLessThan(67.5);
    const lug = run('relief', { plateShape: 'contour', padding: 3, hole: 'top' }).result.parts[0].shape;
    expect(lug.solids.length).toBe(1);
    expect(size(lug)[1]).toBeGreaterThan(size(contour.parts[0].shape)[1] + 1);
    for (const plateShape of ['rect', 'ellipse']) {
      const holes = run('relief', { plateShape, hole: 'corners' }).result;
      expect(holes.parts[0].shape.solids.length, plateShape).toBe(1);
    }
  });

  it('builds every relief template cleanly', () => {
    for (const name of Object.keys(GENERATORS.relief.templates!)) {
      const { result } = run('relief', fromTemplate(GENERATORS.relief, name));
      expect(warnings(result), name).toEqual([]);
      expect(result.parts.length, name).toBeGreaterThan(0);
    }
  });
});

describe('cutter', () => {
  it('puts a wall of constant thickness around the shape', () => {
    const { result } = run('cutter', { shape: 'circle', size: 60, wall: 1.2, edge: 1.2, flangeWidth: 0, height: 12 });
    expect(warnings(result)).toEqual([]);
    const cutter = result.parts[0].shape;
    const [w, d, h] = size(cutter);
    expect(w).toBeCloseTo(62.4, 1);
    expect(d).toBeCloseTo(62.4, 1);
    expect(h).toBeCloseTo(12, 3);
    expect(cutter.solids.length).toBe(1);
    expect(measureVolume(cutter) / (Math.PI * (31.2 ** 2 - 30 ** 2) * 12)).toBeCloseTo(1, 1);
  });

  it('adds a grip rim below and a thin cutting edge on top', () => {
    const plain = measureVolume(run('cutter', { shape: 'circle', size: 60, wall: 1.2, edge: 1.2, flangeWidth: 0 }).result.parts[0].shape);
    const rim = run('cutter', { shape: 'circle', size: 60, wall: 1.2, edge: 1.2, flangeWidth: 5, flangeThickness: 2 }).result.parts[0].shape;
    expect(size(rim)[0]).toBeCloseTo(70, 1);
    expect(rim.solids.length).toBe(1);
    expect(measureVolume(rim) - plain).toBeCloseTo(Math.PI * (35 ** 2 - 31.2 ** 2) * 2, -1.5);
    const sharp = run('cutter', { shape: 'circle', size: 60, wall: 1.2, edge: 0.5, edgeHeight: 3, flangeWidth: 0 }).result.parts[0].shape;
    expect(sharp.solids.length).toBe(1);
    expect(plain - measureVolume(sharp)).toBeCloseTo(Math.PI * (31.2 ** 2 - 30.5 ** 2) * 3, -1.5);
  });

  it('follows the outer outline of a picture and can widen it', () => {
    const framed = run('cutter', { shape: 'image', image: framePicture(), size: 50, smooth: 0, flangeWidth: 0, edge: 1.2 }).result;
    expect(warnings(framed)).toEqual([]);
    // The window inside the frame is dough as well: one wall, not two.
    expect(framed.parts[0].shape.solids.length).toBe(1);
    expect(size(framed.parts[0].shape)[0]).toBeCloseTo(52.4, 0);
    expect(measureVolume(framed.parts[0].shape) / (4 * 51.2 * 1.2 * 14)).toBeCloseTo(1, 1);
    const wider = run('cutter', { shape: 'image', image: framePicture(), size: 50, offset: 2, flangeWidth: 0 }).result;
    expect(size(wider.parts[0].shape)[0]).toBeCloseTo(56.4, 0);
    // Two shapes in one picture give two cutters, and a word about it.
    const data = new Uint8Array(120 * 40);
    for (let y = 5; y < 35; y++) for (let x = 5; x < 115; x++) if (x < 35 || x >= 85) data[y * 120 + x] = 255;
    const two = run('cutter', { shape: 'image', image: encodeImage({ width: 120, height: 40, data }), size: 80 }).result;
    expect(warnings(two)).toEqual(['note.cutterPieces']);
  });

  it('makes a stamp for what the picture shows inside the outline', () => {
    // A face: a ring for the head, two eyes and a mouth, dark on white
    const w = 160;
    const data = new Uint8Array(w * w);
    for (let y = 0; y < w; y++) {
      for (let x = 0; x < w; x++) {
        const r = Math.hypot(x - 80, y - 80);
        const eye = Math.hypot(x - 55, y - 60) < 8 || Math.hypot(x - 105, y - 60) < 8;
        if ((r < 70 && r > 62) || eye || (Math.abs(r - 38) < 4 && y > 95)) data[y * w + x] = 255;
      }
    }
    const image = encodeImage({ width: w, height: w, data });
    const face: Params = { shape: 'image', image, size: 70, flangeWidth: 4, stampClearance: 0.5, stampMargin: 5, stampPlate: 3, stampRelief: 2 };
    const { result } = run('cutter', { ...face, stamp: 'lines' });
    expect(warnings(result)).toEqual([]);
    expect(result.parts.map((part) => part.name)).toEqual(['cutter', 'stamp', 'handle']);
    const [cutter, stamp, handle] = result.parts.map((part) => part.shape);
    expect(cutter.solids.length).toBe(1);
    expect(stamp.solids.length).toBe(1);
    // The plate drops into the cutter with play all round …
    expect(size(stamp)[0]).toBeCloseTo(70 - 1, 0);
    expect(size(stamp)[2]).toBeCloseTo(5, 3);
    const [[x0], [x1]] = stamp.boundingBox.bounds;
    const inPlace = stamp.clone().translate([-(x0 + x1) / 2, 0, 0]) as Shape3D;
    expect(measureVolume(cutter.clone().intersect(inPlace))).toBeLessThan(0.01);
    // … and carries eyes and mouth, but not the outline, which lies within the margin.
    const plate = Math.PI * 34.5 ** 2 * 3;
    const marks = (2 * Math.PI * 8 ** 2 + 0.36 * Math.PI * (42 ** 2 - 34 ** 2)) * (70 / 140) ** 2 * 2;
    const socket = 8.3 ** 2 * 2.2;
    expect(measureVolume(stamp)).toBeGreaterThan(plate - socket + marks * 0.7);
    expect(measureVolume(stamp)).toBeLessThan(plate - socket + marks * 1.4);
    // A knob with a peg slightly shorter than the socket is deep
    expect(size(handle)[2]).toBeCloseTo(14 + 2, 1);
    // The other kind raises everything but the lines.
    const areas = run('cutter', { ...face, stamp: 'areas' }).result.parts[1].shape;
    expect(measureVolume(areas)).toBeGreaterThan(measureVolume(stamp) + 1000);
    expect(run('cutter', { ...face, stamp: 'lines', stampHandle: false }).result.parts).toHaveLength(2);
    // Nothing inside a plain disc is dark, and a built-in shape has no picture to take lines from.
    const disc = encodeImage(sampleMask('circle', 120));
    expect(warnings(run('cutter', { shape: 'image', image: disc, stamp: 'areas' }).result)).toEqual(['note.stampEmpty']);
    expect(run('cutter', { shape: 'heart', stamp: 'lines' }).result.parts).toHaveLength(1);
  });

  it('builds every cutter template cleanly', () => {
    for (const name of Object.keys(GENERATORS.cutter.templates!)) {
      const { result } = run('cutter', fromTemplate(GENERATORS.cutter, name));
      expect(warnings(result), name).toEqual([]);
      expect(result.parts[0].shape.solids.length, name).toBe(1);
      expect(size(result.parts[0].shape)[2], name).toBeCloseTo(result.parts[0].shape.boundingBox.bounds[1][2], 3);
    }
  });
});

/** Volume enclosed by a mesh; only meaningful, and positive, if it is closed and faces outwards. */
function meshVolume({ vertices: v, triangles: t }: WeldedMesh): number {
  let six = 0;
  for (let i = 0; i < t.length; i += 3) {
    const [a, b, c] = [3 * t[i], 3 * t[i + 1], 3 * t[i + 2]];
    six += v[a] * (v[b + 1] * v[c + 2] - v[b + 2] * v[c + 1]) - v[a + 1] * (v[b] * v[c + 2] - v[b + 2] * v[c]) + v[a + 2] * (v[b] * v[c + 1] - v[b + 1] * v[c]);
  }
  return six / 6;
}

/** Edges that are not shared by exactly two triangles running in opposite directions. */
function openEdges({ vertices, triangles }: WeldedMesh): number {
  const edges = new Map<number, number>();
  const n = vertices.length / 3;
  for (let i = 0; i < triangles.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const key = triangles[i + k] * n + triangles[i + ((k + 1) % 3)];
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  let open = 0;
  for (const [key, count] of edges) if (count !== 1 || edges.get((key % n) * n + Math.floor(key / n)) !== 1) open++;
  return open;
}

describe('lithophane', () => {
  const litho = (overrides: Params = {}) => ({ ...defaults(GENERATORS.lithophane), ...overrides }) as unknown as LithophaneParams;
  const grey = (value: number, width = 40, height = 30): Bitmap => ({ width, height, data: new Uint8Array(width * height).fill(value) });

  it('builds a closed mesh for every form', () => {
    for (const form of ['flat', 'arc', 'cylinder']) {
      const { result } = run('lithophane', { form });
      expect(result.parts).toHaveLength(0);
      const { mesh } = result.meshes![0];
      expect(openEdges(mesh), form).toBe(0);
      expect(meshVolume(mesh), form).toBeGreaterThan(1000);
      expect(mesh.shade!.length, form).toBe(mesh.vertices.length / 3);
      expect(vertexNormals(mesh).some((v) => Number.isNaN(v)), form).toBe(false);
    }
    expect(GENERATORS.lithophane.meshOnly).toBe(true);
  });

  it('makes bright thin and dark thick, or the reverse', () => {
    const volume = (value: number, overrides: Params = {}) => {
      const { mesh, width, height } = lithophaneMesh(litho({ border: 0, width: 80, ...overrides }), grey(value));
      expect(width).toBeCloseTo(80, 3);
      expect(height).toBeCloseTo(60, 0);
      return meshVolume(mesh) / (width * height);
    };
    expect(volume(255)).toBeCloseTo(0.6, 3);
    expect(volume(0)).toBeCloseTo(3, 3);
    expect(volume(128)).toBeCloseTo(0.6 + 2.4 * (127 / 255), 2);
    expect(volume(255, { negative: true })).toBeCloseTo(3, 3);
    expect(volume(255, { minThickness: 1, maxThickness: 4 })).toBeCloseTo(1, 3);
  });

  it('frames the picture and stands it upright, facing the front', () => {
    const { mesh, width, height } = lithophaneMesh(litho({ width: 100, border: 5 }), grey(255, 60, 40));
    expect(width).toBeCloseTo(100, 0);
    const v = mesh.vertices;
    let [x0, x1, y0, y1, z0, z1] = [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity];
    for (let i = 0; i < v.length; i += 3) {
      x0 = Math.min(x0, v[i]);
      x1 = Math.max(x1, v[i]);
      y0 = Math.min(y0, v[i + 1]);
      y1 = Math.max(y1, v[i + 1]);
      z0 = Math.min(z0, v[i + 2]);
      z1 = Math.max(z1, v[i + 2]);
    }
    expect([x0, x1]).toEqual([-width / 2, width / 2].map((n) => expect.closeTo(n, 3)));
    expect([z0, z1]).toEqual([0, height].map((n) => expect.closeTo(n, 3)));
    // The back is flat at y = 0; the frame, as thick as the darkest spot, comes forward.
    expect(y1).toBeCloseTo(0, 6);
    expect(y0).toBeCloseTo(-3, 6);
    const picture = (90 * (height - 10) * 0.6 + (width * height - 90 * (height - 10)) * 3) / (width * height);
    expect(meshVolume(mesh) / (width * height)).toBeCloseTo(picture, 1);
  });

  it('bends into an arc or closes into a cylinder of the given diameter', () => {
    const flat = lithophaneMesh(litho({ width: 100, border: 0 }), grey(0, 80, 40));
    const arc = lithophaneMesh(litho({ form: 'arc', angle: 180, width: 100, border: 0 }), grey(0, 80, 40));
    const xs = (mesh: WeldedMesh) => mesh.vertices.filter((_, i) => i % 3 === 0);
    const extent = (values: Float32Array) => values.reduce((m, x) => Math.max(m, x), -Infinity) - values.reduce((m, x) => Math.min(m, x), Infinity);
    // Half a circle of 100 mm: radius 100/π at the back, 3 mm more in front
    expect(extent(xs(arc.mesh))).toBeCloseTo(2 * (100 / Math.PI + 3), 1);
    expect(meshVolume(arc.mesh)).toBeGreaterThan(meshVolume(flat.mesh));
    const tube = lithophaneMesh(litho({ form: 'cylinder', diameter: 60, border: 0 }), grey(0, 120, 40));
    expect(extent(xs(tube.mesh))).toBeCloseTo(60, 1);
    expect(openEdges(tube.mesh)).toBe(0);
    expect(meshVolume(tube.mesh) / (Math.PI * (30 ** 2 - 27 ** 2) * tube.height)).toBeCloseTo(1, 1);
  });

  it('uses the picture it is given and refuses a frame that leaves no room', () => {
    const image = encodeImage(grey(200, 64, 48));
    const { result } = run('lithophane', { image });
    expect(result.notes.map((n) => n.key)).not.toContain('note.lithoSample');
    expect(run('lithophane').result.notes.map((n) => n.key)).toContain('note.lithoSample');
    expect(() => run('lithophane', { width: 20, border: 8 })).toThrow(ParamError);
    expect(() => run('lithophane', { image: '4x4:AAAA' })).toThrow(ParamError);
  });

  it('adds a base with a slot, and a seat for a battery light', () => {
    const { result } = run('lithophane', { width: 100, border: 3, stand: 'base' });
    expect(result.parts.map((part) => part.name)).toEqual(['stand']);
    const stand = result.parts[0];
    expect(stand.shape.solids.length).toBe(1);
    // Fitted, its plate lies below the lithophane, which stands in the slot between two ribs.
    const [, dy, dz] = stand.assembled!.offset;
    const fitted = stand.shape.clone().translate([0, dy, dz]) as Shape3D;
    expect(fitted.boundingBox.bounds[1][2]).toBeCloseTo(5, 2);
    const foot = makeBaseBox(100, 3, 20).translate([0, -1.5, 0]) as Shape3D;
    expect(measureVolume(fitted.clone().intersect(foot.clone()))).toBeLessThan(0.001);
    for (const push of [-0.6, 0.6]) expect(measureVolume(fitted.clone().intersect(foot.clone().translate([0, push, 0]) as Shape3D)), String(push)).toBeGreaterThan(1);

    const lit = run('lithophane', { form: 'arc', width: 140, angle: 110, border: 3, stand: 'light', lightDiameter: 68, lightThickness: 25, lightTilt: 15, lightDistance: 50 }).result;
    const seat = lit.parts[0];
    expect(seat.shape.solids.length).toBe(1);
    expect(lit.notes.map((n) => n.key)).toContain('note.lithoLight');
    // The light, a disc leaning back by 15°, fits its hollow without touching.
    const [, sy, sz] = seat.assembled!.offset;
    const base = seat.shape.clone().translate([0, sy, sz]) as Shape3D;
    const tilt = (15 * Math.PI) / 180;
    const light = (makeCylinder(34, 25, [0, 0, -12.5], [0, 0, 1]) as Shape3D).rotate(75, [0, 0, 0], [1, 0, 0]).translate([0, 50, 2 + 34 * Math.cos(tilt) + 12.5 * Math.sin(tilt)]) as Shape3D;
    expect(measureVolume(base.clone().intersect(light.clone()))).toBeLessThan(0.001);
    expect(measureVolume(base.clone().intersect(light.clone().translate([0, 0, -3]) as Shape3D))).toBeGreaterThan(10);
    expect(() => run('lithophane', { form: 'arc', width: 30, angle: 270, stand: 'base' })).toThrow(ParamError);
  });

  it('closes a cylinder with a lid for an E27 or E14 lamp holder', () => {
    for (const [mount, hole] of [['e27', 40.5], ['e14', 28.5]] as const) {
      const { result } = run('lithophane', { form: 'cylinder', diameter: 90, mount });
      expect(result.meshes).toHaveLength(1);
      const lid = result.parts[0];
      expect(lid.name).toBe('mount');
      expect(lid.shape.solids.length).toBe(1);
      const [[x0], [x1]] = lid.shape.boundingBox.bounds;
      expect(x1 - x0).toBeCloseTo(90, 1);
      // Beside the cylinder for printing, so the two do not overlap in the file
      expect(x0).toBeGreaterThan(45);
      const centred = lid.shape.clone().translate([-(x0 + x1) / 2, 0, 0]) as Shape3D;
      const through = (d: number) => measureVolume(centred.clone().intersect(makeCylinder(d / 2, 20, [0, 0, -5], [0, 0, 1]) as Shape3D));
      expect(through(hole - 0.2), mount).toBeLessThan(0.001);
      expect(through(hole + 2), mount).toBeGreaterThan(10);
      expect(lid.assembled!.flip).toBe(true);
    }
    expect(() => run('lithophane', { form: 'cylinder', diameter: 50, mount: 'e27' })).toThrow(ParamError);
  });

  it('writes its mesh as STL and 3MF', () => {
    const { mesh } = run('lithophane').result.meshes![0];
    const stl = writeStl([mesh]);
    expect(stl.byteLength).toBe(84 + 50 * (mesh.triangles.length / 3));
    expect(new DataView(stl.buffer).getUint32(80, true)).toBe(mesh.triangles.length / 3);
    const zip = write3mf([{ name: 'lithophane', mesh }]);
    expect(String.fromCharCode(zip[0], zip[1])).toBe('PK');
  });

  it('builds every lithophane template cleanly', () => {
    for (const name of Object.keys(GENERATORS.lithophane.templates!)) {
      const { result } = run('lithophane', fromTemplate(GENERATORS.lithophane, name));
      expect(openEdges(result.meshes![0].mesh), name).toBe(0);
    }
  });
});

describe('hinge', () => {
  const pair = (shape: Shape3D) => shape.solids.map((solid) => solid as Shape3D);

  it('prints a hinge in place whose leaves turn freely', () => {
    const { result } = run('hinge');
    expect(warnings(result)).toEqual([]);
    const hinge = result.parts[0].shape;
    expect(hinge.solids.length).toBe(2);
    const [l, w, h] = size(hinge);
    expect(l).toBeCloseTo(40, 2);
    expect(w).toBeCloseTo(2 * (4 + 18), 2);
    expect(h).toBeCloseTo(8, 2);
    expect(hinge.boundingBox.bounds[0][2]).toBeCloseTo(0, 3);
    const [a, b] = pair(hinge);
    expect(measureVolume(a.clone().intersect(b.clone()))).toBeLessThan(0.001);
    // Swung up, and folded right over onto the other leaf: still nothing collides.
    for (const angle of [45, 90, 135, 180]) {
      const turned = b.clone().rotate(angle, [0, 0, 4], [1, 0, 0]) as Shape3D;
      expect(measureVolume(a.clone().intersect(turned)), String(angle)).toBeLessThan(0.001);
    }
    // But the knuckles hold on to each other: pulled along the axis or apart, the leaves collide.
    expect(measureVolume(a.clone().intersect(b.clone().translate([2, 0, 0]) as Shape3D))).toBeGreaterThan(1);
    expect(measureVolume(a.clone().intersect(b.clone().translate([0, 2, 0]) as Shape3D))).toBeGreaterThan(1);
  });

  it('cuts screw holes and refuses what cannot work', () => {
    const plain = measureVolume(run('hinge', { holes: 0 }).result.parts[0].shape);
    const drilled = measureVolume(run('hinge', { holes: 2, holeDiameter: 4, countersunk: false }).result.parts[0].shape);
    expect(plain - drilled).toBeCloseTo(4 * Math.PI * 4 * 3, 0);
    expect(measureVolume(run('hinge', { holes: 2, holeDiameter: 4, countersunk: true }).result.parts[0].shape)).toBeLessThan(drilled - 20);
    expect(() => run('hinge', { length: 20, knuckles: 9 })).toThrow(ParamError);
    expect(run('hinge', { clearance: 0.15 }).result.notes.map((n) => n.key)).toContain('note.tightFit');
  });

  it('prints a sliding bolt in place, with its keeper', () => {
    const { result } = run('hinge', { type: 'bolt', length: 55, throw: 15 });
    expect(result.parts.map((part) => part.name)).toEqual(['bolt', 'keeper']);
    const [housing, bolt] = pair(result.parts[0].shape);
    const keeper = result.parts[1].shape;
    expect(result.parts[0].shape.solids.length).toBe(2);
    expect(keeper.solids.length).toBe(1);
    expect(measureVolume(housing.clone().intersect(bolt.clone()))).toBeLessThan(0.001);
    // It slides out by its throw, into the keeper, and no further.
    const out = bolt.clone().translate([15, 0, 0]) as Shape3D;
    expect(measureVolume(housing.clone().intersect(out.clone()))).toBeLessThan(0.001);
    expect(measureVolume(keeper.clone().intersect(out.clone()))).toBeLessThan(0.001);
    expect(out.boundingBox.bounds[1][0]).toBeGreaterThan(keeper.boundingBox.bounds[0][0] + 10);
    expect(measureVolume(housing.clone().intersect(bolt.clone().translate([17, 0, 0]) as Shape3D))).toBeGreaterThan(1);
    expect(measureVolume(housing.clone().intersect(bolt.clone().translate([-2, 0, 0]) as Shape3D))).toBeGreaterThan(1);
    // The channel narrows towards the top: the bolt cannot be lifted out.
    expect(measureVolume(housing.clone().intersect(bolt.clone().translate([0, 0, 2]) as Shape3D))).toBeGreaterThan(1);
    expect(() => run('hinge', { type: 'bolt', length: 30, throw: 40 })).toThrow(ParamError);
    expect(() => run('hinge', { type: 'bolt', boltWidth: 8, boltHeight: 8 })).toThrow(ParamError);
  });

  it('builds every hinge template cleanly', () => {
    for (const name of Object.keys(GENERATORS.hinge.templates!)) {
      const { result } = run('hinge', fromTemplate(GENERATORS.hinge, name));
      expect(warnings(result), name).toEqual([]);
      const [a, b] = pair(result.parts[0].shape);
      expect(measureVolume(a.clone().intersect(b.clone())), name).toBeLessThan(0.001);
    }
  });
});

describe('parameters', () => {
  it('accepts a picture only in its packed form', () => {
    const image = encodeImage(sampleMask('heart', 32));
    expect(sanitize(GENERATORS.cutter, { image }).image).toBe(image);
    for (const bad of ['<svg/>', 'data:image/png;base64,AAAA', 42, '12x12:not base64!']) expect(sanitize(GENERATORS.cutter, { image: bad }).image, String(bad)).toBe('');
    expect(sanitize(GENERATORS.lithophane, { image: 'x'.repeat(500_000) }).image).toBe('');
  });

  it('sanitizes lists and clamps their fields', () => {
    const p = sanitize(GENERATORS.enclosure, { openings: [{ type: 'speaker', diameter: 9999 }, 'junk', { type: 'nope' }], wall: 'x' });
    const list = p.openings as Params[];
    expect(list).toHaveLength(2);
    expect(list[0].type).toBe('speaker');
    expect(list[0].diameter).toBe(200);
    expect(list[1].type).toBe('round');
    expect(p.wall).toBe(2);
    expect(sanitize(GENERATORS.enclosure, {}).openings).toEqual(defaults(GENERATORS.enclosure).openings);
    // Defaults must not be shared between calls.
    expect(defaults(GENERATORS.enclosure).openings).not.toBe(defaults(GENERATORS.enclosure).openings);
  });
});

describe('units', () => {
  it('reads and writes inches as fractions', () => {
    setUnit('in');
    expect(parseLength('3 1/2')).toBeCloseTo(88.9, 4);
    expect(parseLength('3-1/2"')).toBeCloseTo(88.9, 4);
    expect(parseLength('7/16')).toBeCloseTo(11.1125, 4);
    expect(parseLength('-1/4')).toBeCloseTo(-6.35, 4);
    expect(parseLength('2.5')).toBeCloseTo(63.5, 4);
    expect(parseLength('.5')).toBeCloseTo(12.7, 4);
    expect(Number.isFinite(parseLength('1/0'))).toBe(false);
    expect(parseLength('abc')).toBeNaN();
    expect(formatLength(88.9)).toBe('3 1/2');
    expect(formatLength(11.1125)).toBe('7/16');
    expect(formatLength(50.8)).toBe('2');
    expect(formatLength(-6.35)).toBe('-1/4');
    expect(formatLength(120)).toBe('4.724');
    expect(formatLength(0)).toBe('0');
    setUnit('cm');
    expect(formatLength(125)).toBe('12.5');
    expect(parseLength('12,5')).toBeCloseTo(125, 6);
    setUnit('mm');
    expect(formatLength(88.9)).toBe('88.9');
  });
});

describe('3MF export', () => {
  it('writes a watertight mesh', () => {
    const { result } = run('adapter');
    const mesh = meshPart(result.parts[0].shape, 0.05);
    // Closed manifold: every edge is shared by exactly two triangles.
    const edges = new Map<string, number>();
    for (let i = 0; i < mesh.triangles.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const a = mesh.triangles[i + k];
        const b = mesh.triangles[i + ((k + 1) % 3)];
        const key = a < b ? `${a}_${b}` : `${b}_${a}`;
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    }
    expect([...edges.values()].filter((n) => n !== 2)).toHaveLength(0);
    const zip = write3mf([{ name: 'adapter', mesh }]);
    expect(zip.byteLength).toBeGreaterThan(1000);
    expect(String.fromCharCode(zip[0], zip[1])).toBe('PK');
  });
});
