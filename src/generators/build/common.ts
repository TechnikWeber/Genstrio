import { assembleWire, basicFaceExtrusion, draw, drawCircle, drawPolysides, drawRoundedRectangle, makeCompound, makeFace, makeLine, Vector, type Drawing, type Shape3D, type Sketch } from 'replicad';
import type { Note } from '../types';
import type { Pt, Region } from './trace';

export type Vec3 = [number, number, number];
export type Placement = Vec3 | [number, number, number, number];

export interface Part {
  name: string;
  shape: Shape3D;
  /** Positions at which the preview shows the part, optionally turned about Z by a fourth value in degrees. Exports contain it once. */
  instances?: Placement[];
  /** How the preview moves the part from its print position into the assembly: turned over about Y, then shifted. */
  assembled?: { flip: boolean; offset: Vec3 };
}

/** Triangles with shared corners, for what a CAD solid would be too heavy for. */
export interface TriMesh {
  vertices: Float32Array;
  triangles: Uint32Array;
  /** Brightness (0–1) per vertex, shown in the preview. */
  shade?: Float32Array;
}

/** A part made of triangles instead of CAD geometry, such as a lithophane. */
export interface MeshPart {
  name: string;
  mesh: TriMesh;
}

export interface Stage {
  label: string;
  parts: Part[];
}

export interface BuildResult {
  parts: Part[];
  /** Parts that exist only as a mesh; a model with any cannot be exported as STEP. */
  meshes?: MeshPart[];
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

/** Regions (outlines in mm with their holes) as one solid, h high from z. */
export function regionsSolid(regions: Region[], h: number, z = 0): Shape3D {
  const wire = (loop: Pt[]) => assembleWire(loop.map(([x, y], i) => makeLine([x, y, z], [...loop[(i + 1) % loop.length], z])));
  const solids = regions.map(({ outer, holes }) => basicFaceExtrusion(makeFace(wire(outer), holes.map(wire)), new Vector([0, 0, h])) as Shape3D);
  return solids.length === 1 ? solids[0] : (makeCompound(solids) as Shape3D);
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

const camCache = new Map<string, Shape3D>();

/**
 * A threaded rod along +Z, from z = -runout to len + runout, with a rounded thread: a
 * circle, set off-centre by half the thread depth, extruded with one twist per
 * pitch. The flanks have the 30° of a V thread at mid-depth, and the single
 * smooth surface is something the kernel cuts reliably, unlike a groove swept
 * along a helix. Cut it out of a part for an internal thread, or cut away
 * everything around it for an external one. `rMajor` is the crest radius.
 */
export function threadCam(rMajor: number, pitch: number, len: number, runout = 1): Shape3D {
  const key = `${rMajor.toFixed(3)}/${pitch.toFixed(3)}/${len.toFixed(2)}/${runout}`;
  let cam = camCache.get(key);
  if (!cam) {
    const e = threadDepth(pitch) / 2;
    const height = len + 2 * runout;
    const circle = drawCircle(rMajor - e).translate(e, 0).sketchOnPlane('XY', -runout) as Sketch;
    cam = circle.extrude(height, { twistAngle: (360 * height) / pitch }) as Shape3D;
    if (camCache.size > 12) camCache.clear();
    camCache.set(key, cam);
  }
  return cam.clone() as Shape3D;
}

export const threadDepth = (pitch: number) => 0.54 * pitch;

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
