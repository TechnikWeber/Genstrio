import { draw, drawCircle, drawPolysides, drawRoundedRectangle, makeCompound, type Drawing, type Shape3D, type Sketch } from 'replicad';
import type { Note } from '../types';

export type Vec3 = [number, number, number];

export interface Part {
  name: string;
  shape: Shape3D;
  /** Positions at which the preview shows the part. Exports contain it once. */
  instances?: Vec3[];
  /** How the preview moves the part from its print position into the assembly: turned over about Y, then shifted. */
  assembled?: { flip: boolean; offset: Vec3 };
}

export interface Stage {
  label: string;
  parts: Part[];
}

export interface BuildResult {
  parts: Part[];
  notes: Note[];
  /** Outline (width, depth) drawn on the bed, e.g. the drawer of an organizer. */
  frame?: [number, number];
}

export type Build = Generator<Stage, BuildResult, void>;

/** An error caused by parameters, shown translated in the UI. */
export class ParamError extends Error {
  constructor(public key: string) {
    super(key);
  }
}

/** Rectangle centred on the origin; the radius is clamped to what fits. */
export function roundedRect(l: number, w: number, r: number): Drawing {
  const rr = Math.min(r, Math.min(l, w) / 2 - 0.01);
  return rr > 0.05 ? drawRoundedRectangle(l, w, rr) : drawRoundedRectangle(l, w);
}

/** Extrude a drawing along Z, starting at z. */
export function prism(drawing: Drawing, h: number, z = 0): Shape3D {
  return (drawing.sketchOnPlane('XY', z) as Sketch).extrude(h) as Shape3D;
}

/** Rounded box centred on the Z axis, standing on z. */
export function roundedBox(l: number, w: number, r: number, h: number, z = 0): Shape3D {
  return prism(roundedRect(l, w, r), h, z);
}

export type RZ = [number, number];

/** Revolve a closed (radius, z) contour around the Z axis. */
export function revolveZ(points: RZ[]): Shape3D {
  const pts = points.filter((pt, i) => {
    const prev = points[(i + points.length - 1) % points.length];
    return i === 0 || Math.hypot(pt[0] - prev[0], pt[1] - prev[1]) > 1e-6;
  });
  let pen = draw(pts[0]);
  for (const pt of pts.slice(1)) pen = pen.lineTo(pt);
  return (pen.close().sketchOnPlane('XZ') as Sketch).revolve() as Shape3D;
}

export type Pattern = 'slots' | 'holes' | 'hex' | 'triangles' | 'grid';

export interface Cell {
  x: number;
  y: number;
  /** Half extents of the cell's bounding box. */
  hw: number;
  hh: number;
  drawing: Drawing;
}

const MAX_CELLS = 140;

/**
 * Fill a w × h field (centred on the origin) with a pattern of openings.
 * `size` is the opening width, `gap` the web between openings. `keep` decides
 * per cell whether it may be cut. Coarsens the pattern rather than exceed
 * MAX_CELLS, which keeps the boolean operations fast.
 */
export function patternCells(
  kind: Pattern,
  size: number,
  gap: number,
  slotLength: number,
  w: number,
  h: number,
  keep: (x: number, y: number, hw: number, hh: number) => boolean,
): { cells: Cell[]; coarsened: boolean } {
  const SIN60 = Math.sqrt(3) / 2;
  const cw = size;
  const ch = kind === 'slots' ? Math.max(size, Math.min(slotLength, h)) : kind === 'hex' ? size / SIN60 : kind === 'triangles' ? size * SIN60 : size;
  const staggered = kind === 'holes' || kind === 'hex';
  let base: Drawing;
  let flipped: Drawing | null = null;
  if (kind === 'slots') base = roundedRect(cw, ch, size / 2 - 0.01);
  else if (kind === 'holes') base = drawCircle(size / 2);
  else if (kind === 'hex') base = drawPolysides(ch / 2, 6);
  else if (kind === 'grid') base = roundedRect(size, size, 0);
  else {
    const tri = (s: number) => draw([-cw / 2, (-s * ch) / 2]).lineTo([cw / 2, (-s * ch) / 2]).lineTo([0, (s * ch) / 2]).close();
    base = tri(1);
    flipped = tri(-1);
  }

  let g = gap;
  for (let attempt = 0; ; attempt++) {
    const px = kind === 'triangles' ? cw / 2 + g / SIN60 : cw + g;
    const py = staggered ? px * SIN60 : ch + g;
    const nx = Math.floor((w - cw) / px) + 1;
    const ny = Math.floor((h - ch) / py) + 1;
    const spots: [number, number, boolean][] = [];
    if (w >= cw && h >= ch) {
      for (let j = 0; j < ny; j++) {
        const shifted = staggered && j % 2 === 1;
        const n = shifted ? nx - 1 : nx;
        for (let i = 0; i < n; i++) {
          const x = (i - (n - 1) / 2) * px;
          const y = (j - (ny - 1) / 2) * py;
          if (keep(x, y, cw / 2, ch / 2)) spots.push([x, y, (i + j) % 2 === 1]);
        }
      }
    }
    if (spots.length <= MAX_CELLS || attempt > 30) {
      const cells = spots.slice(0, MAX_CELLS).map(([x, y, flip]) => ({ x, y, hw: cw / 2, hh: ch / 2, drawing: flip && flipped ? flipped : base }));
      return { cells, coarsened: attempt > 0 };
    }
    g = (cw + g) * 1.2 - cw;
  }
}

export function fuseAll(shapes: Shape3D[]): Shape3D {
  return shapes.reduce((a, b) => a.fuse(b) as Shape3D);
}

/** Subtract many tools in a single boolean operation. */
export function cutAll(shape: Shape3D, tools: Shape3D[]): Shape3D {
  if (!tools.length) return shape;
  const tool = tools.length === 1 ? tools[0] : (makeCompound(tools) as Shape3D);
  return shape.cut(tool) as Shape3D;
}

export const round1 = (n: number) => Math.round(n * 10) / 10;
