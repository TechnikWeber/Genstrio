import { drawCircle, drawRoundedRectangle, makeCylinder, type Shape3D, type Sketch } from 'replicad';
import type { Note } from '../types';
import { cutAll, fuseAll, roundedBox, type Build, type Part } from './common';

type Side = 'front' | 'back' | 'left' | 'right';

export interface EnclosureParams {
  length: number;
  width: number;
  height: number;
  wall: number;
  cornerRadius: number;
  pcb: boolean;
  pcbLength: number;
  pcbWidth: number;
  holeInset: number;
  standoffHeight: number;
  pcbOffsetX: number;
  pcbOffsetY: number;
  screw: 'M2' | 'M2.5' | 'M3' | 'M4';
  lidScrews: boolean;
  clearance: number;
  port: 'none' | 'usbc' | 'microusb' | 'round';
  portSide: Side;
  portOffset: number;
  portHeight: number;
  portDiameter: number;
  vents: 'none' | 'lid' | 'sides' | 'both';
  ventWidth: number;
}

// d: nominal, pilot: self-tapping core hole, clear: through hole
const SCREWS = {
  M2: { d: 2, pilot: 1.6, clear: 2.4 },
  'M2.5': { d: 2.5, pilot: 2.1, clear: 2.9 },
  M3: { d: 3, pilot: 2.5, clear: 3.4 },
  M4: { d: 4, pilot: 3.3, clear: 4.5 },
};

const PORTS = {
  usbc: { w: 9.4, h: 3.6, r: 1.7 },
  microusb: { w: 8.2, h: 3.4, r: 1 },
};

const SIDE_ANGLE: Record<Side, number> = { front: 0, right: 90, back: 180, left: 270 };
const CORNERS: [number, number][] = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

export function* buildEnclosure(p: EnclosureParams): Build {
  const notes: Note[] = [];
  const L = p.length;
  const W = p.width;
  const H = p.height;
  const t = Math.min(p.wall, Math.min(L, W) / 4, H / 4);
  const r = Math.min(p.cornerRadius, Math.min(L, W) / 2 - 0.5);
  const hb = H - t; // body height, the lid plate adds the rest
  const screw = SCREWS[p.screw];
  const clr = p.clearance;

  /**
   * A cutter through one side wall. `w` runs along the wall, `h` is vertical;
   * `along` is the world X (front/back) or Y (left/right) position of its centre.
   */
  const wallCutter = (w: number, h: number, rad: number, side: Side, along: number, zc: number): Shape3D => {
    const d = side === 'front' || side === 'back' ? W / 2 : L / 2;
    const drawing = rad >= Math.min(w, h) / 2 ? drawCircle(w / 2) : drawRoundedRectangle(w, h, rad);
    const local = side === 'back' || side === 'left' ? -along : along;
    return ((drawing.sketchOnPlane('XY', -1) as Sketch).extrude(t + 2) as Shape3D)
      .rotate(90, [0, 0, 0], [1, 0, 0])
      .translate(local, -d + t, zc)
      .rotate(SIDE_ANGLE[side], [0, 0, 0], [0, 0, 1]);
  };

  // --- body -----------------------------------------------------------------
  const outer = roundedBox(L, W, r, hb);
  yield { label: 'stage.outer', parts: [{ name: 'body', shape: outer }] };

  let body = outer.cut(roundedBox(L - 2 * t, W - 2 * t, r - t, hb, t)) as Shape3D;
  yield { label: 'stage.hollow', parts: [{ name: 'body', shape: body }] };

  // --- posts and standoffs --------------------------------------------------
  const postR = screw.d / 2 + 2;
  const postInset = t + postR * 0.7;
  const posts = CORNERS.map(([sx, sy]): [number, number] => [sx * (L / 2 - postInset), sy * (W / 2 - postInset)]);
  const adds: Shape3D[] = [];
  const cuts: Shape3D[] = [];

  if (p.lidScrews) {
    const solid = fuseAll(posts.map(([x, y]) => makeCylinder(postR, hb - t, [x, y, t]) as Shape3D));
    adds.push(solid.intersect(outer) as Shape3D);
    const depth = Math.max(1, Math.min(hb - t - 1, 12));
    for (const [x, y] of posts) cuts.push(makeCylinder(screw.pilot / 2, depth + 1, [x, y, hb - depth]) as Shape3D);
  }

  if (p.pcb) {
    const sr = screw.d / 2 + 1.5;
    const hx = p.pcbLength / 2 - p.holeInset;
    const hy = p.pcbWidth / 2 - p.holeInset;
    const sh = Math.min(p.standoffHeight, hb - t - 1);
    for (const [sx, sy] of CORNERS) {
      const x = p.pcbOffsetX + sx * hx;
      const y = p.pcbOffsetY + sy * hy;
      adds.push(makeCylinder(sr, sh, [x, y, t]) as Shape3D);
      cuts.push(makeCylinder(screw.pilot / 2, sh + 1, [x, y, t]) as Shape3D);
    }

    const freeX = L / 2 - t - Math.abs(p.pcbOffsetX) - p.pcbLength / 2;
    const freeY = W / 2 - t - Math.abs(p.pcbOffsetY) - p.pcbWidth / 2;
    if (freeX < 0 || freeY < 0) notes.push({ level: 'warn', key: 'note.pcbTooLarge' });
    else if (p.lidScrews && freeX < postR * 1.7 && freeY < postR * 1.7) notes.push({ level: 'warn', key: 'note.pcbHitsPosts' });
    if (hx <= sr || hy <= sr) notes.push({ level: 'warn', key: 'note.standoffsOverlap' });
  }

  if (adds.length) {
    body = body.fuse(fuseAll(adds)) as Shape3D;
    yield { label: 'stage.mounts', parts: [{ name: 'body', shape: body }] };
  }

  // --- cutouts --------------------------------------------------------------
  const lipH = Math.min(3, hb - t - 1);
  const lipW = Math.max(1.2, t * 0.8);
  let portAlong: number | null = null;
  let portW = 0;

  if (p.port !== 'none') {
    const shape = p.port === 'round' ? { w: p.portDiameter, h: p.portDiameter, r: p.portDiameter } : PORTS[p.port];
    const zc = t + p.portHeight;
    if (zc + shape.h / 2 > hb - 1 || zc - shape.h / 2 < t) notes.push({ level: 'warn', key: 'note.portOutside' });
    cuts.push(wallCutter(shape.w, shape.h, shape.r, p.portSide, p.portOffset, zc));
    portAlong = p.portOffset;
    portW = shape.w;
  }

  const sw = p.ventWidth;
  const pitch = sw * 2.2;
  const edge = (p.lidScrews ? postInset + postR : t) + 3;

  if (p.vents === 'sides' || p.vents === 'both') {
    const zTop = hb - lipH - 1.5;
    const zBot = Math.max(t + 2, zTop - (hb - t) * 0.5);
    const n = Math.floor((W - 2 * edge + pitch - sw) / pitch);
    if (zTop - zBot < sw * 1.5 || n < 1) notes.push({ level: 'warn', key: 'note.noRoomSideVents' });
    else {
      for (const side of ['left', 'right'] as Side[]) {
        for (let i = 0; i < n; i++) {
          const y = (i - (n - 1) / 2) * pitch;
          if (side === p.portSide && portAlong !== null && Math.abs(y - portAlong) < portW / 2 + sw / 2 + 2) continue;
          cuts.push(wallCutter(sw, zTop - zBot, sw / 2, side, y, (zTop + zBot) / 2));
        }
      }
    }
  }

  if (cuts.length) {
    body = cutAll(body, cuts);
    yield { label: 'stage.cutouts', parts: [{ name: 'body', shape: body }] };
  }

  // --- lid (printed upside down: plate on the bed, lip pointing up) --------
  let lid = roundedBox(L, W, r, t);
  const lipL = L - 2 * t - 2 * clr;
  const lipD = W - 2 * t - 2 * clr;
  if (lipH >= 1 && Math.min(lipL, lipD) - 2 * lipW > 2) {
    let lip = roundedBox(lipL, lipD, r - t - clr, lipH, t).cut(
      roundedBox(lipL - 2 * lipW, lipD - 2 * lipW, r - t - clr - lipW, lipH + 1, t),
    ) as Shape3D;
    if (p.lidScrews) {
      lip = cutAll(lip, posts.map(([x, y]) => makeCylinder(postR + clr + 0.3, lipH + 1, [x, y, t]) as Shape3D));
    }
    lid = lid.fuse(lip) as Shape3D;
  }

  const lidCuts: Shape3D[] = [];
  if (p.lidScrews) {
    for (const [x, y] of posts) lidCuts.push(makeCylinder(screw.clear / 2, t + 2, [x, y, -1]) as Shape3D);
  }
  if (p.vents === 'lid' || p.vents === 'both') {
    const margin = edge + lipW + clr;
    const n = Math.floor((L - 2 * margin + pitch - sw) / pitch);
    const slotLen = Math.min(W * 0.6, W - 2 * (t + lipW + clr + 3));
    if (n < 1 || slotLen < sw * 1.5) notes.push({ level: 'warn', key: 'note.noRoomLidVents' });
    else {
      const slot = drawRoundedRectangle(sw, slotLen, sw / 2 - 0.01);
      for (let i = 0; i < n; i++) {
        const x = (i - (n - 1) / 2) * pitch;
        lidCuts.push(((slot.sketchOnPlane('XY', -1) as Sketch).extrude(t + 2) as Shape3D).translate(x, 0, 0));
      }
    }
  }
  lid = cutAll(lid, lidCuts).translate(L + 10, 0, 0);

  const parts: Part[] = [
    { name: 'body', shape: body },
    { name: 'lid', shape: lid },
  ];
  yield { label: 'stage.lid', parts };

  if (p.lidScrews) notes.push({ level: 'info', key: 'note.lidScrews', vars: { screw: p.screw } });
  if (p.pcb) notes.push({ level: 'info', key: 'note.pcbScrews', vars: { screw: p.screw } });
  notes.push({ level: 'info', key: 'note.innerSize', vars: { l: fmt(L - 2 * t), w: fmt(W - 2 * t), h: fmt(hb - t) } });
  return { parts, notes };
}

const fmt = (n: number) => String(Math.round(n * 10) / 10);
