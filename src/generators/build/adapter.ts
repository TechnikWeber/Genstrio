import { drawCircle, makeCylinder, type Shape3D, type Sketch } from 'replicad';
import type { Note } from '../types';
import { cutAll, ParamError, revolveZ as revolve, round1, type Build, type RZ } from './common';

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
  barbCount: number;
  barbHeight: number;
  barbPitch: number;
  flange: 'none' | 'end1' | 'between';
  flangeDiameter: number;
  flangeThickness: number;
  flangeHoles: number;
  flangeHoleDiameter: number;
}

/** Radii of one end. `inside`: the adapter plugs into the pipe; `over`: it slides over it. */
function endRadii(d: number, fit: Fit, wall: number, clr: number) {
  const radii = fit === 'inside' ? { ro: (d - clr) / 2, ri: (d - clr) / 2 - wall } : { ri: (d + clr) / 2, ro: (d + clr) / 2 + wall };
  if (radii.ri < 0.5) throw new ParamError('err.adapterNoBore');
  return radii;
}

interface Barbs {
  count: number;
  height: number;
  pitch: number;
}

/**
 * Outer contour of a sleeve, z measured from its open end. Barbs grip against
 * pulling off; they sit on top of the sleeve, whose own diameter stays as entered.
 */
function sleeveOuter(ro: number, len: number, barbs: Barbs | null, chamfer = 0): RZ[] {
  const c = barbs ? Math.min(chamfer, 1.5) : chamfer;
  const pts: RZ[] = [[ro - c, 0], [ro, c]];
  if (barbs) {
    const lead = 2;
    for (let i = 0; i < barbs.count; i++) {
      const z = lead + i * barbs.pitch;
      pts.push([ro, z], [ro + barbs.height, z + barbs.pitch], [ro, z + barbs.pitch]);
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
  // No outer chamfer where a flange sits flush on the bed.
  const c1 = p.fit1 === 'inside' ? [p.flange === 'end1' ? 0 : c, 0] : [0, c];
  const c2 = p.fit2 === 'inside' ? [c, 0] : [0, c];

  const barbsFor = (n: number, on: boolean, fit: Fit, len: number, ro: number): Barbs | null => {
    if (!on || fit !== 'inside') return null;
    const count = Math.min(Math.round(p.barbCount), Math.floor((len - 2.5) / p.barbPitch));
    if (count < 1) return null;
    notes.push({ level: 'info', key: 'note.barbs', vars: { n, count, d: round2(2 * ro), peak: round2(2 * (ro + p.barbHeight)) } });
    return { count, height: p.barbHeight, pitch: p.barbPitch };
  };

  // End 1 stands on the bed, z grows towards end 2.
  const outerA = sleeveOuter(a.ro, p.len1, barbsFor(1, p.barbs1, p.fit1, p.len1, a.ro), c1[0]);
  const innerA: RZ[] = [[a.ri, p.len1], [a.ri, c1[1]], [a.ri + c1[1], 0]];
  const topB = lt + p.len2;
  const outerB: RZ[] = [
    [a.ro, 0],
    ...sleeveOuter(b.ro, p.len2, barbsFor(2, p.barbs2, p.fit2, p.len2, b.ro), c2[0])
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

  if (p.flange !== 'none') {
    const th = Math.min(p.flangeThickness, p.len1);
    const z0 = p.flange === 'end1' ? 0 : p.len1 - th;
    const R = Math.max(p.flangeDiameter / 2, a.ro + 3);
    if (R > p.flangeDiameter / 2) notes.push({ level: 'info', key: 'note.flangeRaised', vars: { d: round1(2 * R) } });
    // Reaches slightly into the sleeve wall so the two fuse into one solid.
    let ring = (makeCylinder(R, th, [0, 0, z0]) as Shape3D).cut(makeCylinder(a.ro - Math.min(0.3, p.wall / 2), th + 2, [0, 0, z0 - 1]) as Shape3D) as Shape3D;
    const n = Math.round(p.flangeHoles);
    const hr = p.flangeHoleDiameter / 2;
    if (n > 0 && R - a.ro < 2 * hr + 3) notes.push({ level: 'warn', key: 'note.flangeNoRoomHoles' });
    else if (n > 0) {
      const circle = (a.ro + R) / 2;
      const spacing = (2 * Math.PI * circle) / n;
      if (spacing < 2 * hr + 1.5) notes.push({ level: 'warn', key: 'note.flangeNoRoomHoles' });
      else {
        ring = cutAll(
          ring,
          Array.from({ length: n }, (_, i) => {
            const ang = (2 * Math.PI * (i + 0.5)) / n;
            return makeCylinder(hr, th + 2, [circle * Math.cos(ang), circle * Math.sin(ang), z0 - 1]) as Shape3D;
          }),
        );
        notes.push({ level: 'info', key: 'note.flangeHoles', vars: { n, d: round1(2 * circle) } });
      }
    }
    shape = shape.fuse(ring) as Shape3D;
    if (p.flange === 'between') notes.push({ level: 'info', key: 'note.flangeNeedsSupport' });
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
