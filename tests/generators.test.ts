import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import opencascade from 'replicad-opencascadejs';
import { loadFont, makeBaseBox, measureVolume, setOC, type Shape3D } from 'replicad';
import { beforeAll, describe, expect, it } from 'vitest';
import { BUILDERS, loadedFonts, ParamError, type BuildResult, type Stage } from '../src/generators/build';
import { FONTS } from '../src/generators/fonts';
import { GENERATORS } from '../src/generators/meta';
import { defaults, fromTemplate, newItem, sanitize, type GeneratorId, type ListParam, type Params } from '../src/generators/types';
import { meshPart, write3mf } from '../src/engine/export';
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

describe('parameters', () => {
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
