import { drawCircle, makeCylinder, type Shape3D, type Sketch } from 'replicad';
import { FITTINGS } from '../fittings';
import type { Note } from '../types';
import { cutAll, ParamError, revolveZ as revolve, round1, threadCam, threadDepth, type Build, type RZ } from './common';

type Fit = 'inside' | 'over';
type Vec3 = [number, number, number];

export interface AdapterParams {
  std1: string;
  d1: number;
  fit1: Fit;
  len1: number;
  barbs1: boolean;
  barbCount1: number;
  barbHeight1: number;
  barbPitch1: number;
  std2: string;
  d2: number;
  fit2: Fit;
  len2: number;
  barbs2: boolean;
  barbCount2: number;
  barbHeight2: number;
  barbPitch2: number;
  wall: number;
  transition: number;
  clearance: number;
  chamfer: number;
  angle: number;
  bendRadius: number;
  flange: 'none' | 'end1' | 'between';
  flangeDiameter: number;
  flangeThickness: number;
  flangeHoles: number;
  flangeHoleDiameter: number;
}

interface End {
  /** `inside`: plugs into the pipe; `over`: slides over it; `male`/`female`: threaded. */
  kind: Fit | 'male' | 'female';
  /** Nominal diameter of the mating part. */
  d: number;
  ri: number;
  ro: number;
  thread?: { rMajor: number; pitch: number };
}

/** Radii of one end, from a standard size or from the diameter and fit entered by hand. */
function resolveEnd(std: string, d: number, fit: Fit, wall: number, clr: number): End {
  const known = FITTINGS[std];
  let end: End;
  if (known?.thread) {
    const { pitch, male } = known.thread;
    // Printed threads bind easily, so the male one is made a little slimmer and the female one wider.
    const rMajor = known.d / 2 + (male ? -0.15 : 0.2);
    const rMinor = rMajor - threadDepth(pitch);
    // The plain sleeve stays just clear of the thread surface: where the two would touch along a helix, the kernel chokes.
    end = male
      ? { kind: 'male', d: known.d, ro: rMinor - 0.1, ri: rMinor - wall, thread: { rMajor, pitch } }
      : { kind: 'female', d: known.d, ri: rMinor - 0.1, ro: rMajor + wall, thread: { rMajor, pitch } };
  } else {
    const dd = known?.d ?? d;
    const kind = known?.fit ?? fit;
    end = kind === 'inside' ? { kind, d: dd, ro: (dd - clr) / 2, ri: (dd - clr) / 2 - wall } : { kind, d: dd, ri: (dd + clr) / 2, ro: (dd + clr) / 2 + wall };
  }
  if (end.ri < 0.5) throw new ParamError('err.adapterNoBore');
  return end;
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

/**
 * Turns a plain sleeve into a thread; the open end is at z = 0, the part lies towards +z.
 * A male thread is added around the sleeve, a female one is cut out of it.
 */
function threadOf(end: End, len: number): { add?: Shape3D; cut?: Shape3D } {
  if (!end.thread) return {};
  const { rMajor, pitch } = end.thread;
  if (end.kind === 'female') return { cut: threadCam(rMajor, pitch, len - 1) };
  return { add: threadCam(rMajor, pitch, len, 0).cut(makeCylinder(end.ri, len + 2, [0, 0, -1]) as Shape3D) as Shape3D };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const shift = (pts: RZ[], dz: number): RZ[] => pts.map(([rad, z]) => [rad, z + dz]);

export function* buildAdapter(p: AdapterParams): Build {
  const notes: Note[] = [];
  const a = resolveEnd(p.std1, p.d1, p.fit1, p.wall, p.clearance);
  const b = resolveEnd(p.std2, p.d2, p.fit2, p.wall, p.clearance);

  // A cone steeper than 45° gets thin walls and needs support, so stretch it.
  const lt = Math.max(p.transition, Math.abs(a.ro - b.ro), Math.abs(a.ri - b.ri));
  if (lt > p.transition + 1e-6) notes.push({ level: 'info', key: 'note.transitionStretched', vars: { lt: round1(lt) } });

  // A lead-in chamfer on the mating surface of each open end eases assembly.
  const c = Math.min(p.chamfer, p.wall * 0.5, p.len1 / 2, p.len2 / 2);
  const outside = (end: End) => end.kind === 'inside';
  // No outer chamfer where a flange sits flush on the bed.
  const chamfers = (end: End, flush: boolean) => (end.thread ? [0, 0] : outside(end) ? [flush ? 0 : c, 0] : [0, c]);
  const c1 = chamfers(a, p.flange === 'end1');
  const c2 = chamfers(b, false);

  const barbsFor = (n: number, end: End, on: boolean, len: number, count: number, height: number, pitch: number): Barbs | null => {
    if (!on || end.kind !== 'inside') return null;
    const fits = Math.min(Math.round(count), Math.floor((len - 2.5) / pitch));
    if (fits < 1) return null;
    notes.push({ level: 'info', key: 'note.barbs', vars: { n, count: fits, d: round2(2 * end.ro), peak: round2(2 * (end.ro + height)) } });
    return { count: fits, height, pitch };
  };

  // End 1 stands on the bed, z grows towards end 2.
  const outerA = sleeveOuter(a.ro, p.len1, barbsFor(1, a, p.barbs1, p.len1, p.barbCount1, p.barbHeight1, p.barbPitch1), c1[0]);
  const innerA: RZ[] = [[a.ri, p.len1], [a.ri, c1[1]], [a.ri + c1[1], 0]];
  const topB = lt + p.len2;
  const outerB: RZ[] = [
    [a.ro, 0],
    ...sleeveOuter(b.ro, p.len2, barbsFor(2, b, p.barbs2, p.len2, p.barbCount2, p.barbHeight2, p.barbPitch2), c2[0])
      .map(([rad, z]): RZ => [rad, topB - z])
      .reverse(),
  ];
  const innerB: RZ[] = [[b.ri + c2[1], topB], [b.ri, topB - c2[1]], [b.ri, lt], [a.ri, 0]];

  // Turns something modelled at an upright end 2 (open end up at z = len1 + topB) into the elbow.
  let bend = (shape: Shape3D) => shape;
  let shape: Shape3D;
  if (p.angle <= 0) {
    yield { label: 'stage.end1', parts: [{ name: 'adapter', shape: revolve([...outerA, ...innerA]) }] };
    shape = revolve([...outerA, ...shift(outerB, p.len1), ...shift(innerB, p.len1), ...innerA]);
  } else {
    const R = Math.max(p.bendRadius, a.ro + 1);
    if (R > p.bendRadius) notes.push({ level: 'info', key: 'note.bendRadiusRaised', vars: { r: round1(R) } });
    const centre: Vec3 = [R, 0, p.len1];
    bend = (part) => part.rotate(p.angle, centre, [0, 1, 0]);
    const sweep = (rad: number) =>
      (drawCircle(rad).sketchOnPlane('XY', p.len1) as Sketch).revolve([0, 1, 0], { origin: centre, angle: p.angle }) as Shape3D;

    shape = revolve([...outerA, ...innerA]);
    yield { label: 'stage.end1', parts: [{ name: 'adapter', shape }] };

    shape = shape.fuse(sweep(a.ro).cut(sweep(a.ri))) as Shape3D;
    yield { label: 'stage.bend', parts: [{ name: 'adapter', shape }] };

    shape = shape.fuse(bend(revolve([...outerB, ...innerB]).translate(0, 0, p.len1))) as Shape3D;
    notes.push({ level: 'info', key: 'note.bendNeedsSupport' });
  }

  const upright = (part: Shape3D) => bend(part.rotate(180, [0, 0, 0], [1, 0, 0]).translate(0, 0, p.len1 + topB));
  const thread1 = threadOf(a, p.len1);
  const thread2 = threadOf(b, p.len2);
  for (const part of [thread1.add, thread2.add && upright(thread2.add)]) if (part) shape = shape.fuse(part) as Shape3D;
  for (const part of [thread1.cut, thread2.cut && upright(thread2.cut)]) if (part) shape = shape.cut(part) as Shape3D;

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
  for (const [n, e] of [[1, a], [2, b]] as const) {
    const vars: Record<string, number> = e.thread ? { n, d: round2(e.d), pitch: round2(e.thread.pitch) } : { n, d: round1(e.d), id: round2(e.ri * 2), od: round2(e.ro * 2) };
    notes.push({ level: 'info', key: `note.adapterEnd.${e.kind}`, vars });
  }
  if (a.thread || b.thread) notes.push({ level: 'info', key: 'note.threadSlow' });
  const parts = [{ name: 'adapter', shape }];
  yield { label: 'stage.end2', parts };
  return { parts, notes };
}
