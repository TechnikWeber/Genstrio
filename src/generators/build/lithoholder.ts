// What a lithophane stands on or hangs from. Unlike the picture itself these
// are plain solids, built by the CAD kernel.
import { drawCircle, type Shape3D } from 'replicad';
import { cutAll, fuseAll, ParamError, prism, regionsSolid, roundedRect } from './common';
import type { Pt } from './trace';

export interface StandParams {
  form: 'flat' | 'arc';
  /** Width of the lithophane, along its back if it is bent. */
  width: number;
  /** Radius of its back, for an arc. */
  radius: number;
  /** Angle of the arc in degrees. */
  angle: number;
  /** Thickness of its frame, which is what stands in the slot. */
  foot: number;
  light: boolean;
  lightDiameter: number;
  lightThickness: number;
  lightTilt: number;
  lightDistance: number;
}

const PLATE = 2.4;
const RIB = 3;
const RIB_HEIGHT = 5;
const SLACK = 0.3;

/** A strip that follows the lithophane: between two radii of its arc, or between two distances from its back if it is flat. */
function strip(p: StandParams, from: number, to: number): Pt[] {
  if (p.form === 'flat') return [[-p.width / 2, -to], [p.width / 2, -to], [p.width / 2, -from], [-p.width / 2, -from]];
  const half = ((p.angle / 2) * Math.PI) / 180;
  const steps = Math.max(4, Math.ceil(p.angle / 4));
  const at = (r: number, k: number): Pt => {
    const phi = -half + (2 * half * k) / steps;
    return [(p.radius + r) * Math.sin(phi), p.radius - (p.radius + r) * Math.cos(phi)];
  };
  const points: Pt[] = [];
  for (let k = 0; k <= steps; k++) points.push(at(to, k));
  for (let k = steps; k >= 0; k--) points.push(at(from, k));
  return points;
}

/**
 * A base with a slot the lithophane stands in and, if wanted, a seat behind it
 * for a small battery light, tilted back so the light leans in it and shines
 * on the picture. Built with its plate on z = 0, the lithophane's back at y = 0.
 */
export function buildStand(p: StandParams): { shape: Shape3D; plate: number } {
  if (p.form === 'arc' && p.radius < RIB + SLACK + 6) throw new ParamError('err.lithoStand');
  // One rib in front of the lithophane, one behind; distances are measured from its back, forwards.
  const ribs = [strip(p, p.foot + SLACK, p.foot + SLACK + RIB), strip(p, -SLACK - RIB, -SLACK)];
  const solids: Shape3D[] = ribs.map((outline) => regionsSolid([{ outer: outline, holes: [] }], RIB_HEIGHT + 0.2, PLATE - 0.2));
  const footprint: Pt[] = ribs.flat();

  const cuts: Shape3D[] = [];
  if (p.light) {
    const d = p.lightDiameter;
    const t = p.lightThickness;
    const tilt = (p.lightTilt * Math.PI) / 180;
    const y = p.lightDistance;
    const high = Math.min(30, Math.max(12, d * 0.3));
    const front = y - t / 2 - 4;
    const back = y + t / 2 + 4 + high * Math.tan(tilt);
    const wide = Math.max(24, d * 0.7);
    // Low in front, where the light shines out; high behind, where it leans.
    solids.push(prism(roundedRect(wide, y - front + 0.2, 0).translate(0, (front + y + 0.2) / 2), 8.2, PLATE - 0.2));
    solids.push(prism(roundedRect(wide, back - y, 0).translate(0, (y + back) / 2), high + 0.2, PLATE - 0.2));
    footprint.push([-wide / 2, front], [wide / 2, back]);
    // The light itself: a disc on its edge, leaning back.
    const centre = PLATE + 2 + (d / 2) * Math.cos(tilt) + (t / 2) * Math.sin(tilt);
    cuts.push(
      prism(drawCircle(d / 2 + 0.4), t + 0.8, -(t + 0.8) / 2)
        .rotate(90 - p.lightTilt, [0, 0, 0], [1, 0, 0])
        .translate([0, y, centre]) as Shape3D,
    );
  }

  const xs = footprint.map(([x]) => x);
  const ys = footprint.map(([, y]) => y);
  const [x0, x1, y0, y1] = [Math.min(...xs) - 3, Math.max(...xs) + 3, Math.min(...ys) - 3, Math.max(...ys) + 3];
  const plate = prism(roundedRect(x1 - x0, y1 - y0, 4).translate((x0 + x1) / 2, (y0 + y1) / 2), PLATE);
  return { shape: cutAll(fuseAll([plate, ...solids]), cuts), plate: PLATE };
}

/** The opening a lamp holder passes through before its ring is screwed on, by socket. */
export const LAMP_HOLES = { e27: 40.5, e14: 28.5 };

/**
 * A lid for a cylindrical lithophane with the hole for a lamp holder: a
 * flange that rests on the rim and a collar that sits inside it. It prints
 * flange down; vents let the warmth out.
 */
export function buildMount(socket: keyof typeof LAMP_HOLES, outer: number, inner: number): Shape3D {
  const hole = LAMP_HOLES[socket] / 2;
  const collar = inner - 0.25;
  if (collar < hole + 5) throw new ParamError('err.lithoMount');
  let mount = prism(drawCircle(outer), 2).fuse(prism(drawCircle(collar), 5.2, 1.8).cut(prism(drawCircle(Math.max(hole + 3, collar - 2.4)), 7, 2))) as Shape3D;
  const tools = [prism(drawCircle(hole), 10, -1)];
  const room = collar - 2.4 - (hole + 4);
  if (room >= 6) {
    const at = hole + 4 + room / 2;
    const count = Math.max(3, Math.floor((2 * Math.PI * at) / (room + 4)));
    for (let k = 0; k < count; k++) tools.push(prism(drawCircle(room / 2 - 1).translate(at * Math.cos((2 * Math.PI * k) / count), at * Math.sin((2 * Math.PI * k) / count)), 6, -1));
  }
  mount = cutAll(mount, tools);
  return mount;
}

