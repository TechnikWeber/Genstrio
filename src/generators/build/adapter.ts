import { drawCircle, type Shape3D, type Sketch } from 'replicad';
import type { Note } from '../types';
import { ParamError, revolveZ as revolve, round1, type Build, type RZ } from './common';

type Fit = 'inside' | 'over';

export interface AdapterParams {
  d1: number;
  fit1: Fit;
  len1: number;
  barbs1: boolean;
  d2: number;
  fit2: Fit;
  len2: number;
  barbs2: boolean;
  wall: number;
  transition: number;
  clearance: number;
  chamfer: number;
  angle: number;
  bendRadius: number;
}

/** Radii of one end. `inside`: the adapter plugs into the pipe; `over`: it slides over it. */
function endRadii(d: number, fit: Fit, wall: number, clr: number) {
  const radii = fit === 'inside' ? { ro: (d - clr) / 2, ri: (d - clr) / 2 - wall } : { ri: (d + clr) / 2, ro: (d + clr) / 2 + wall };
  if (radii.ri < 0.5) throw new ParamError('err.adapterNoBore');
  return radii;
}

/** Outer contour of a sleeve, z measured from its open end. Barbs grip against pulling off. */
function sleeveOuter(ro: number, len: number, barbs: boolean, wall: number, chamfer = 0): RZ[] {
  const c = barbs ? Math.min(chamfer, 1.5) : chamfer;
  const pts: RZ[] = [[ro - c, 0], [ro, c]];
  if (barbs) {
    const lead = 2;
    const pitch = 4;
    const bh = Math.min(0.8, wall * 0.4);
    const n = Math.min(4, Math.floor((len - lead - 1) / pitch));
    for (let i = 0; i < n; i++) {
      const z = lead + i * pitch;
      pts.push([ro, z], [ro + bh, z + pitch], [ro, z + pitch]);
    }
  }
  pts.push([ro, len]);
  return pts;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const shift = (pts: RZ[], dz: number): RZ[] => pts.map(([rad, z]) => [rad, z + dz]);

export function* buildAdapter(p: AdapterParams): Build {
  const notes: Note[] = [];
  const a = endRadii(p.d1, p.fit1, p.wall, p.clearance);
  const b = endRadii(p.d2, p.fit2, p.wall, p.clearance);

  // A cone steeper than 45° gets thin walls and needs support, so stretch it.
  const lt = Math.max(p.transition, Math.abs(a.ro - b.ro), Math.abs(a.ri - b.ri));
  if (lt > p.transition + 1e-6) notes.push({ level: 'info', key: 'note.transitionStretched', vars: { lt: round1(lt) } });

  // A lead-in chamfer on the mating surface of each open end eases assembly.
  const c = Math.min(p.chamfer, p.wall * 0.5, p.len1 / 2, p.len2 / 2);
  const c1 = p.fit1 === 'inside' ? [c, 0] : [0, c];
  const c2 = p.fit2 === 'inside' ? [c, 0] : [0, c];

  // End 1 stands on the bed, z grows towards end 2.
  const outerA = sleeveOuter(a.ro, p.len1, p.barbs1 && p.fit1 === 'inside', p.wall, c1[0]);
  const innerA: RZ[] = [[a.ri, p.len1], [a.ri, c1[1]], [a.ri + c1[1], 0]];
  const topB = lt + p.len2;
  const outerB: RZ[] = [
    [a.ro, 0],
    ...sleeveOuter(b.ro, p.len2, p.barbs2 && p.fit2 === 'inside', p.wall, c2[0])
      .map(([rad, z]): RZ => [rad, topB - z])
      .reverse(),
  ];
  const innerB: RZ[] = [[b.ri + c2[1], topB], [b.ri, topB - c2[1]], [b.ri, lt], [a.ri, 0]];

  let shape: Shape3D;
  if (p.angle <= 0) {
    yield { label: 'stage.end1', parts: [{ name: 'adapter', shape: revolve([...outerA, ...innerA]) }] };
    shape = revolve([...outerA, ...shift(outerB, p.len1), ...shift(innerB, p.len1), ...innerA]);
  } else {
    const R = Math.max(p.bendRadius, a.ro + 1);
    if (R > p.bendRadius) notes.push({ level: 'info', key: 'note.bendRadiusRaised', vars: { r: round1(R) } });
    const centre: [number, number, number] = [R, 0, p.len1];
    const sweep = (rad: number) =>
      (drawCircle(rad).sketchOnPlane('XY', p.len1) as Sketch).revolve([0, 1, 0], { origin: centre, angle: p.angle }) as Shape3D;

    shape = revolve([...outerA, ...innerA]);
    yield { label: 'stage.end1', parts: [{ name: 'adapter', shape }] };

    shape = shape.fuse(sweep(a.ro).cut(sweep(a.ri))) as Shape3D;
    yield { label: 'stage.bend', parts: [{ name: 'adapter', shape }] };

    const end2 = revolve([...outerB, ...innerB]).translate(0, 0, p.len1).rotate(p.angle, centre, [0, 1, 0]);
    shape = shape.fuse(end2) as Shape3D;
    notes.push({ level: 'info', key: 'note.bendNeedsSupport' });
  }

  // The entered diameter always stays the mating surface; the wall grows away from it.
  for (const [n, fit, d, e] of [[1, p.fit1, p.d1, a], [2, p.fit2, p.d2, b]] as const) {
    notes.push({
      level: 'info',
      key: `note.adapterEnd.${fit}`,
      vars: { n, d: round1(d), id: round2(e.ri * 2), od: round2(e.ro * 2) },
    });
  }
  const parts = [{ name: 'adapter', shape }];
  yield { label: 'stage.end2', parts };
  return { parts, notes };
}
