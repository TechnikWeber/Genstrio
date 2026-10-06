import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import opencascade from 'replicad-opencascadejs';
import { measureVolume, setOC, type Shape3D } from 'replicad';
import { beforeAll, describe, expect, it } from 'vitest';
import { BUILDERS, ParamError, type BuildResult, type Stage } from '../src/generators/build';
import { GENERATORS } from '../src/generators/meta';
import { defaults, type GeneratorId, type Params } from '../src/generators/types';
import { meshPart, write3mf } from '../src/engine/export';

beforeAll(async () => {
  const wasm = createRequire(import.meta.url).resolve('replicad-opencascadejs/wasm');
  const oc = await (opencascade as unknown as (o: object) => Promise<never>)({ wasmBinary: readFileSync(wasm) });
  setOC(oc);
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

describe('enclosure', () => {
  it('builds body and lid with the requested outer size', () => {
    const { result, stages } = run('enclosure');
    const [body, lid] = result.parts;
    const [l, w, h] = size(body.shape);
    expect(l).toBeCloseTo(120, 1);
    expect(w).toBeCloseTo(80, 1);
    expect(h).toBeCloseTo(33, 1);
    expect(size(lid.shape)[2]).toBeCloseTo(5, 1);
    expect(stages.length).toBeGreaterThanOrEqual(4);
    expect(warnings(result)).toEqual([]);
    // Floor ~19 cm³ + walls ~24 cm³ + corner posts and standoffs ~5 cm³
    const vol = measureVolume(body.shape);
    expect(vol).toBeGreaterThan(43_000);
    expect(vol).toBeLessThan(50_000);
  });

  it('cuts a port through the chosen wall', () => {
    const closed = measureVolume(run('enclosure', { port: 'none', vents: 'none' }).result.parts[0].shape);
    for (const portSide of ['front', 'back', 'left', 'right']) {
      const open = measureVolume(run('enclosure', { port: 'usbc', portSide, vents: 'none' }).result.parts[0].shape);
      // 9.4 × 3.6 mm slot through a 2 mm wall, minus rounded corners
      expect(closed - open).toBeGreaterThan(55);
      expect(closed - open).toBeLessThan(70);
    }
  });

  it('vents remove material from lid and sides', () => {
    const none = run('enclosure', { vents: 'none' }).result.parts;
    const both = run('enclosure', { vents: 'both' }).result.parts;
    expect(measureVolume(both[0].shape)).toBeLessThan(measureVolume(none[0].shape) - 100);
    expect(measureVolume(both[1].shape)).toBeLessThan(measureVolume(none[1].shape) - 100);
  });

  it('survives extreme parameters', () => {
    run('enclosure', { length: 20, width: 20, height: 10, wall: 6, cornerRadius: 30 });
    run('enclosure', { cornerRadius: 0, lidScrews: false, pcb: false, port: 'round', vents: 'both' });
    expect(warnings(run('enclosure', { pcbLength: 200 }).result)).toContain('note.pcbTooLarge');
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

  it('never exceeds the print bed in auto layout', () => {
    const { result } = run('organizer', { drawerWidth: 900, targetSize: 400, maxPrint: 200 });
    expect(size(result.parts[0].shape)[0]).toBeLessThanOrEqual(200);
    expect(warnings(result)).toEqual([]);
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
