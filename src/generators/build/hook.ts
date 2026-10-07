import { draw, makeBaseBox, makeCylinder, type Drawing, type Shape3D, type Sketch } from 'replicad';
import type { Note } from '../types';
import { cutAll, fuseAll, revolveZ, round1, roundedBox, type Build } from './common';

export interface HookParams {
  type: 'hook' | 'cradle' | 'clip' | 'bracket';
  clipOpening: number;
  width: number;
  thickness: number;
  reach: number;
  tipHeight: number;
  angle: number;
  bend: number;
  diameter: number;
  rib: number;
  shelfHoles: number;
  plateHeight: number;
  plateThickness: number;
  mount: 'screws' | 'tape' | 'door' | 'pegboard';
  screwDiameter: number;
  screwCount: number;
  countersunk: boolean;
  doorThickness: number;
  doorLip: number;
  pegSpacing: number;
  pegSize: number;
  boardThickness: number;
  count: number;
  spacing: number;
}

type Pt = [number, number];
type Step = { line: number } | { turn: number; radius: number };

/**
 * Outline of a band of constant thickness that follows straight runs and
 * bends, with a rounded end. `turn` is in degrees, positive to the left; its
 * radius is that of the centre line.
 */
function stroke(start: Pt, heading: number, t: number, steps: Step[]): Drawing {
  let [x, y] = start;
  let h = (heading * Math.PI) / 180;
  const side = (px: number, py: number, dir: number, s: number): Pt => [px - s * (t / 2) * Math.sin(dir), py + s * (t / 2) * Math.cos(dir)];
  // Per step and side: where it ends and, for a bend, a point on the way
  const left: { to: Pt; via?: Pt }[] = [];
  const right: { to: Pt; via?: Pt }[] = [];
  const first: [Pt, Pt] = [side(x, y, h, 1), side(x, y, h, -1)];
  for (const step of steps) {
    if ('line' in step) {
      if (step.line < 1e-6) continue;
      x += step.line * Math.cos(h);
      y += step.line * Math.sin(h);
      left.push({ to: side(x, y, h, 1) });
      right.push({ to: side(x, y, h, -1) });
    } else {
      const a = (step.turn * Math.PI) / 180;
      if (Math.abs(a) < 1e-6) continue;
      const s = Math.sign(a);
      const cx = x - s * step.radius * Math.sin(h);
      const cy = y + s * step.radius * Math.cos(h);
      const at = (dir: number): Pt => [cx + s * step.radius * Math.sin(dir), cy - s * step.radius * Math.cos(dir)];
      const [mx, my] = at(h + a / 2);
      [x, y] = at(h + a);
      left.push({ to: side(x, y, h + a, 1), via: side(mx, my, h + a / 2, 1) });
      right.push({ to: side(x, y, h + a, -1), via: side(mx, my, h + a / 2, -1) });
      h += a;
    }
  }
  let pen = draw(first[0]);
  for (const seg of left) pen = seg.via ? pen.threePointsArcTo(seg.to, seg.via) : pen.lineTo(seg.to);
  pen = pen.threePointsArcTo(right[right.length - 1].to, [x + (t / 2) * Math.cos(h), y + (t / 2) * Math.sin(h)]);
  for (let i = right.length - 1; i >= 0; i--) {
    const to = i ? right[i - 1].to : first[1];
    pen = right[i].via ? pen.threePointsArcTo(to, right[i].via!) : pen.lineTo(to);
  }
  return pen.close();
}

const polygon = (points: Pt[]): Drawing => {
  let pen = draw(points[0]);
  for (const pt of points.slice(1)) pen = pen.lineTo(pt);
  return pen.close();
};

/** Extrude a profile (x out from the wall, y up) along the width of the hook. */
const slab = (profile: Drawing, width: number, z = 0) => (profile.sketchOnPlane('XY', z) as Sketch).extrude(width) as Shape3D;

/** `n` positions spread evenly between a and b. */
const spread = (n: number, a: number, b: number) => Array.from({ length: n }, (_, i) => (n === 1 ? (a + b) / 2 : a + (i * (b - a)) / (n - 1)));

export function* buildHook(p: HookParams): Build {
  const notes: Note[] = [];
  const t = p.thickness;
  const tb = p.plateThickness;
  const w = p.width;
  const d = p.screwDiameter;
  // Several hooks share one plate; that only works on a plain wall.
  const count = p.type !== 'bracket' && (p.mount === 'screws' || p.mount === 'tape') ? Math.round(p.count) : 1;
  const rail = count > 1;

  // --- the arm, in profile: x out from the wall, y up, wall face at x = 0 -----
  let arm: Shape3D;
  let clearFrom: number; // screws go above this height …
  let clearTo: number; // … and below this one
  let plateH = p.plateHeight;
  // How much material a screw passes: the plate, and for a clip the back of its ring.
  let through = tb;
  if (p.type === 'hook') {
    const up = p.tipHeight > 0 ? 90 - p.angle : 0;
    const radius = p.bend + t / 2;
    arm = slab(stroke([tb / 2, t / 2], p.angle, t, [{ line: tb / 2 + p.reach }, { turn: up, radius }, { line: p.tipHeight > 0 ? Math.max(0, p.tipHeight - radius) : 0 }]), w);
    plateH = Math.max(plateH, t + 4);
    [clearFrom, clearTo] = [t, plateH];
    notes.push({ level: 'info', key: 'note.hookSize', vars: { reach: round1(p.reach), tip: round1(p.tipHeight) } });
  } else if (p.type === 'cradle') {
    // A U the item lies in; its inner circle touches the plate.
    const radius = p.diameter / 2 + t / 2;
    const centre = p.diameter / 2 + t;
    arm = slab(stroke([tb - t / 2, centre], -90, t, [{ turn: 180, radius }, { line: p.tipHeight }]), w);
    plateH = Math.max(plateH, centre + 4);
    [clearFrom, clearTo] = [centre, plateH];
    notes.push({ level: 'info', key: 'note.cradleSize', vars: { d: round1(p.diameter) } });
  } else if (p.type === 'clip') {
    // A ring, open at the front, that a pipe snaps into. Its back sinks a little into the plate.
    const radius = p.diameter / 2 + 0.15 + t / 2;
    const half = (p.clipOpening / 2) * (Math.PI / 180);
    plateH = Math.max(plateH, 2 * radius + t + 4);
    const cx = tb + radius + t / 2 - 0.6;
    const cy = plateH / 2;
    arm = slab(stroke([cx + radius * Math.cos(half), cy + radius * Math.sin(half)], p.clipOpening / 2 + 90, t, [{ turn: 360 - p.clipOpening, radius }]), w);
    // The screws go through the back of the ring, reached through its open front.
    through = tb + t - 0.6;
    [clearFrom, clearTo] = [cy - p.diameter / 2 - 1.5, cy + p.diameter / 2 + 1.5];
    notes.push({ level: 'info', key: 'note.clipSize', vars: { d: round1(p.diameter), g: round1((p.diameter + 0.3) * Math.sin(half)) } });
    if (p.clipOpening > 150) notes.push({ level: 'info', key: 'note.clipLoose' });
  } else {
    const end = tb + p.reach;
    plateH = Math.max(plateH, t + 10);
    const top = plateH;
    const lip = p.tipHeight;
    const shelf: Pt[] = [[tb / 2, top - t], [end, top - t], [end, top + lip], [end - t, top + lip], [end - t, top], [tb / 2, top]];
    const parts = [slab(polygon(lip > 0 ? shelf : [shelf[0], shelf[1], [end, top], shelf[5]]), w)];
    const ribT = Math.min(p.rib, w);
    const leg = Math.min(p.reach * 0.85, top - t - 1);
    if (ribT > 0 && leg > 3) parts.push(slab(polygon([[tb / 2, top - t / 2], [tb + p.reach * 0.85, top - t / 2], [tb + p.reach * 0.85, top - t], [tb, top - t - leg], [tb / 2, top - t - leg]]), ribT));
    arm = fuseAll(parts);
    [clearFrom, clearTo] = [0, top - t];
    notes.push({ level: 'info', key: 'note.bracketSize', vars: { reach: round1(p.reach) } });
  }
  // Nothing may reach into the wall.
  arm = arm.cut(makeBaseBox(400, 4000, 4 * w + 10).translate(-200, 0, -w)) as Shape3D;
  yield { label: 'stage.arm', parts: [{ name: 'hook', shape: arm }] };

  // --- the plate and how it is held ------------------------------------------
  const pegboard = p.mount === 'pegboard' && !rail;
  const door = p.mount === 'door' && !rail;
  const peg = p.pegSize;
  if (pegboard) plateH = Math.max(plateH, p.pegSpacing + peg + 4);
  const length = rail ? count * p.spacing : w;
  let body: Shape3D;
  if (door) {
    const back = -(p.doorThickness + tb);
    const over: Pt[] = [[0, 0], [tb, 0], [tb, plateH + tb], [back, plateH + tb], [back, plateH - p.doorLip], [-p.doorThickness, plateH - p.doorLip], [-p.doorThickness, plateH], [0, plateH]];
    body = slab(polygon(over), w);
    notes.push({ level: 'info', key: 'note.hookDoor', vars: { t: round1(p.doorThickness) } });
  } else if (rail) {
    // Rounded corners, seen from the front
    body = roundedBox(length, plateH, Math.min(4, plateH / 4), tb)
      .rotate(90, [0, 0, 0], [0, 1, 0])
      .translate(0, plateH / 2, length / 2) as Shape3D;
  } else {
    body = slab(polygon([[0, 0], [tb, 0], [tb, plateH], [0, plateH]]), w);
  }
  const arms = Array.from({ length: count }, (_, i) => (rail ? (arm.clone().translate(0, 0, (i + 0.5) * p.spacing - w / 2) as Shape3D) : arm));
  body = body.fuse(fuseAll(arms)) as Shape3D;

  if (pegboard) {
    // Square pegs print flat on the bed; the upper one hooks behind the board.
    const gap = p.boardThickness + 0.4;
    const top = plateH - 2;
    const pw = Math.min(peg, w);
    const upper: Pt[] = [[tb / 2, top - peg], [-(gap + peg), top - peg], [-(gap + peg), top + peg], [-gap, top + peg], [-gap, top], [tb / 2, top]];
    const low = top - p.pegSpacing;
    const lower: Pt[] = [[tb / 2, low - peg], [-gap * 0.9, low - peg], [-gap * 0.9, low], [tb / 2, low]];
    body = body.fuse(slab(polygon(upper), pw)).fuse(slab(polygon(lower), pw)) as Shape3D;
    notes.push({ level: 'info', key: 'note.hookPegboard', vars: { s: round1(p.pegSpacing), d: round1(peg * Math.SQRT2) } });
  }

  const cuts: Shape3D[] = [];
  // Screws sit beside the rib of a bracket, so a screwdriver reaches them.
  const ribT = p.type === 'bracket' ? Math.min(p.rib, w) : 0;
  const beside = ribT + (w - ribT) / 2;
  const room = w - ribT >= d + 3;
  if (p.mount === 'screws') {
    const n = Math.round(p.screwCount);
    const head = p.countersunk ? d : d / 2 + 1;
    const [lo, hi] = [clearFrom + head + 1.5, clearTo - head - 1.5];
    if (hi < lo || !room) notes.push({ level: 'warn', key: 'note.noRoomScrews' });
    else {
      const sink = p.countersunk ? Math.min(d / 2, through - 0.6) : 0;
      const tool = revolveZ([[0, -1], [d / 2, -1], [d / 2, through - sink], [d / 2 + sink, through], [d / 2 + sink, through + 0.5], [0, through + 0.5]]).rotate(90, [0, 0, 0], [0, 1, 0]) as Shape3D;
      const spots: [number, number][] = rail ? spread(n, p.spacing / 2, length - p.spacing / 2).map((z) => [(lo + hi) / 2, z]) : spread(n, lo, hi).map((y) => [y, beside]);
      for (const [y, z] of spots) cuts.push(tool.clone().translate(0, y, z) as Shape3D);
      notes.push({ level: 'info', key: p.countersunk ? 'note.hookScrewsSunk' : 'note.hookScrews', vars: { n: spots.length, d } });
    }
  }
  if (p.type === 'bracket' && p.shelfHoles > 0) {
    const [lo, hi] = [tb + d + 3, tb + p.reach - (p.tipHeight > 0 ? t : 0) - d - 2];
    if (hi < lo || !room) notes.push({ level: 'warn', key: 'note.noRoomShelfHoles' });
    else for (const x of spread(Math.round(p.shelfHoles), lo, hi)) cuts.push(makeCylinder(d / 2, t + 2, [x, plateH - t - 1, beside], [0, 1, 0]) as Shape3D);
  }
  body = cutAll(body, cuts);

  // --- lay it on the bed -----------------------------------------------------
  // A single hook lies on its side: the layers then run along the arm, which is what makes it strong.
  if (rail) {
    body = body.rotate(-90, [0, 0, 0], [0, 1, 0]) as Shape3D;
    notes.push({ level: 'info', key: 'note.hookRail', vars: { n: count, l: round1(length) } });
  } else {
    notes.push({ level: 'info', key: 'note.hookPrint' });
  }
  const [[x0, y0, z0], [x1, y1]] = body.boundingBox.bounds;
  body = body.translate(-(x0 + x1) / 2, -(y0 + y1) / 2, -z0) as Shape3D;
  return { parts: [{ name: 'hook', shape: body }], notes };
}
