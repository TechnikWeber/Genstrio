// From pixels to outlines: a bitmap becomes a distance field, and a contour of
// that field at any distance is the shape grown or shrunk by that much. This
// is what lets a cookie cutter put a wall around a picture without ever
// offsetting a curve. No replicad in here, so it runs anywhere.
import type { Bitmap } from '../image';

export type Pt = [number, number];

/** An area bounded by a counter-clockwise outline, with clockwise holes. */
export interface Region {
  outer: Pt[];
  holes: Pt[][];
}

/** Signed distance to the edge of a shape in pixels, negative inside. */
export interface Field {
  width: number;
  height: number;
  data: Float32Array;
  /** Pixels added around the bitmap on every side. */
  pad: number;
}

export interface FieldOptions {
  /** Share of ink (0–1) from which a pixel belongs to the shape. */
  threshold?: number;
  invert?: boolean;
  /** Room around the bitmap in pixels: as far as the shape may grow. */
  pad?: number;
  /** Close everything the shape encloses, leaving only its outer outline. */
  fillHoles?: boolean;
  /** Passes of a blur that take the pixel steps out of the outline. */
  smooth?: number;
}

/**
 * Signed distance of every pixel to the edge of the shape, which runs where
 * the coverage passes one half. The edge is traced first, to a fraction of a
 * pixel; each pixel then learns its nearest piece of edge from its
 * neighbours, in two sweeps there and back. Distances are exact for that
 * piece, so an outline grown from a crisp square is as true as one from a
 * soft-edged drawing.
 */
function distances(cover: Float32Array, width: number, height: number): Float32Array {
  const loops = contours({ width, height, data: cover.map((c) => 0.5 - c), pad: 0 }, 0);
  const ax: number[] = [];
  const ay: number[] = [];
  const bx: number[] = [];
  const by: number[] = [];
  for (const loop of loops) {
    for (let i = 0; i < loop.length; i++) {
      const next = loop[(i + 1) % loop.length];
      ax.push(loop[i][0]);
      ay.push(loop[i][1]);
      bx.push(next[0] - loop[i][0]);
      by.push(next[1] - loop[i][1]);
    }
  }
  const squared = new Float32Array(width * height).fill(1e12);
  const nearest = new Int32Array(width * height).fill(-1);
  const offer = (i: number, x: number, y: number, s: number) => {
    const px = x - ax[s];
    const py = y - ay[s];
    const len = bx[s] * bx[s] + by[s] * by[s];
    const t = len > 0 ? Math.min(1, Math.max(0, (px * bx[s] + py * by[s]) / len)) : 0;
    const d = (px - t * bx[s]) ** 2 + (py - t * by[s]) ** 2;
    if (d < squared[i]) {
      squared[i] = d;
      nearest[i] = s;
    }
  };
  for (let s = 0; s < ax.length; s++) {
    const x0 = Math.max(0, Math.floor(Math.min(ax[s], ax[s] + bx[s])) - 1);
    const x1 = Math.min(width - 1, Math.ceil(Math.max(ax[s], ax[s] + bx[s])) + 1);
    const y0 = Math.max(0, Math.floor(Math.min(ay[s], ay[s] + by[s])) - 1);
    const y1 = Math.min(height - 1, Math.ceil(Math.max(ay[s], ay[s] + by[s])) + 1);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) offer(y * width + x, x, y, s);
  }
  const learn = (i: number, x: number, y: number, from: number) => {
    if (nearest[from] >= 0) offer(i, x, y, nearest[from]);
  };
  for (let round = 0; round < 2; round++) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (x > 0) learn(i, x, y, i - 1);
        if (y > 0) {
          learn(i, x, y, i - width);
          if (x > 0) learn(i, x, y, i - width - 1);
          if (x < width - 1) learn(i, x, y, i - width + 1);
        }
      }
    }
    for (let y = height - 1; y >= 0; y--) {
      for (let x = width - 1; x >= 0; x--) {
        const i = y * width + x;
        if (x < width - 1) learn(i, x, y, i + 1);
        if (y < height - 1) {
          learn(i, x, y, i + width);
          if (x < width - 1) learn(i, x, y, i + width + 1);
          if (x > 0) learn(i, x, y, i + width - 1);
        }
      }
    }
  }
  return squared.map((d, i) => (cover[i] > 0.5 ? -Math.sqrt(d) : Math.sqrt(d)));
}

/**
 * The distance field of a bitmap whose bytes say how much of each pixel the
 * shape covers. Partly covered pixels place the edge between pixel centres,
 * so a soft-edged picture gives a smooth outline.
 */
export function distanceField(bitmap: Bitmap, { threshold = 0.5, invert = false, pad = 2, fillHoles = false, smooth = 0 }: FieldOptions = {}): Field {
  pad = Math.max(2, Math.ceil(pad));
  const width = bitmap.width + 2 * pad;
  const height = bitmap.height + 2 * pad;
  const cover = new Float32Array(width * height);
  for (let y = 0; y < bitmap.height; y++) {
    for (let x = 0; x < bitmap.width; x++) {
      const a = bitmap.data[y * bitmap.width + x] / 255;
      cover[(y + pad) * width + x + pad] = Math.min(1, Math.max(0, (invert ? 1 - a : a) - threshold + 0.5));
    }
  }

  if (fillHoles) {
    // Whatever cannot be reached from the rim without crossing the shape is inside it.
    const open = new Uint8Array(width * height);
    const stack = [0];
    open[0] = 1;
    while (stack.length) {
      const i = stack.pop() as number;
      const x = i % width;
      for (const j of [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, i - width, i + width]) {
        if (j < 0 || j >= open.length || open[j] || cover[j] >= 0.5) continue;
        open[j] = 1;
        stack.push(j);
      }
    }
    for (let i = 0; i < open.length; i++) if (!open[i] && cover[i] < 0.5) cover[i] = 1;
  }

  let data = distances(cover, width, height);

  for (let pass = 0; pass < smooth; pass++) {
    const next = new Float32Array(data);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x;
        next[i] =
          (4 * data[i] + 2 * (data[i - 1] + data[i + 1] + data[i - width] + data[i + width]) + data[i - width - 1] + data[i - width + 1] + data[i + width - 1] + data[i + width + 1]) / 16;
      }
    }
    data = next;
  }
  return { width, height, data, pad };
}

// Which sides of a cell a contour joins, by which corners lie inside
// (bits: top-left, top-right, bottom-right, bottom-left; sides: top, right, bottom, left).
const SEGMENTS: number[][] = [[], [3, 0], [0, 1], [3, 1], [1, 2], [], [0, 2], [3, 2], [2, 3], [0, 2], [], [1, 2], [3, 1], [0, 1], [3, 0], []];

/** The closed contours of a field at a level, in pixel coordinates. */
export function contours({ width, height, data }: Field, level = 0): Pt[][] {
  // Nothing is inside on the rim, so every contour closes.
  const at = (x: number, y: number) => {
    const v = data[y * width + x];
    return x === 0 || y === 0 || x === width - 1 || y === height - 1 ? Math.max(v, level + 1) : v;
  };
  // A contour crosses grid edges; each crossing is joined to two others.
  const links = new Int32Array(4 * width * height).fill(-1);
  const join = (a: number, b: number) => {
    links[2 * a + (links[2 * a] < 0 ? 0 : 1)] = b;
    links[2 * b + (links[2 * b] < 0 ? 0 : 1)] = a;
  };
  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const v0 = at(x, y);
      const v1 = at(x + 1, y);
      const v2 = at(x + 1, y + 1);
      const v3 = at(x, y + 1);
      const index = (v0 < level ? 1 : 0) | (v1 < level ? 2 : 0) | (v2 < level ? 4 : 0) | (v3 < level ? 8 : 0);
      if (index === 0 || index === 15) continue;
      const sides = [2 * (y * width + x), 2 * (y * width + x + 1) + 1, 2 * ((y + 1) * width + x), 2 * (y * width + x) + 1];
      let pairs = SEGMENTS[index];
      if (index === 5 || index === 10) {
        // Two opposite corners: the middle decides whether they are one shape.
        const joined = (v0 + v1 + v2 + v3) / 4 < level;
        pairs = (index === 5) === joined ? [0, 1, 2, 3] : [3, 0, 1, 2];
      }
      for (let k = 0; k < pairs.length; k += 2) join(sides[pairs[k]], sides[pairs[k + 1]]);
    }
  }

  const point = (edge: number): Pt => {
    const cell = edge >> 1;
    const x = cell % width;
    const y = (cell - x) / width;
    const a = at(x, y);
    if (edge & 1) return [x, y + (level - a) / (at(x, y + 1) - a)];
    return [x + (level - a) / (at(x + 1, y) - a), y];
  };
  const seen = new Uint8Array(2 * width * height);
  const loops: Pt[][] = [];
  for (let start = 0; start < seen.length; start++) {
    if (seen[start] || links[2 * start] < 0) continue;
    const loop: Pt[] = [];
    let previous = -1;
    let edge = start;
    let closed = false;
    while (edge >= 0 && !seen[edge]) {
      seen[edge] = 1;
      loop.push(point(edge));
      const next = links[2 * edge] !== previous ? links[2 * edge] : links[2 * edge + 1];
      previous = edge;
      edge = next;
      closed = edge === start;
    }
    if (closed && loop.length >= 3) loops.push(loop);
  }
  return loops;
}

export function signedArea(loop: Pt[]): number {
  let sum = 0;
  for (let i = 0; i < loop.length; i++) {
    const [x0, y0] = loop[i];
    const [x1, y1] = loop[(i + 1) % loop.length];
    sum += x0 * y1 - x1 * y0;
  }
  return sum / 2;
}

function contains(loop: Pt[], [px, py]: Pt): boolean {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const [xi, yi] = loop[i];
    const [xj, yj] = loop[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Douglas–Peucker on an open run of points; the ends stay.
function thin(points: Pt[], tolerance: number): Pt[] {
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop() as [number, number];
    const [ax, ay] = points[a];
    const dx = points[b][0] - ax;
    const dy = points[b][1] - ay;
    const len = Math.hypot(dx, dy) || 1;
    let worst = 0;
    let at = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((points[i][0] - ax) * dy - (points[i][1] - ay) * dx) / len;
      if (d > worst) {
        worst = d;
        at = i;
      }
    }
    if (at < 0 || worst <= tolerance) continue;
    keep[at] = 1;
    stack.push([a, at], [at, b]);
  }
  return points.filter((_, i) => keep[i]);
}

/** Drop the points of a closed outline that lie within `tolerance` of the line through their neighbours. */
export function simplify(loop: Pt[], tolerance: number): Pt[] {
  if (loop.length < 5) return loop;
  let far = 1;
  let best = 0;
  for (let i = 1; i < loop.length; i++) {
    const d = Math.hypot(loop[i][0] - loop[0][0], loop[i][1] - loop[0][1]);
    if (d > best) {
      best = d;
      far = i;
    }
  }
  const a = thin(loop.slice(0, far + 1), tolerance);
  const b = thin([...loop.slice(far), loop[0]], tolerance);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

/** Sort outlines into areas and the holes in them, by how deeply each is nested. */
export function nest(loops: Pt[][]): Region[] {
  const items = loops.map((loop) => ({ loop, signed: signedArea(loop), area: 0, depth: 0 }));
  for (const item of items) item.area = Math.abs(item.signed);
  for (const item of items) item.depth = items.filter((other) => other !== item && other.area > item.area && contains(other.loop, item.loop[0])).length;
  const turned = (item: (typeof items)[number], ccw: boolean) => (item.signed > 0 === ccw ? item.loop : [...item.loop].reverse());
  const regions = new Map<(typeof items)[number], Region>();
  for (const item of items) if (item.depth % 2 === 0) regions.set(item, { outer: turned(item, true), holes: [] });
  for (const item of items) {
    if (item.depth % 2 === 0) continue;
    let parent: (typeof items)[number] | undefined;
    for (const other of items) {
      if (other.depth !== item.depth - 1 || other.area <= item.area || !contains(other.loop, item.loop[0])) continue;
      if (!parent || other.area < parent.area) parent = other;
    }
    if (parent) regions.get(parent)?.holes.push(turned(item, false));
  }
  return [...regions.values()];
}

export interface Frame {
  /** Pixel coordinates to millimetres, centred on the shape, y pointing up. */
  toMm: (p: Pt) => Pt;
  /** Millimetres per pixel. */
  scale: number;
  /** Size of the shape in mm. */
  width: number;
  height: number;
}

/** Fit the shape of a field, as it is at level 0, to `size` mm on its longer side. */
export function frameOf(field: Field, size: number, mirror = false): Frame | null {
  const loops = contours(field, 0);
  if (!loops.length) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const loop of loops) {
    for (const [x, y] of loop) {
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  }
  const extent = Math.max(x1 - x0, y1 - y0);
  if (!(extent > 0)) return null;
  const scale = size / extent;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const sx = mirror ? -scale : scale;
  return { scale, width: (x1 - x0) * scale, height: (y1 - y0) * scale, toMm: ([x, y]) => [(x - cx) * sx, (cy - y) * scale] };
}

/**
 * The outlines of the shape of a field grown by `offset` mm (shrunk if
 * negative), in mm. They are thinned to `tolerance` mm; specks smaller than
 * `minArea` mm² are dropped.
 */
export function traceLoops(field: Field, frame: Frame, offset = 0, tolerance = 0.05, minArea = 0.3): Pt[][] {
  return contours(field, offset / frame.scale)
    .map((loop) => simplify(loop.map(frame.toMm), tolerance))
    .filter((loop) => loop.length >= 3 && Math.abs(signedArea(loop)) >= minArea);
}

/** The shape of a field grown by `offset` mm, as regions in mm. */
export function traceRegions(field: Field, frame: Frame, offset = 0, tolerance = 0.05, minArea = 0.3): Region[] {
  return nest(traceLoops(field, frame, offset, tolerance, minArea));
}

/** The band around a shape between two distances from its edge: a wall that follows the outline. */
export function traceBand(field: Field, frame: Frame, from: number, to: number, tolerance = 0.05): Region[] {
  return nest([...traceLoops(field, frame, from, tolerance), ...traceLoops(field, frame, to, tolerance)]);
}

/** Whether a point lies in any of the regions. */
export const covers = (regions: Region[], p: Pt) => regions.some((r) => contains(r.outer, p) && !r.holes.some((hole) => contains(hole, p)));

/** The area of regions, holes taken off. */
export const areaOf = (regions: Region[]) => regions.reduce((sum, r) => sum + signedArea(r.outer) + r.holes.reduce((a, hole) => a + signedArea(hole), 0), 0);

export const countPoints = (regions: Region[]) => regions.reduce((n, r) => n + r.outer.length + r.holes.reduce((m, h) => m + h.length, 0), 0);

/**
 * Trace with a growing tolerance until the outlines have at most `maxPoints`
 * corners, so a busy picture does not bring the CAD kernel to a halt.
 */
export function traceWithin(field: Field, frame: Frame, offset: number, tolerance: number, maxPoints: number): { regions: Region[]; coarsened: boolean } {
  let regions = traceRegions(field, frame, offset, tolerance);
  let coarsened = false;
  for (let attempt = 0; countPoints(regions) > maxPoints && attempt < 8; attempt++) {
    tolerance *= 1.6;
    coarsened = true;
    regions = traceRegions(field, frame, offset, tolerance, 0.3 + tolerance * tolerance * 4);
  }
  return { regions, coarsened };
}

/**
 * The dark cells of a square grid as regions with exact, right-angled
 * outlines; row 0 is at the top. Each outline is pulled in by `inset`, which
 * parts cells that only touch at a corner.
 */
export function gridRegions(dark: (row: number, col: number) => boolean, count: number, cell: number, inset = 0): Region[] {
  const is = (x: number, y: number) => x >= 0 && y >= 0 && x < count && y < count && dark(count - 1 - y, x);
  const span = count + 1;
  const id = (x: number, y: number) => y * span + x;
  // Edges run with the dark side on their left; up to two leave any corner.
  const out = new Map<number, number[]>();
  const add = (x0: number, y0: number, x1: number, y1: number) => {
    const from = id(x0, y0);
    const list = out.get(from);
    if (list) list.push(id(x1, y1));
    else out.set(from, [id(x1, y1)]);
  };
  for (let y = 0; y < count; y++) {
    for (let x = 0; x < count; x++) {
      if (!is(x, y)) continue;
      if (!is(x, y - 1)) add(x, y, x + 1, y);
      if (!is(x + 1, y)) add(x + 1, y, x + 1, y + 1);
      if (!is(x, y + 1)) add(x + 1, y + 1, x, y + 1);
      if (!is(x - 1, y)) add(x, y + 1, x, y);
    }
  }
  const xy = (v: number): Pt => [v % span, Math.floor(v / span)];
  const step = (a: number, b: number): Pt => [xy(b)[0] - xy(a)[0], xy(b)[1] - xy(a)[1]];
  const loops: Pt[][] = [];
  for (const [start, targets] of out) {
    while (targets.length) {
      const first = targets.pop() as number;
      const path = [start];
      let from = start;
      let to = first;
      for (;;) {
        const [dx, dy] = step(from, to);
        const next = out.get(to) as number[];
        // Where two cells meet at a corner, turning left keeps them apart.
        const left = (n: number) => step(to, n)[0] === -dy && step(to, n)[1] === dx;
        if (to === start && (!next.length || left(first))) break;
        const target = next.splice(next.length > 1 ? Math.max(0, next.findIndex(left)) : 0, 1)[0];
        path.push(to);
        from = to;
        to = target;
      }
      const corners = path.filter((v, i) => {
        const before = step(path[(i + path.length - 1) % path.length], v);
        const after = step(v, path[(i + 1) % path.length]);
        return before[0] !== after[0] || before[1] !== after[1];
      });
      loops.push(corners.map(xy));
    }
  }
  const half = (count * cell) / 2;
  const placed = loops.map((corners) =>
    corners.map(([x, y], i): Pt => {
      const [px, py] = corners[(i + corners.length - 1) % corners.length];
      const [nx, ny] = corners[(i + 1) % corners.length];
      // Each neighbouring edge moves the corner to its own left.
      const ix = -Math.sign(y - py) - Math.sign(ny - y);
      const iy = Math.sign(x - px) + Math.sign(nx - x);
      return [x * cell - half + ix * inset, y * cell - half + iy * inset];
    }),
  );
  return nest(placed);
}

// --- built-in pictures ---------------------------------------------------------

export type SampleShape = 'heart' | 'star' | 'flower' | 'moon' | 'circle';

const star: Pt[] = Array.from({ length: 10 }, (_, i): Pt => {
  const r = i % 2 ? 0.42 : 1;
  const a = Math.PI / 2 + (i * Math.PI) / 5;
  return [r * Math.cos(a), r * Math.sin(a)];
});

const SHAPES: Record<SampleShape, (x: number, y: number) => boolean> = {
  circle: (x, y) => x * x + y * y < 1,
  heart: (x, y) => {
    const u = x * 1.25;
    const v = y * 1.25 + 0.15;
    return (u * u + v * v - 1) ** 3 - u * u * v * v * v < 0;
  },
  star: (x, y) => contains(star, [x, y - 0.06]),
  flower: (x, y) => Math.hypot(x, y) < 0.74 + 0.26 * Math.cos(6 * Math.atan2(y, x)),
  moon: (x, y) => x * x + y * y < 1 && (x - 0.45) ** 2 + (y - 0.1) ** 2 > 0.72,
};

/** A built-in shape as a bitmap, for use without a picture. */
export function sampleMask(shape: SampleShape, size = 200): Bitmap {
  const inside = SHAPES[shape] ?? SHAPES.heart;
  const data = new Uint8Array(size * size);
  const sub = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hits = 0;
      for (let j = 0; j < sub; j++) {
        for (let i = 0; i < sub; i++) {
          const u = ((x + (i + 0.5) / sub) / size) * 2.1 - 1.05;
          const v = 1.05 - ((y + (j + 0.5) / sub) / size) * 2.1;
          if (inside(u, v)) hits++;
        }
      }
      data[y * size + x] = Math.round((255 * hits) / (sub * sub));
    }
  }
  return { width: size, height: size, data };
}

/** A small landscape, bright sky over dark hills, to show what a lithophane does with a photo. */
export function samplePhoto(width = 240, height = 180): Bitmap {
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = x / width;
      const v = y / height;
      const sun = Math.hypot((u - 0.7) * (width / height), v - 0.3);
      const step = (edge: number, at: number) => Math.min(1, Math.max(0, (at - edge) * height * 0.5 + 0.5));
      let value = 150 + 60 * (1 - v) + 110 * Math.exp(-sun * 8) + 70 * (1 - step(0.11, sun));
      // Two ranges of hills, the nearer one darker, each with a soft edge of a pixel or two
      const far = 0.6 + 0.09 * Math.sin(u * 7 + 1) + 0.04 * Math.sin(u * 19);
      const near = 0.78 + 0.08 * Math.sin(u * 5 + 3.5) + 0.03 * Math.sin(u * 23 + 1);
      value += (110 - 70 * (v - far) - value) * step(far, v);
      value += (40 - 40 * (v - near) - value) * step(near, v);
      data[y * width + x] = Math.max(0, Math.min(255, Math.round(value)));
    }
  }
  return { width, height, data };
}
