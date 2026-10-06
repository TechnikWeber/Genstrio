import { draw, drawCircle, drawPolysides, makeCylinder, type Drawing, type Shape3D, type Sketch } from 'replicad';
import { BOARDS } from '../boards';
import type { Note } from '../types';
import { layoutText, textSolid } from './text';
import { cutAll, fuseAll, patternCells, prism, revolveZ, round1, roundedRect, threadCam, type Build, type Part, type Pattern } from './common';

type Side = 'front' | 'back' | 'left' | 'right';
type Vent = 'none' | Pattern;
type ScrewSize = keyof typeof SCREWS;

export interface Opening {
  type: 'round' | 'gland' | 'rect' | 'speaker' | 'fan' | keyof typeof CONNECTORS;
  face: Side | 'lid' | 'floor';
  preset: 'custom' | keyof typeof ROUND_PRESETS;
  diameter: number;
  thread: keyof typeof THREADS;
  printThread: boolean;
  width: number;
  rectHeight: number;
  radius: number;
  speaker: string;
  grille: Pattern | 'open';
  ring: boolean;
  fan: keyof typeof FANS;
  /** Along the wall, to the right when seen from outside; X on lid and floor. */
  offset: number;
  /** Centre above the inner floor (walls only). */
  height: number;
  offsetY: number;
}

export interface EnclosureParams {
  shape: 'box' | 'round' | 'polygon';
  length: number;
  width: number;
  diameter: number;
  sides: number;
  height: number;
  wall: number;
  cornerRadius: number;
  pcb: boolean;
  pcbBoard: string;
  pcbLength: number;
  pcbWidth: number;
  holeInset: number;
  standoffHeight: number;
  pcbOffsetX: number;
  pcbOffsetY: number;
  pcbScrew: ScrewSize;
  pcbHole: 'selftap' | 'insert';
  lid: boolean;
  lidFix: 'screws' | 'snap' | 'twist' | 'none';
  lidScrew: ScrewSize;
  lidHole: 'selftap' | 'insert';
  lidHead: 'flat' | 'countersunk' | 'counterbore';
  snapCount: number;
  snapWidth: number;
  snapHeight: number;
  lidThickness: number;
  lidText: string;
  lidTextFont: string;
  lidTextSize: number;
  lidTextStyle: 'engraved' | 'raised';
  lidTextDepth: number;
  lidTextX: number;
  lidTextY: number;
  lidTextTurn: '0' | '90' | '180' | '270';
  clearance: number;
  hinge: boolean;
  hingeCount: number;
  hingeWidth: number;
  hingePin: number;
  gasket: boolean;
  gasketWidth: number;
  openings: Opening[];
  lidVent: Vent;
  lidVentSize: number;
  lidVentGap: number;
  lidVentLength: number;
  lidVentArea: number;
  bodyVent: Vent;
  bodyVentWalls: 'none' | 'sides' | 'frontback' | 'all';
  bodyVentFloor: boolean;
  bodyVentSize: number;
  bodyVentGap: number;
  bodyVentLength: number;
  bodyVentArea: number;
  ears: 'none' | 'two' | 'four';
  earHole: number;
  earSides: 'leftright' | 'frontback';
  earSpacing: number;
  earOffset: number;
  din: 'none' | Side | 'floor';
  dinOffset: number;
}

// d: nominal, pilot: self-tapping core hole, clear: through hole,
// sink/bore: recess Ø for countersunk and cylinder heads,
// insert: hole Ø and length of a common heat-set insert
const SCREWS = {
  M2: { d: 2, pilot: 1.6, clear: 2.4, sink: 4.4, bore: 4.3, insert: [3.2, 4] },
  'M2.5': { d: 2.5, pilot: 2.1, clear: 2.9, sink: 5.4, bore: 5, insert: [4, 5.7] },
  M3: { d: 3, pilot: 2.5, clear: 3.4, sink: 6.4, bore: 6, insert: [4, 5.7] },
  M4: { d: 4, pilot: 3.3, clear: 4.5, sink: 8.6, bore: 7.6, insert: [5.6, 8.1] },
  M5: { d: 5, pilot: 4.2, clear: 5.5, sink: 10.6, bore: 9.2, insert: [6.4, 9.5] },
};

// width, height, corner radius
const CONNECTORS = {
  usbc: [9.4, 3.6, 1.7],
  microusb: [8.2, 3.4, 1],
  usba: [13.6, 6.2, 0.6],
  usba2: [15.4, 16.6, 0.6], // two USB-A stacked
  usbb: [12.6, 11.6, 0.6],
  hdmi: [15.6, 6.2, 0.8],
  minihdmi: [11.6, 4.6, 1],
  microhdmi: [7.6, 4.2, 1],
  rj45: [16.4, 14, 0.6],
  barrel: [9.6, 11.4, 0.6], // PCB-mount DC jack
  sd: [13, 3, 0.5],
};

// Panel hole Ø of common round parts
const ROUND_PRESETS = {
  sma: 6.5,
  bnc: 9.7,
  led3: 3.1,
  led5: 5.1,
  audio35: 6.2,
  toggle: 6.2,
  pot: 7.2,
  dcjack: 8.2,
  button12: 12.2,
  button16: 16.2,
  button19: 19.2,
  button22: 22.3,
};

// Cable gland threads: major Ø, pitch
const THREADS = {
  M12: [12, 1.5],
  M16: [16, 1.5],
  M20: [20, 1.5],
  M25: [25, 1.5],
  M32: [32, 1.5],
  M40: [40, 1.5],
  PG7: [12.5, 1.27],
  PG9: [15.2, 1.41],
  PG11: [18.6, 1.41],
  'PG13.5': [20.4, 1.41],
  PG16: [22.5, 1.41],
  PG21: [28.3, 1.588],
};

// Fan size → screw hole spacing
const FANS = { '25': 20, '30': 24, '40': 32, '50': 40, '60': 50, '70': 61.5, '80': 71.5, '92': 82.5, '120': 105 };

const THREAD_LENGTH = 6;
const O: [number, number, number] = [0, 0, 0];
const X: [number, number, number] = [1, 0, 0];
const Y: [number, number, number] = [0, 1, 0];
const Z: [number, number, number] = [0, 0, 1];
const RAD = Math.PI / 180;
const SIDE_DIR: Record<Side, number> = { front: 0, right: 90, back: 180, left: 270 };

/** Cutting tool for an internal thread along +Z, from z = 0 to `len`, with run-out past both ends. */
const threadTool = (name: keyof typeof THREADS, len: number): Shape3D => threadCam(THREADS[name][0] / 2 + 0.2, THREADS[name][1], len); // printed holes come out tight

/** A flat or curved stretch of side wall. `dir` turns the front wall (−Y) about Z onto it. */
interface Wall {
  dir: number;
  /** Centre to outer face. */
  dist: number;
  width: number;
  curved: boolean;
}

interface Outline {
  /** Half extents of the bounding box. */
  hx: number;
  hy: number;
  /** Radius of the inscribed circle. */
  inradius: number;
  /** Corner count a wall "sees": 4 for a box, 0 for a round body. */
  n: number;
  profile(inset: number): Drawing;
  /** Whether a point lies at least `margin` inside the outer contour. */
  inside(x: number, y: number, margin: number): boolean;
  walls: Wall[];
  /** Candidate screw post centres, `inset` away from the adjacent walls. */
  posts(inset: number): [number, number][];
}

function makeOutline(p: EnclosureParams): Outline {
  if (p.shape === 'box') {
    const hx = p.length / 2;
    const hy = p.width / 2;
    const r = Math.min(p.cornerRadius, Math.min(hx, hy) - 0.5);
    return {
      hx,
      hy,
      inradius: Math.min(hx, hy),
      n: 4,
      profile: (i) => roundedRect(2 * (hx - i), 2 * (hy - i), r - i),
      inside(x, y, m) {
        const ax = Math.abs(x);
        const ay = Math.abs(y);
        if (ax > hx - m || ay > hy - m) return false;
        const cx = ax - (hx - r);
        const cy = ay - (hy - r);
        return cx <= 0 || cy <= 0 || r - m <= 0 || Math.hypot(cx, cy) <= r - m;
      },
      walls: [
        { dir: 0, dist: hy, width: p.length, curved: false },
        { dir: 90, dist: hx, width: p.width, curved: false },
        { dir: 180, dist: hy, width: p.length, curved: false },
        { dir: 270, dist: hx, width: p.width, curved: false },
      ],
      posts: (i) => [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([sx, sy]) => [sx * (hx - i), sy * (hy - i)]),
    };
  }

  const R = p.diameter / 2;
  if (p.shape === 'round') {
    return {
      hx: R,
      hy: R,
      inradius: R,
      n: 0,
      profile: (i) => drawCircle(R - i),
      inside: (x, y, m) => Math.hypot(x, y) <= R - m,
      walls: [0, 90, 180, 270].map((dir) => ({ dir, dist: R, width: (Math.PI * R) / 2, curved: true })),
      posts: (i) => [45, 135, 225, 315].map((a) => [(R - i) * Math.cos(a * RAD), (R - i) * Math.sin(a * RAD)]),
    };
  }

  // Regular polygon, one flat facing the front. `diameter` runs over the corners.
  const n = Math.round(p.sides);
  const half = Math.PI / n;
  const a = R * Math.cos(half);
  const r = Math.min(p.cornerRadius, a * 0.8);
  const dirs = Array.from({ length: n }, (_, k) => (k * 360) / n);
  const normal = (dir: number): [number, number] => [Math.sin(dir * RAD), -Math.cos(dir * RAD)];
  const xs = dirs.map((d) => Math.abs(normal(d + 180 / n)[0]) * R);
  const ys = dirs.map((d) => Math.abs(normal(d + 180 / n)[1]) * R);
  return {
    hx: Math.max(...xs),
    hy: Math.max(...ys),
    inradius: a,
    n,
    profile(i) {
      let d = drawPolysides((a - i) / Math.cos(half), n);
      if (n % 2 === 0) d = d.rotate(180 / n);
      return r - i > 0.05 ? d.fillet(r - i) : d;
    },
    inside: (x, y, m) => dirs.every((d) => x * normal(d)[0] + y * normal(d)[1] <= a - m),
    walls: dirs.map((dir) => ({ dir, dist: a, width: 2 * a * Math.tan(half), curved: false })),
    posts(i) {
      const picks = n <= 6 ? dirs.map((_, k) => k) : [...new Set([0, 1, 2, 3].map((q) => Math.round((q * n) / 4)))];
      return picks.map((k) => {
        const [nx, ny] = normal(dirs[k] + 180 / n);
        const rad = (a - i) / Math.cos(half);
        return [nx * rad, ny * rad];
      });
    },
  };
}

interface Rect {
  x: number;
  y: number;
  hw: number;
  hh: number;
}

const overlaps = (a: Rect, b: Rect) => Math.abs(a.x - b.x) < a.hw + b.hw && Math.abs(a.y - b.y) < a.hh + b.hh;

/** A round opening of the given radius: fully open, or a guard of small openings. */
function grille(kind: Pattern | 'open', radius: number): Drawing[] {
  if (kind === 'open') return [drawCircle(radius)];
  const size = Math.min(7, Math.max(2, radius / 6));
  const fits = (x: number, y: number, hw: number, hh: number) => Math.hypot(Math.abs(x) + hw, Math.abs(y) + hh) <= radius;
  const { cells } = patternCells(kind, kind === 'slots' ? size * 0.7 : size, Math.max(1.2, size * 0.35), radius * 0.8, 2 * radius, 2 * radius, fits);
  return cells.map((c) => c.drawing.translate(c.x, c.y));
}

/** The 2D contour(s) an opening cuts, centred on its position. */
function openingContour(o: Opening): { drawings: Drawing[]; hw: number; hh: number } {
  if (o.type === 'round' || o.type === 'gland') {
    const d = o.type === 'gland' ? THREADS[o.thread][0] + 0.4 : o.preset === 'custom' ? o.diameter : ROUND_PRESETS[o.preset];
    return { drawings: [drawCircle(d / 2)], hw: d / 2, hh: d / 2 };
  }
  if (o.type === 'speaker') {
    const d = Number(o.speaker);
    return { drawings: grille(o.grille, d * 0.425), hw: d / 2, hh: d / 2 }; // the sounding area is smaller than the frame
  }
  if (o.type === 'fan') {
    const size = Number(o.fan);
    const s = FANS[o.fan] / 2;
    const screw = size <= 50 ? 1.7 : 2.25;
    const holes = [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([sx, sy]) => drawCircle(screw).translate(sx * s, sy * s));
    return { drawings: [...grille(o.grille, size * 0.47), ...holes], hw: size / 2, hh: size / 2 };
  }
  const [w, h, r] = o.type === 'rect' ? [o.width, o.rectHeight, o.radius] : CONNECTORS[o.type];
  return { drawings: [roundedRect(w, h, r)], hw: w / 2, hh: h / 2 };
}

export function* buildEnclosure(p: EnclosureParams): Build {
  const notes: Note[] = [];
  const warn = (key: string, vars?: Note['vars']) => {
    if (!notes.some((n) => n.key === key)) notes.push({ level: 'warn', key, vars });
  };
  const out = makeOutline(p);
  const H = p.height;
  const t = Math.min(p.wall, out.inradius / 2, H / 4);
  const hasLid = p.lid;
  const lidT = hasLid ? Math.min(p.lidThickness, H / 4) : 0;
  const hb = H - lidT; // body height, the lid plate adds the rest
  const clr = p.clearance;
  const round = p.shape === 'round';
  const cornerR = round ? 0 : p.shape === 'box' ? Math.min(p.cornerRadius, out.inradius - 0.5) : Math.min(p.cornerRadius, out.inradius * 0.8);
  const tanHalf = round ? 0 : Math.tan(Math.PI / out.n);

  // --- placement helpers ----------------------------------------------------
  // Wall features are modelled at the front wall (outer face at y = −dist,
  // x along the wall, z up) and then turned onto their wall.
  const place = (shape: Shape3D, wall: Wall, u: number): Shape3D =>
    wall.curved ? shape.rotate(wall.dir + u / wall.dist / RAD, O, Z) : shape.translate(u, 0, 0).rotate(wall.dir, O, Z);

  /** How far a curved wall bulges away from a chord of half width hw. */
  const sag = (wall: Wall, hw: number) => {
    if (!wall.curved) return 0;
    const ri = wall.dist - t;
    return ri - Math.sqrt(Math.max(0, ri * ri - hw * hw));
  };

  /** Extrude a contour (x along the wall, y up) through a wall, centred at height z. */
  const wallPrism = (drawing: Drawing, wall: Wall, u: number, z: number, hw: number): Shape3D => {
    const inward = 1 + sag(wall, hw);
    return place(prism(drawing, t + inward + 1, -inward).rotate(90, O, X).translate(0, -wall.dist + t, z), wall, u);
  };

  const wallOf = (side: Side): Wall => {
    const diff = (w: Wall) => Math.abs(((w.dir - SIDE_DIR[side] + 540) % 360) - 180);
    return out.walls.reduce((best, w) => (diff(w) < diff(best) - 1e-6 ? w : best));
  };

  // --- body -----------------------------------------------------------------
  const outer = prism(out.profile(0), hb);
  yield { label: 'stage.outer', parts: [{ name: 'body', shape: outer }] };

  const cavity = prism(out.profile(t), hb, t);
  let body = outer.cut(cavity) as Shape3D;
  yield { label: 'stage.hollow', parts: [{ name: 'body', shape: body }] };

  const adds: Shape3D[] = [];
  const cuts: Shape3D[] = [];
  const lidAdds: Shape3D[] = [];
  const lidCuts: Shape3D[] = [];
  // Tools that are cut on their own, so a neighbouring cutter cannot upset them.
  const soloCuts: Shape3D[] = [];
  const lidThreadCuts: Shape3D[] = [];
  // Areas that vents must leave alone
  const floorBlocked: Rect[] = [];
  const lidBlocked: Rect[] = [];
  const wallBlocked = new Map<Wall, Rect[]>(out.walls.map((w) => [w, []]));

  // --- lid screw posts ------------------------------------------------------
  const lidScrew = SCREWS[p.lidScrew];
  const lidInsert = p.lidHole === 'insert';
  const postR = Math.max(lidScrew.d / 2 + 2, lidInsert ? lidScrew.insert[0] / 2 + 1.6 : 0);
  const postInset = t + postR * 0.7;
  let screwed = hasLid && p.lidFix === 'screws';
  if (screwed && out.inradius - postInset < postR) {
    warn('note.noRoomPosts');
    screwed = false;
  }
  const posts = screwed ? out.posts(postInset) : [];

  if (screwed) {
    const solid = fuseAll(posts.map(([x, y]) => makeCylinder(postR, hb - t, [x, y, t]) as Shape3D));
    adds.push(solid.intersect(outer) as Shape3D);
    const [d, len] = lidInsert ? lidScrew.insert : [lidScrew.pilot, 11];
    const depth = Math.max(1, Math.min(hb - t - 1, len + 1));
    for (const [x, y] of posts) {
      cuts.push(makeCylinder(d / 2, depth + 1, [x, y, hb - depth]) as Shape3D);
      const block = { x, y, hw: postR + clr + 1.5, hh: postR + clr + 1.5 };
      floorBlocked.push(block);
      lidBlocked.push(block);
    }
    notes.push({ level: 'info', key: `note.lidScrews.${p.lidHole}`, vars: { n: posts.length, screw: p.lidScrew, d, l: round1(depth) } });
  }

  // Usable width of a wall between its corners, posts and corner rounding
  const cornerRun = (perp: number) => (round ? 0 : perp * tanHalf);
  const edge = Math.max(screwed ? cornerRun(postInset) + postR : cornerRun(t), round ? 0 : cornerR * tanHalf) + 2;
  const usable = (wall: Wall) => wall.width - 2 * edge;

  // --- PCB standoffs --------------------------------------------------------
  if (p.pcb) {
    const screw = SCREWS[p.pcbScrew];
    const insert = p.pcbHole === 'insert';
    const sr = Math.max(screw.d / 2 + 1.5, insert ? screw.insert[0] / 2 + 1.4 : 0);
    const known = p.pcbBoard === 'custom' ? null : BOARDS[p.pcbBoard];
    const bl = known?.length ?? p.pcbLength;
    const bw = known?.width ?? p.pcbWidth;
    const hx = bl / 2 - p.holeInset;
    const hy = bw / 2 - p.holeInset;
    const holes = known ? known.holes.map(([x, y]) => [x - bl / 2, y - bw / 2]) : [[hx, hy], [hx, -hy], [-hx, hy], [-hx, -hy]];
    const sh = Math.min(p.standoffHeight, hb - t - 1);
    const [d, len] = insert ? screw.insert : [screw.pilot, sh];
    // An insert may reach into the floor, but must not break through it.
    const depth = Math.min(insert ? len + 0.5 : sh, sh + t - 0.8);
    if (insert && depth < len + 0.5) warn('note.standoffShort', { min: round1(len + 1.3 - t) });
    for (const [px, py] of holes) {
      const x = p.pcbOffsetX + px;
      const y = p.pcbOffsetY + py;
      adds.push(makeCylinder(sr, sh, [x, y, t]) as Shape3D);
      cuts.push(makeCylinder(d / 2, depth + 1, [x, y, t + sh - depth]) as Shape3D);
      floorBlocked.push({ x, y, hw: sr + 1, hh: sr + 1 });
    }

    const board: Rect = { x: p.pcbOffsetX, y: p.pcbOffsetY, hw: bl / 2, hh: bw / 2 };
    const fits = [[1, 1], [1, -1], [-1, 1], [-1, -1]].every(([sx, sy]) => out.inside(board.x + sx * board.hw, board.y + sy * board.hh, t));
    const hitsPost = posts.some(([x, y]) => {
      const dx = Math.max(0, Math.abs(x - board.x) - board.hw);
      const dy = Math.max(0, Math.abs(y - board.y) - board.hh);
      return Math.hypot(dx, dy) < postR;
    });
    if (!fits) warn('note.pcbTooLarge');
    else if (hitsPost) warn('note.pcbHitsPosts');
    if (!known && (hx <= sr || hy <= sr)) warn('note.standoffsOverlap');
    notes.push({ level: 'info', key: `note.pcbScrews.${p.pcbHole}`, vars: { n: holes.length, screw: p.pcbScrew, d, l: round1(depth) } });
  }

  // --- mounting ears --------------------------------------------------------
  if (p.ears !== 'none') {
    const er = p.earHole / 2 + 4.5;
    const eh = Math.max(t, 3);
    const sides: Side[] = p.earSides === 'frontback' ? ['front', 'back'] : ['left', 'right'];
    for (const wall of new Set(sides.map(wallOf))) {
      const room = wall.width - 2 * (er + (wall.curved ? 0 : Math.max(cornerR, 1)));
      const spacing = p.earSpacing > 0 ? Math.min(p.earSpacing, room) : room;
      const pair = p.ears === 'four' && spacing > 2 * er + 2;
      for (const u of pair ? [-spacing / 2, spacing / 2] : [0]) {
        // Reaches into the wall so the two fuse; whatever would poke into the interior is cut off again.
        const reach = t + 1 + sag(wall, er);
        const tab = prism(roundedRect(2 * er, 2 * er + reach, er - 0.01).translate(0, -wall.dist - er + reach / 2), eh);
        adds.push(place(tab, wall, u + p.earOffset).cut(cavity) as Shape3D);
        cuts.push(place(makeCylinder(p.earHole / 2, eh + 2, [0, -wall.dist - er, -1]) as Shape3D, wall, u + p.earOffset));
      }
    }
  }

  // --- lid lip and snap fits ------------------------------------------------
  const snap = hasLid && p.lidFix === 'snap';
  let twist = hasLid && p.lidFix === 'twist';
  if (twist && !round) {
    warn('note.twistRoundOnly');
    twist = false;
  }
  const lipH = hasLid ? Math.min(snap || twist ? 6 : 3, hb - t - 1) : 0;
  const lipW = Math.max(1.2, t * 0.8);
  const hasLip = hasLid && lipH >= 1 && out.inradius - t - clr - lipW > 1.5;
  const lipSlits: Shape3D[] = [];
  let lipTrim: Shape3D | null = null;
  const yzPrism = (points: [number, number][], x0: number, len: number): Shape3D => {
    const pts = points.filter((pt, i) => i === 0 || Math.hypot(pt[0] - points[i - 1][0], pt[1] - points[i - 1][1]) > 1e-6);
    let pen = draw(pts[0]);
    for (const pt of pts.slice(1)) pen = pen.lineTo(pt);
    return (pen.close().sketchOnPlane('YZ', x0) as Sketch).extrude(len) as Shape3D;
  };

  // --- hinge ----------------------------------------------------------------
  // Knuckles on the back wall and on the lid, joined by a pin (a piece of
  // filament, a nail or a screw). The lid still prints flat, on its own.
  const backWall = out.walls.find((w) => !w.curved && Math.abs(w.dir - 180) < 1e-6);
  let hinged = hasLid && p.hinge;
  if (hinged && !backWall) {
    warn('note.needsFlatBack');
    hinged = false;
  }
  if (hinged && backWall) {
    const d = backWall.dist;
    const gap = 0.4;
    const play = 0.3; // between neighbouring knuckles
    const kr = p.hingePin / 2 + 2.2;
    const yc = -d - gap - kr; // pin axis, modelled at the front wall
    const za = H - kr; // knuckles end flush with the top of the lid, which prints face down
    const span = backWall.width - 2 * cornerR - 4;
    const w = Math.min(p.hingeWidth, span);
    const n = Math.max(1, Math.min(Math.round(p.hingeCount), Math.floor(span / (w + 6))));
    if (w < 9) warn('note.noRoomHinge');
    else {
      const tang = kr * Math.SQRT1_2;
      const barrel = (x0: number, len: number) => (drawCircle(kr).translate(yc, za).sketchOnPlane('YZ', x0) as Sketch).extrude(len) as Shape3D;
      // The body knuckle rests on a 45° gusset, so it prints without support.
      const gusset: [number, number][] = [
        [-d + 0.2, Math.max(0, za - kr - gap - 0.2)],
        [yc - tang, za - tang],
        [yc, za],
        [-d - gap / 2, za],
        [-d - gap / 2, hb],
        [-d + 0.2, hb],
      ];
      const tab: [number, number][] = [[-d + 0.2, hb], [-d + 0.2, H], [yc, H], [yc, hb]];
      const knuckle = (outline: [number, number][], x0: number, len: number) => barrel(x0, len).fuse(yzPrism(outline, x0, len)) as Shape3D;
      const pin = () => makeCylinder(p.hingePin / 2 + 0.15, w + 2, [-w / 2 - 1, yc, za], X) as Shape3D;
      for (let i = 0; i < n; i++) {
        const u = (i - (n - 1) / 2) * (span / n);
        const side = w / 4 - play / 2;
        adds.push(place(knuckle(gusset, -w / 2, side).fuse(knuckle(gusset, w / 2 - side, side)) as Shape3D, backWall, u));
        lidAdds.push(place(knuckle(tab, -side, 2 * side), backWall, u));
        cuts.push(place(pin(), backWall, u));
        lidCuts.push(place(pin(), backWall, u));
      }
      // The lip near the hinge would jam against the back wall as the lid swings open.
      const m = t + clr + 1.6 * lipH + gap + kr;
      lipTrim = place(prism(roundedRect(backWall.width + 4, m + 1, 0).translate(0, -d + (m - 1) / 2), lipH + 2, hb - lipH - 1), backWall, 0);
      notes.push({ level: 'info', key: 'note.hinge', vars: { n, pin: p.hingePin, len: round1(w) } });
    }
  }

  // --- gasket groove in the rim ---------------------------------------------
  if (hasLid && p.gasket) {
    const gw = p.gasketWidth;
    if (t < gw + 1.2) warn('note.noRoomGasket', { min: round1(gw + 1.2) });
    else {
      const a = (t - gw) / 2;
      const depth = gw * 0.7;
      soloCuts.push(prism(out.profile(a), depth + 1, hb - depth).cut(prism(out.profile(a + gw), depth + 3, hb - depth - 1)) as Shape3D);
      notes.push({ level: 'info', key: 'note.gasket', vars: { d: round1(gw), depth: round1(depth) } });
    }
  }

  // --- DIN rail clip (35 mm top hat rail) -----------------------------------
  // A fixed hook and a springy latch, given as (position across the rail, depth away from the surface).
  const DIN_HOOK: [number, number][] = [[17.7, -0.3], [21, -0.3], [21, 3.2], [15.9, 3.2], [15.9, 1.4], [17.7, 1.4]];
  const DIN_LATCH: [number, number][] = [[-17.7, -0.3], [-17.7, 1.4], [-16.9, 1.4], [-16.9, 1.8], [-18.2, 4.4], [-19.4, 4.4], [-19.4, -0.3]];
  let lift = 0; // a clip under the floor raises the body off the bed
  if (p.din === 'floor') {
    // Under the floor the rail runs along X. This is how DIN devices usually sit, but it prints on supports.
    const len = Math.min(30, 2 * out.hx - 8);
    for (const pts of [DIN_HOOK, DIN_LATCH]) adds.push(yzPrism(pts.map(([y, v]): [number, number] => [y + p.dinOffset, -v]), -len / 2, len));
    lift = 4.4;
    notes.push({ level: 'info', key: 'note.dinFloor' });
  } else if (p.din !== 'none') {
    // On a wall the clip is drawn from above and extruded upwards, so it prints without support; the rail runs along the height.
    const wall = wallOf(p.din);
    if (wall.curved) warn('note.needsFlatWall');
    else {
      for (const pts of [DIN_HOOK, DIN_LATCH]) {
        let pen = draw([pts[0][0], -wall.dist - pts[0][1]]);
        for (const [x, v] of pts.slice(1)) pen = pen.lineTo([x, -wall.dist - v]);
        adds.push(place(prism(pen.close(), Math.min(hb, 30)), wall, p.dinOffset));
      }
      notes.push({ level: 'info', key: 'note.dinClip' });
    }
  }

  // --- twist lock (round bodies) --------------------------------------------
  // Lugs on the lip drop through slots in the wall into a ring groove; a turn locks the lid.
  if (twist) {
    const R = out.inradius;
    const s = Math.min(1, t - 0.8);
    const base = Math.min(lipW - 0.1, 0.6);
    const e = s + clr + base;
    const w = Math.min(10, R * 0.5);
    if (!hasLip || s < 0.4 || lipH < 2 * e + 0.5) warn('note.noRoomTwist');
    else {
      const zc = hb - lipH + e + 0.5;
      const eg = s + 0.75 + clr;
      const ri = R - t;
      let tool = revolveZ([[ri - 0.5, zc - eg], [ri + s + 0.15, zc], [ri - 0.5, zc + eg]]);
      for (const dir of [60, 180, 300]) {
        const wall: Wall = { dir, dist: R, width: 0, curved: true };
        lidAdds.push(place(yzPrism([[-ri + clr + base, zc - e], [-ri + clr - s - clr, zc], [-ri + clr + base, zc + e]], -w / 2, w), wall, 0));
        const slot = prism(roundedRect(w + 1.5, s + 0.65 + 0.5, 0).translate(0, -ri - (s + 0.15) / 2 + 0.25), hb + 1 - (zc - eg), zc - eg);
        tool = tool.fuse(place(slot, wall, 0)) as Shape3D;
      }
      soloCuts.push(tool);
      notes.push({ level: 'info', key: 'note.twist' });
    }
  }

  if (snap) {
    const s = Math.min(p.snapHeight, t - 0.65); // how far the nose bites into the wall
    // A hinged lid swings shut, so only the wall opposite the hinge can latch.
    const pads = out.walls.filter((wall) => !hinged || wall.dir === 0).flatMap((wall) => {
      const room = wall.width - 2 * (Math.max(cornerRun(t + clr + lipW), round ? 0 : cornerR * tanHalf) + 1.5);
      const w = Math.min(p.snapWidth, room - 2);
      const n = Math.min(Math.round(p.snapCount), Math.floor(room / (w + 6)));
      return w < 3 || n < 1 ? [] : Array.from({ length: n }, (_, i) => ({ wall, w, u: (i - (n - 1) / 2) * (room / n) }));
    });
    const base = Math.min(lipW - 0.1, 0.4 + Math.max(0, ...pads.map((pad) => sag(pad.wall, pad.w / 2))));
    const e = s + clr + base; // 45° flanks: printable and the lid can be pulled off again
    if (!hasLip || s < 0.2 || !pads.length || lipH < 2 * e + 0.5) warn('note.noRoomSnaps');
    else {
      const zc = hb - lipH + e + 0.5;
      const wedge = (y: number, tip: number, half: number, w: number) =>
        (draw([y, zc - half]).lineTo([y - tip, zc]).lineTo([y, zc + half]).close().sketchOnPlane('YZ', -w / 2) as Sketch).extrude(w) as Shape3D;
      for (const { wall, w, u } of pads) {
        const face = -wall.dist + t; // inner wall face
        lidAdds.push(place(wedge(face + clr + base, e, e, w), wall, u));
        cuts.push(place(wedge(face + 0.5, s + 0.65, s + 0.75 + clr, w + 1), wall, u));
        // Slits on both sides turn this stretch of the lip into a springy tab.
        for (const side of [-1, 1]) {
          const slit = prism(roundedRect(1, lipW + 2, 0).translate(side * (w / 2 + 1.2), face + clr + lipW / 2), lipH + 1, hb - lipH - 1);
          lipSlits.push(place(slit, wall, u));
        }
      }
      notes.push({ level: 'info', key: 'note.snaps', vars: { n: pads.length, s: round1(s) } });
    }
  }

  // --- openings -------------------------------------------------------------
  for (const o of p.openings) {
    const { drawings, hw, hh } = openingContour(o);
    const printed = o.type === 'gland' && o.printThread;
    const major = THREADS[o.thread][0];
    if (o.type === 'gland') {
      notes.push({ level: 'info', key: printed ? 'note.threadPrinted' : 'note.glandHole', vars: { thread: o.thread, d: round1(major + 0.4) } });
    }

    if (o.face === 'lid' && !hasLid) continue;
    if (o.face === 'lid' || o.face === 'floor') {
      const lid = o.face === 'lid';
      const plate = lid ? lidT : t;
      const z0 = lid ? hb : 0; // underside of the plate
      const [x, y] = [o.offset, o.offsetY];
      const margin = lid ? t + clr + lipW : t;
      if (![[1, 1], [1, -1], [-1, 1], [-1, -1]].every(([sx, sy]) => out.inside(x + sx * hw * 0.7, y + sy * hh * 0.7, margin))) warn('note.portOutside');
      const target = lid ? lidCuts : cuts;
      const extra = lid ? lidAdds : adds;
      let block = Math.max(hw, hh);
      if (printed) {
        const boss = Math.max(0, THREAD_LENGTH - plate);
        const zIn = lid ? hb - boss : 0;
        if (boss > 0) extra.push(makeCylinder(major / 2 + 2.5, boss + 0.1, [x, y, lid ? zIn : t - 0.1]) as Shape3D);
        (lid ? lidThreadCuts : soloCuts).push(threadTool(o.thread, plate + boss).translate(x, y, zIn));
        block = major / 2 + 2.5;
      } else {
        for (const d of drawings) target.push(prism(d.translate(x, y), plate + 2, z0 - 1));
      }
      if (o.type === 'speaker' && o.ring) {
        // A collar on the inside that centres the speaker frame
        const ri = Number(o.speaker) / 2 + 0.2;
        const zr = lid ? hb - 3 : t;
        extra.push((makeCylinder(ri + 1.6, 3, [x, y, zr]) as Shape3D).cut(makeCylinder(ri, 5, [x, y, zr - 1]) as Shape3D) as Shape3D);
        block = ri + 1.6;
      }
      (lid ? lidBlocked : floorBlocked).push({ x, y, hw: block + 1.5, hh: block + 1.5 });
      continue;
    }

    const wall = wallOf(o.face);
    const zc = t + o.height;
    if (zc + hh > hb - lipH - 0.5 || zc - hh < t) warn('note.portOutside');
    if (!wall.curved && Math.abs(o.offset) + hw > wall.width / 2 - cornerRun(t)) warn('note.portOutside');
    if (printed) {
      const boss = Math.max(0, THREAD_LENGTH - t);
      if (boss > 0) {
        const lug = (makeCylinder(major / 2 + 2.5, boss + t, [0, 0, -boss]) as Shape3D).rotate(90, O, X).translate(0, -wall.dist + t, zc);
        adds.push(place(lug, wall, o.offset).intersect(outer) as Shape3D);
      }
      const tool = threadTool(o.thread, t + boss).translate(0, 0, -boss).rotate(90, O, X).translate(0, -wall.dist + t, zc);
      soloCuts.push(place(tool, wall, o.offset));
    } else {
      for (const d of drawings) cuts.push(wallPrism(d, wall, o.offset, zc, hw));
    }
    wallBlocked.get(wall)!.push({ x: o.offset, y: zc, hw: hw + 2, hh: hh + 2 });
  }

  // --- vents ----------------------------------------------------------------
  const plateVent = (kind: Pattern, size: number, gap: number, len: number, area: number, margin: number, blocked: Rect[]) => {
    const keep = (x: number, y: number, hw: number, hh: number) =>
      [[1, 1], [1, -1], [-1, 1], [-1, -1]].every(([sx, sy]) => out.inside(x + sx * hw, y + sy * hh, margin)) &&
      !blocked.some((b) => overlaps(b, { x, y, hw, hh }));
    const result = patternCells(kind, size, gap, len, (2 * out.hx * area) / 100, (2 * out.hy * area) / 100, keep);
    if (result.coarsened) notes.push({ level: 'info', key: 'note.patternCoarsened' });
    return result.cells;
  };

  if (p.bodyVent !== 'none' && p.bodyVentFloor) {
    const cells = plateVent(p.bodyVent, p.bodyVentSize, p.bodyVentGap, p.bodyVentLength, p.bodyVentArea, t + 2, floorBlocked);
    if (!cells.length) warn('note.noRoomBodyVents');
    for (const c of cells) cuts.push(prism(c.drawing.translate(c.x, c.y), t + 2, -1));
  }
  if (p.bodyVent !== 'none' && p.bodyVentWalls !== 'none') {
    const sides: Side[] = p.bodyVentWalls === 'sides' ? ['left', 'right'] : p.bodyVentWalls === 'frontback' ? ['front', 'back'] : [];
    const walls = sides.length ? [...new Set(sides.map(wallOf))] : out.walls;
    const zTop = hb - lipH - 1.5;
    const band = ((zTop - t - 2) * p.bodyVentArea) / 100;
    let count = 0;
    let coarse = false;
    for (const wall of walls) {
      const blocked = wallBlocked.get(wall)!;
      const keep = (x: number, y: number, hw: number, hh: number) => !blocked.some((b) => overlaps(b, { x, y: zTop - band / 2 + y, hw, hh }));
      const { cells, coarsened } = patternCells(p.bodyVent, p.bodyVentSize, p.bodyVentGap, p.bodyVentLength, (usable(wall) * p.bodyVentArea) / 100, band, keep);
      for (const c of cells) cuts.push(wallPrism(c.drawing, wall, c.x, zTop - band / 2 + c.y, c.hw));
      count += cells.length;
      coarse ||= coarsened;
    }
    if (!count) warn('note.noRoomBodyVents');
    if (coarse) notes.push({ level: 'info', key: 'note.patternCoarsened' });
  }

  if (adds.length) {
    body = body.fuse(fuseAll(adds)) as Shape3D;
    yield { label: 'stage.mounts', parts: [{ name: 'body', shape: body }] };
  }
  if (cuts.length || soloCuts.length) {
    body = cutAll(body, cuts);
    for (const tool of soloCuts) body = body.cut(tool) as Shape3D;
    yield { label: 'stage.cutouts', parts: [{ name: 'body', shape: body }] };
  }

  // --- lid, modelled in place on top of the body ----------------------------
  if (lift) body = body.translate(0, 0, lift);
  const parts: Part[] = [{ name: 'body', shape: body }];
  if (hasLid) {
    let lid = prism(out.profile(0), lidT, hb);
    if (hasLip) {
      let lip = prism(out.profile(t + clr), lipH, hb - lipH).cut(prism(out.profile(t + clr + lipW), lipH + 2, hb - lipH - 1)) as Shape3D;
      const gaps = [...lipSlits, ...posts.map(([x, y]) => makeCylinder(postR + clr + 0.3, lipH + 2, [x, y, hb - lipH - 1]) as Shape3D)];
      lip = cutAll(lip, gaps);
      if (lipTrim) lip = lip.cut(lipTrim) as Shape3D;
      lid = lid.fuse(lip) as Shape3D;
    }
    if (lidAdds.length) lid = lid.fuse(fuseAll(lidAdds)) as Shape3D;

    if (screwed) {
      // Through hole and head recess as one tool per screw; overlapping tools would be ignored by the kernel.
      const rc = lidScrew.clear / 2;
      let rh = rc;
      let depth = 0;
      if (p.lidHead === 'countersunk') {
        depth = Math.min(lidScrew.sink / 2 - rc, lidT - 0.4);
        rh = rc + depth;
        if (depth < lidScrew.sink / 2 - rc) warn('note.lidTooThin', { min: round1(lidScrew.sink / 2 - rc + 0.4) });
      } else if (p.lidHead === 'counterbore') {
        depth = Math.max(0, Math.min(lidScrew.d + 0.2, lidT - 0.8));
        rh = depth > 0 ? lidScrew.bore / 2 : rc;
        if (depth < lidScrew.d + 0.2) warn('note.lidTooThin', { min: round1(lidScrew.d + 1) });
      }
      const seat = p.lidHead === 'countersunk' ? rc : rh; // radius at the bottom of the recess
      for (const [x, y] of posts) {
        lidCuts.push(revolveZ([[0, hb - 1], [rc, hb - 1], [rc, H - depth], [seat, H - depth], [rh, H], [rh, H + 1], [0, H + 1]]).translate(x, y, 0));
      }
    }

    if (p.lidVent !== 'none') {
      const cells = plateVent(p.lidVent, p.lidVentSize, p.lidVentGap, p.lidVentLength, p.lidVentArea, t + clr + lipW + 2, lidBlocked);
      if (!cells.length) warn('note.noRoomLidVents');
      for (const c of cells) lidCuts.push(prism(c.drawing.translate(c.x, c.y), lidT + 2, hb - 1));
    }
    lid = cutAll(lid, lidCuts);
    for (const tool of lidThreadCuts) lid = lid.cut(tool) as Shape3D;

    // Lettering on the outside of the lid
    let proud = 0;
    if (p.lidText.trim()) {
      const layout = layoutText(p.lidText, p.lidTextFont, p.lidTextSize, 1.5, 'center');
      const place = (shape: Shape3D) => shape.rotate(Number(p.lidTextTurn), O, [0, 0, 1]).translate(p.lidTextX, p.lidTextY, 0) as Shape3D;
      if (p.lidTextStyle === 'raised') {
        proud = p.lidTextDepth;
        lid = lid.fuse(place(textSolid(layout, proud + 0.2, H - 0.2))) as Shape3D;
        notes.push({ level: 'info', key: 'note.lidTextRaised' });
      } else {
        const depth = Math.min(p.lidTextDepth, lidT - 0.4);
        lid = lid.cut(place(textSolid(layout, depth + 1, H - depth))) as Shape3D;
        notes.push({ level: 'info', key: 'note.lidTextEngraved', vars: { d: round1(depth) } });
      }
    }

    // Flip it over for printing: outside face on the bed, next to the body.
    const offset: [number, number, number] = [body.boundingBox.bounds[1][0] + 10 + out.hx, 0, H + proud];
    parts.push({ name: 'lid', shape: lid.rotate(180, O, Y).translate(...offset), assembled: { flip: true, offset: [offset[0], 0, H + lift + proud] } });
    yield { label: 'stage.lid', parts };
  }

  const inner = { h: round1(hb - t) };
  if (p.shape === 'box') notes.push({ level: 'info', key: hasLid ? 'note.innerSize' : 'note.innerSizeOpen', vars: { l: round1(p.length - 2 * t), w: round1(p.width - 2 * t), ...inner } });
  else notes.push({ level: 'info', key: hasLid ? 'note.innerRound' : 'note.innerRoundOpen', vars: { d: round1(2 * (out.inradius - t)), ...inner } });
  return { parts, notes };
}
