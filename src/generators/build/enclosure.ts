import { draw, drawCircle, drawPolysides, makeCylinder, type Drawing, type Shape3D, type Sketch } from 'replicad';
import type { Note } from '../types';
import { cutAll, fuseAll, patternCells, prism, revolveZ, round1, roundedRect, type Build, type Part, type Pattern } from './common';

type Side = 'front' | 'back' | 'left' | 'right';
type Vent = 'none' | Pattern;
type ScrewSize = keyof typeof SCREWS;

export interface Opening {
  type: 'round' | 'gland' | 'usbc' | 'microusb' | 'usba' | 'hdmi' | 'rj45' | 'rect' | 'speaker' | 'fan';
  face: Side | 'lid' | 'floor';
  preset: 'custom' | keyof typeof ROUND_PRESETS;
  diameter: number;
  thread: keyof typeof THREADS;
  printThread: boolean;
  width: number;
  rectHeight: number;
  radius: number;
  speaker: string;
  speakerStyle: 'grille' | 'open';
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
  pcbLength: number;
  pcbWidth: number;
  holeInset: number;
  standoffHeight: number;
  pcbOffsetX: number;
  pcbOffsetY: number;
  pcbScrew: ScrewSize;
  pcbHole: 'selftap' | 'insert';
  lidFix: 'screws' | 'snap' | 'none';
  lidScrew: ScrewSize;
  lidHole: 'selftap' | 'insert';
  lidHead: 'flat' | 'countersunk' | 'counterbore';
  snapCount: number;
  snapWidth: number;
  snapHeight: number;
  lidThickness: number;
  clearance: number;
  openings: Opening[];
  lidVent: Vent;
  lidVentSize: number;
  lidVentGap: number;
  lidVentLength: number;
  lidVentArea: number;
  bodyVent: Vent;
  bodyVentWalls: 'sides' | 'frontback' | 'all' | 'floor';
  bodyVentSize: number;
  bodyVentGap: number;
  bodyVentLength: number;
  bodyVentArea: number;
  ears: 'none' | 'two' | 'four';
  earHole: number;
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
  hdmi: [15.6, 6.2, 0.8],
  rj45: [16.4, 14, 0.6],
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
const FANS = { '25': 20, '30': 24, '40': 32, '50': 40, '60': 50, '80': 71.5 };

const THREAD_LENGTH = 6;
const O: [number, number, number] = [0, 0, 0];
const X: [number, number, number] = [1, 0, 0];
const Y: [number, number, number] = [0, 1, 0];
const Z: [number, number, number] = [0, 0, 1];
const RAD = Math.PI / 180;
const SIDE_DIR: Record<Side, number> = { front: 0, right: 90, back: 180, left: 270 };

const threadCache = new Map<string, Shape3D>();

/**
 * Cutting tool for an internal thread along +Z, from z = 0 to `len`, with
 * run-out past both ends. It is a circle, set off-centre by half the thread
 * depth, extruded with one twist per pitch. That gives a rounded thread whose
 * flanks have the 30° of a V thread at mid-depth, and a single smooth surface
 * that the kernel cuts reliably, unlike a groove swept along a helix.
 * Tools are cached, since building one still takes a moment.
 */
export function threadTool(name: keyof typeof THREADS, len: number): Shape3D {
  const key = `${name}/${len.toFixed(2)}`;
  let tool = threadCache.get(key);
  if (!tool) {
    const [major, pitch] = THREADS[name];
    const rMajor = major / 2 + 0.2; // printed holes come out tight
    const e = 0.27 * pitch;
    const height = len + 2;
    const cam = drawCircle(rMajor - e).translate(e, 0).sketchOnPlane('XY', -1) as Sketch;
    tool = cam.extrude(height, { twistAngle: (360 * height) / pitch }) as Shape3D;
    if (threadCache.size > 12) threadCache.clear();
    threadCache.set(key, tool);
  }
  return tool.clone() as Shape3D;
}

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

/** The 2D contour(s) an opening cuts, centred on its position. */
function openingContour(o: Opening): { drawings: Drawing[]; hw: number; hh: number } {
  if (o.type === 'round' || o.type === 'gland') {
    const d = o.type === 'gland' ? THREADS[o.thread][0] + 0.4 : o.preset === 'custom' ? o.diameter : ROUND_PRESETS[o.preset];
    return { drawings: [drawCircle(d / 2)], hw: d / 2, hh: d / 2 };
  }
  if (o.type === 'speaker') {
    const d = Number(o.speaker);
    const cone = d * 0.425; // radius of the sounding area
    if (o.speakerStyle === 'open') return { drawings: [drawCircle(cone)], hw: d / 2, hh: d / 2 };
    const hole = Math.min(4.5, Math.max(2, d / 14));
    const { cells } = patternCells('holes', hole, hole * 0.6, 0, 2 * cone, 2 * cone, (x, y, hw) => Math.hypot(x, y) + hw <= cone);
    return { drawings: cells.map((c) => c.drawing.translate(c.x, c.y)), hw: d / 2, hh: d / 2 };
  }
  if (o.type === 'fan') {
    const size = Number(o.fan);
    const s = FANS[o.fan] / 2;
    const screw = size <= 50 ? 1.7 : 2.25;
    const holes = [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([sx, sy]) => drawCircle(screw).translate(sx * s, sy * s));
    return { drawings: [drawCircle(size * 0.47), ...holes], hw: size / 2, hh: size / 2 };
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
  const lidT = Math.min(p.lidThickness, H / 4);
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
  // Thread tools are cut on their own, so a neighbouring cutter cannot upset them.
  const threadCuts: Shape3D[] = [];
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
  let screwed = p.lidFix === 'screws';
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
    const hx = p.pcbLength / 2 - p.holeInset;
    const hy = p.pcbWidth / 2 - p.holeInset;
    const sh = Math.min(p.standoffHeight, hb - t - 1);
    const [d, len] = insert ? screw.insert : [screw.pilot, sh];
    // An insert may reach into the floor, but must not break through it.
    const depth = Math.min(insert ? len + 0.5 : sh, sh + t - 0.8);
    if (insert && depth < len + 0.5) warn('note.standoffShort', { min: round1(len + 1.3 - t) });
    for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const x = p.pcbOffsetX + sx * hx;
      const y = p.pcbOffsetY + sy * hy;
      adds.push(makeCylinder(sr, sh, [x, y, t]) as Shape3D);
      cuts.push(makeCylinder(d / 2, depth + 1, [x, y, t + sh - depth]) as Shape3D);
      floorBlocked.push({ x, y, hw: sr + 1, hh: sr + 1 });
    }

    const board: Rect = { x: p.pcbOffsetX, y: p.pcbOffsetY, hw: p.pcbLength / 2, hh: p.pcbWidth / 2 };
    const fits = [[1, 1], [1, -1], [-1, 1], [-1, -1]].every(([sx, sy]) => out.inside(board.x + sx * board.hw, board.y + sy * board.hh, t));
    const hitsPost = posts.some(([x, y]) => {
      const dx = Math.max(0, Math.abs(x - board.x) - board.hw);
      const dy = Math.max(0, Math.abs(y - board.y) - board.hh);
      return Math.hypot(dx, dy) < postR;
    });
    if (!fits) warn('note.pcbTooLarge');
    else if (hitsPost) warn('note.pcbHitsPosts');
    if (hx <= sr || hy <= sr) warn('note.standoffsOverlap');
    notes.push({ level: 'info', key: `note.pcbScrews.${p.pcbHole}`, vars: { screw: p.pcbScrew, d, l: round1(depth) } });
  }

  // --- mounting ears --------------------------------------------------------
  if (p.ears !== 'none') {
    const er = p.earHole / 2 + 4.5;
    const eh = Math.max(t, 3);
    const spots: [Wall, number][] = [];
    if (p.shape === 'box') {
      const u = p.ears === 'four' ? p.width / 2 - er - Math.max(cornerR, 1) : 0;
      for (const side of ['left', 'right'] as Side[]) for (const s of u > er ? [-1, 1] : [0]) spots.push([wallOf(side), s * u]);
    } else {
      const sides: Side[] = p.ears === 'four' ? ['front', 'right', 'back', 'left'] : ['left', 'right'];
      for (const wall of new Set(sides.map(wallOf))) spots.push([wall, 0]);
    }
    for (const [wall, u] of spots) {
      // Reaches into the wall; whatever would poke into the interior is cut off again.
      const reach = t + 1 + sag(wall, er);
      const tab = prism(roundedRect(2 * er, 2 * er + reach, er - 0.01).translate(0, -wall.dist - er + reach / 2), eh);
      adds.push(place(tab.cut(cavity) as Shape3D, wall, u));
      cuts.push(place(makeCylinder(p.earHole / 2, eh + 2, [0, -wall.dist - er, -1]) as Shape3D, wall, u));
    }
  }

  // --- lid lip and snap fits ------------------------------------------------
  const snap = p.lidFix === 'snap';
  const lipH = Math.min(snap ? 6 : 3, hb - t - 1);
  const lipW = Math.max(1.2, t * 0.8);
  const hasLip = lipH >= 1 && out.inradius - t - clr - lipW > 1.5;
  const lipSlits: Shape3D[] = [];

  if (snap) {
    const s = Math.min(p.snapHeight, t - 0.65); // how far the nose bites into the wall
    const pads = out.walls.flatMap((wall) => {
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
        (lid ? lidThreadCuts : threadCuts).push(threadTool(o.thread, plate + boss).translate(x, y, zIn));
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
      threadCuts.push(place(tool, wall, o.offset));
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

  if (p.bodyVent !== 'none' && p.bodyVentWalls === 'floor') {
    const cells = plateVent(p.bodyVent, p.bodyVentSize, p.bodyVentGap, p.bodyVentLength, p.bodyVentArea, t + 2, floorBlocked);
    if (!cells.length) warn('note.noRoomBodyVents');
    for (const c of cells) cuts.push(prism(c.drawing.translate(c.x, c.y), t + 2, -1));
  } else if (p.bodyVent !== 'none') {
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
  if (cuts.length || threadCuts.length) {
    body = cutAll(body, cuts);
    for (const tool of threadCuts) body = body.cut(tool) as Shape3D;
    yield { label: 'stage.cutouts', parts: [{ name: 'body', shape: body }] };
  }

  // --- lid, modelled in place on top of the body ----------------------------
  let lid = prism(out.profile(0), lidT, hb);
  if (hasLip) {
    let lip = prism(out.profile(t + clr), lipH, hb - lipH).cut(prism(out.profile(t + clr + lipW), lipH + 2, hb - lipH - 1)) as Shape3D;
    const gaps = [...lipSlits, ...posts.map(([x, y]) => makeCylinder(postR + clr + 0.3, lipH + 2, [x, y, hb - lipH - 1]) as Shape3D)];
    lip = cutAll(lip, gaps);
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

  // Flip it over for printing: outside face on the bed, next to the body.
  const reach = body.boundingBox.bounds[1][0];
  lid = lid.rotate(180, O, Y).translate(reach + 10 + out.hx, 0, H);

  const parts: Part[] = [
    { name: 'body', shape: body },
    { name: 'lid', shape: lid },
  ];
  yield { label: 'stage.lid', parts };

  const inner = { h: round1(hb - t) };
  if (p.shape === 'box') notes.push({ level: 'info', key: 'note.innerSize', vars: { l: round1(p.length - 2 * t), w: round1(p.width - 2 * t), ...inner } });
  else notes.push({ level: 'info', key: 'note.innerRound', vars: { d: round1(2 * (out.inradius - t)), ...inner } });
  return { parts, notes };
}
