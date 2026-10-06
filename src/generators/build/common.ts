import { drawRoundedRectangle, makeCompound, type Shape3D, type Sketch } from 'replicad';
import type { Note } from '../types';

export type Vec3 = [number, number, number];

export interface Part {
  name: string;
  shape: Shape3D;
  /** Positions at which the preview shows the part. Exports contain it once. */
  instances?: Vec3[];
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

/** Rounded box centred on the Z axis, standing on z. */
export function roundedBox(l: number, w: number, r: number, h: number, z = 0): Shape3D {
  const rr = Math.min(r, Math.min(l, w) / 2 - 0.01);
  const drawing = rr > 0.05 ? drawRoundedRectangle(l, w, rr) : drawRoundedRectangle(l, w);
  return (drawing.sketchOnPlane('XY', z) as Sketch).extrude(h) as Shape3D;
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
