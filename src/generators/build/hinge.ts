import { drawCircle, makeCompound, type Shape3D } from 'replicad';
import type { Note } from '../types';
import { cutAll, fuseAll, ParamError, prism, regionsSolid, revolveZ, round1, roundedRect, type Build, type Part, type RZ } from './common';
import type { Pt } from './trace';

export interface HingeParams {
  type: 'hinge' | 'bolt';
  length: number;
  leafWidth: number;
  thickness: number;
  barrel: number;
  knuckles: number;
  clearance: number;
  holes: number;
  holeDiameter: number;
  countersunk: boolean;
  boltWidth: number;
  boltHeight: number;
  throw: number;
  keeper: boolean;
}

/** Something revolved about Z, laid along the X axis instead. */
const alongX = (points: RZ[]): Shape3D => revolveZ(points).rotate(90, [0, 0, 0], [0, 1, 0]) as Shape3D;

/** A profile in the Y–Z plane, drawn out along X from x0. */
const extrudeX = (profile: Pt[], x0: number, length: number): Shape3D => regionsSolid([{ outer: profile, holes: [] }], length, x0).rotate(120, [0, 0, 0], [1, 1, 1]) as Shape3D;

/** A screw hole down through a plate whose top is at z = top, optionally countersunk: one tool, turned in one piece. */
function screwHole(x: number, y: number, d: number, top: number, countersunk: boolean): Shape3D {
  const profile: RZ[] = countersunk ? [[0, -1], [d / 2, -1], [d / 2, top - d / 2], [d, top + 0.01], [0, top + 0.01]] : [[0, -1], [d / 2, -1], [d / 2, top + 1], [0, top + 1]];
  return revolveZ(profile).translate([x, y, 0]) as Shape3D;
}

/**
 * A hinge that prints assembled, lying open on the bed. Its knuckles hold on
 * to each other by cones that reach into the next knuckle: at 45° they print
 * without support, and nothing has to be bridged the way a pin would.
 */
function buildHinge(p: HingeParams): { parts: Part[]; notes: Note[] } {
  const R = p.barrel / 2;
  const t = Math.min(p.thickness, p.barrel);
  const c = p.clearance;
  const n = p.knuckles;
  const L = p.length;
  const cone = R - 1;
  if (cone < 1.2) throw new ParamError('err.hingeSmall');
  const seg = L / n;
  if (seg - c < cone + 2) throw new ParamError('err.hingeKnuckles');
  // The hollow that takes a cone: the cone itself, moved on by the gap and widened by the clearance.
  const socket = cone - c + c * Math.SQRT2;

  const leaves: Shape3D[][] = [[], []];
  const sockets: Shape3D[][] = [[], []];
  for (let k = 0; k < n; k++) {
    const x0 = -L / 2 + k * seg + (k > 0 ? c / 2 : 0);
    const x1 = -L / 2 + (k + 1) * seg - (k < n - 1 ? c / 2 : 0);
    const side = k % 2;
    const body: RZ[] = [[0, x0], [R, x0], [R, x1]];
    if (k < n - 1) body.push([cone, x1], [0, x1 + cone]);
    else body.push([0, x1]);
    leaves[side].push(alongX(body).translate([0, 0, R]) as Shape3D);
    // The web that ties the knuckle to its leaf
    const y = side === 0 ? -(R + c + 0.2) / 2 : (R + c + 0.2) / 2;
    leaves[side].push(prism(roundedRect(x1 - x0, R + c + 0.2, 0).translate((x0 + x1) / 2, y), t));
    if (k > 0) sockets[side].push(alongX([[0, x0 - 0.01], [socket, x0 - 0.01], [0, x0 + socket]]).translate([0, 0, R]) as Shape3D);
  }

  const width = p.leafWidth - c;
  const solids = [0, 1].map((side) => {
    const sign = side === 0 ? -1 : 1;
    const centre = sign * (R + c + width / 2);
    let leaf = fuseAll([prism(roundedRect(L, width, 0).translate(0, centre), t), ...leaves[side]]);
    const holes: Shape3D[] = [];
    for (let i = 0; i < p.holes; i++) holes.push(screwHole(-L / 2 + (L * (i + 0.5)) / p.holes, centre, p.holeDiameter, t, p.countersunk));
    leaf = cutAll(leaf, [...sockets[side], ...holes]);
    return leaf;
  });
  const notes: Note[] = [
    { level: 'info', key: 'note.hingeSize', vars: { l: round1(L), w: round1(2 * (R + p.leafWidth)), h: round1(Math.max(2 * R, t)) } },
    { level: 'info', key: 'note.printInPlace' },
  ];
  if (c < 0.25) notes.push({ level: 'info', key: 'note.tightFit' });
  return { parts: [{ name: 'hinge', shape: makeCompound(solids) as Shape3D }], notes };
}

// The sides of bolt and channel lean in by this much per unit of height: 30° off the vertical prints without support.
const LEAN = Math.tan(Math.PI / 6);
const ROOF = 1.6;
const BACK = 3;

/**
 * A sliding bolt that prints assembled. The bolt lies on the bed in a channel
 * that is open underneath and narrows towards the top, so it cannot lift
 * out; screwed down, the door closes the channel from below.
 */
function buildBolt(p: HingeParams): { parts: Part[]; notes: Note[] } {
  const c = p.clearance;
  const L = p.length;
  const hb = p.boltHeight;
  const wb = p.boltWidth;
  const top = wb - 2 * LEAN * hb;
  if (top < 4) throw new ParamError('err.boltNarrow');
  const knob = Math.min(8, top);
  const slot = knob + p.throw + 2 * c;
  if (L < BACK + 3 + slot + 4) throw new ParamError('err.boltShort');
  const hc = hb + c;
  const H = hc + ROOF;
  const rail = p.holes > 0 ? Math.max(8, p.holeDiameter * 2.2) : 4;
  const W = wb + 2 * c + 2 * rail;
  const channel = (x0: number, length: number) => extrudeX([[-wb / 2 - c, -1], [wb / 2 + c, -1], [wb / 2 + c, 0], [wb / 2 + c - LEAN * hc, hc], [-wb / 2 - c + LEAN * hc, hc], [-wb / 2 - c, 0]], x0, length);
  const holesAt = (x0: number, length: number, count: number) => {
    const tools: Shape3D[] = [];
    for (let i = 0; i < count; i++) for (const sign of [-1, 1]) tools.push(screwHole(x0 + (length * (i + 0.5)) / count, sign * (W / 2 - rail / 2), p.holeDiameter, H, p.countersunk));
    return tools;
  };

  const slotAt = -L / 2 + BACK + 3;
  // Channel and slot run into each other, so they are cut one after the other rather than as one tool.
  const housing = cutAll(
    prism(roundedRect(L, W, 2), H)
      .cut(channel(-L / 2 + BACK, L))
      .cut(prism(roundedRect(slot, knob + 2 * c, knob / 2 + c - 0.01).translate(slotAt + slot / 2, 0), ROOF + 2, hc - 1)) as Shape3D,
    holesAt(-L / 2, L, p.holes),
  );
  const start = -L / 2 + BACK + c;
  const bolt = extrudeX([[-wb / 2, 0], [wb / 2, 0], [wb / 2 - LEAN * hb, hb], [-wb / 2 + LEAN * hb, hb]], start, L / 2 - start).fuse(
    prism(drawCircle(knob / 2).translate(slotAt + c + knob / 2, 0), H + 6 - hb + 0.2, hb - 0.2),
  ) as Shape3D;

  const parts: Part[] = [{ name: 'bolt', shape: makeCompound([housing, bolt]) as Shape3D }];
  if (p.keeper) {
    const length = p.throw + 4;
    const x0 = L / 2 + 2;
    const keeper = cutAll(prism(roundedRect(length, W, 2).translate(x0 + length / 2, 0), H).cut(channel(x0 - 1, length + 2)) as Shape3D, holesAt(x0, length, Math.min(1, p.holes)));
    parts.push({ name: 'keeper', shape: keeper });
  }
  const notes: Note[] = [
    { level: 'info', key: 'note.boltSize', vars: { l: round1(L), w: round1(W), h: round1(H), t: round1(p.throw) } },
    { level: 'info', key: 'note.printInPlace' },
  ];
  if (c < 0.3) notes.push({ level: 'info', key: 'note.tightFit' });
  return { parts, notes };
}

export function* buildHingeGenerator(p: HingeParams): Build {
  return p.type === 'bolt' ? buildBolt(p) : buildHinge(p);
}
