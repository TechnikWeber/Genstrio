import { drawCircle, drawEllipse, type Drawing, type Shape3D } from 'replicad';
import { decodeImage, type Bitmap } from '../image';
import type { Note } from '../types';
import { cutAll, ParamError, prism, regionsSolid, round1, roundedRect, type Build, type Part, type TriMesh } from './common';
import { lithophaneMesh, type LithophaneParams } from './lithophane';
import { countPoints, distanceField, frameOf, sampleMask, traceRegions, traceWithin, type Region, type SampleShape } from './trace';

export interface ReliefParams {
  shape: SampleShape | 'image';
  image: string;
  invert: boolean;
  threshold: number;
  smooth: number;
  size: number;
  style: 'raised' | 'engraved' | 'cutout' | 'shape' | 'heightmap';
  relief: number;
  separate: boolean;
  mirror: boolean;
  plateShape: 'rect' | 'ellipse' | 'contour';
  plateThickness: number;
  padding: number;
  cornerRadius: number;
  hole: 'none' | 'top' | 'left' | 'corners';
  holeDiameter: number;
}

/** The picture a shape generator works on: a built-in shape or the one the user loaded. */
export function sourceBitmap(p: { shape: string; image: string }): Bitmap {
  if (p.shape !== 'image') return sampleMask(p.shape as SampleShape);
  const bitmap = decodeImage(p.image);
  if (!bitmap) throw new ParamError('err.noImage');
  return bitmap;
}

// More corners than this and the boolean operations take many seconds.
const MAX_POINTS = 1600;

/**
 * A relief whose height follows the darkness of the picture, with every
 * shade in between: the same sheet a lithophane is, laid on its back.
 */
function heightmap(p: ReliefParams, bitmap: Bitmap): { mesh: TriMesh; width: number; height: number } {
  const ink = p.shape === 'image' && p.invert ? bitmap.data.map((v) => 255 - v) : bitmap.data;
  const scale = p.size / Math.max(bitmap.width, bitmap.height);
  const sheet = lithophaneMesh(
    // Ink is height, where a lithophane makes brightness thin.
    { form: 'flat', width: bitmap.width * scale, border: 0, minThickness: p.plateThickness, maxThickness: p.plateThickness + p.relief, smoothing: p.smooth, mirror: p.mirror, negative: true } as LithophaneParams,
    { width: bitmap.width, height: bitmap.height, data: ink },
  );
  const v = sheet.mesh.vertices;
  // Standing, its thickness points to −y; lying, it points up.
  for (let i = 0; i < v.length; i += 3) [v[i + 1], v[i + 2]] = [v[i + 2] - sheet.height / 2, -v[i + 1]];
  return { mesh: { vertices: v, triangles: sheet.mesh.triangles }, width: sheet.width, height: sheet.height };
}

export function* buildRelief(p: ReliefParams): Build {
  const notes: Note[] = [];
  const bitmap = sourceBitmap(p);
  if (p.style === 'heightmap') {
    const { mesh, width, height } = heightmap(p, bitmap);
    notes.push({ level: 'info', key: 'note.plateSize', vars: { w: round1(width), h: round1(height), t: round1(p.plateThickness + p.relief) } }, { level: 'info', key: 'note.heightmap' });
    return { parts: [], meshes: [{ name: 'relief', mesh }], notes };
  }
  const perPixel = p.size / Math.max(bitmap.width, bitmap.height);
  const options = { threshold: p.threshold / 100, invert: p.shape === 'image' && p.invert, smooth: p.smooth, pad: (p.padding + 4) / perPixel + 4 };
  const field = distanceField(bitmap, options);
  const frame = frameOf(field, p.size, p.mirror);
  if (!frame) throw new ParamError('err.emptyImage');
  const traced = traceWithin(field, frame, 0, 0.04, MAX_POINTS);
  const motif = traced.regions;
  if (!motif.length) throw new ParamError('err.emptyImage');
  if (traced.coarsened) notes.push({ level: 'info', key: 'note.traceCoarse' });
  notes.push({ level: 'info', key: 'note.motifSize', vars: { w: round1(frame.width), h: round1(frame.height) } });

  const th = p.relief;
  const parts: Part[] = [];
  if (p.style === 'shape') {
    parts.push({ name: 'motif', shape: regionsSolid(motif, th) });
    if (motif.length > 1) notes.push({ level: 'info', key: 'note.motifLoose', vars: { n: motif.length } });
    return { parts, notes };
  }

  // --- the plate -------------------------------------------------------------
  const pt = p.plateThickness;
  const hd = p.holeDiameter;
  const eye = hd + 4;
  let plate: Shape3D;
  let W: number;
  let H: number;
  let shift: [number, number] = [0, 0];
  if (p.plateShape === 'contour') {
    // The plate follows the motif at a distance, like the edge of a sticker.
    const solid = distanceField(bitmap, { ...options, fillHoles: true });
    const outline = traceRegions(solid, frame, p.padding, 0.06);
    if (!outline.length) throw new ParamError('err.emptyImage');
    if (outline.length > 1) notes.push({ level: 'warn', key: 'note.platePieces', vars: { n: outline.length } });
    plate = regionsSolid(outline, pt);
    const points = outline.flatMap((r) => r.outer);
    const xs = points.map(([x]) => x);
    const ys = points.map(([, y]) => y);
    W = Math.max(...xs) - Math.min(...xs);
    H = Math.max(...ys) - Math.min(...ys);
    if (p.hole !== 'none') {
      // A lug where the outline reaches furthest up or left, clear of the motif.
      const left = p.hole === 'left';
      const [ax, ay] = points.reduce((best, pnt) => ((left ? pnt[0] < best[0] : pnt[1] > best[1]) ? pnt : best));
      const out = Math.max(0, hd / 2 + 1 - p.padding);
      const centre: [number, number] = left ? [ax - out, ay] : [ax, ay + out];
      plate = plate.fuse(prism(drawCircle(hd / 2 + 2.2).translate(...centre), pt)) as Shape3D;
      plate = cutAll(plate, [prism(drawCircle(hd / 2).translate(...centre), pt + 2, -1)]);
    }
  } else {
    const hole = p.plateShape === 'ellipse' && p.hole === 'corners' ? 'top' : p.hole;
    const marginL = hole === 'left' || hole === 'corners' ? eye : 0;
    const marginR = hole === 'corners' ? eye : 0;
    const marginT = hole === 'top' ? eye : 0;
    const grow = p.plateShape === 'ellipse' ? Math.SQRT2 : 1;
    W = (frame.width + 2 * p.padding) * grow + marginL + marginR;
    H = (frame.height + 2 * p.padding) * grow + marginT;
    const outline: Drawing = p.plateShape === 'ellipse' ? drawEllipse(Math.max(W, H) / 2, Math.min(W, H) / 2).rotate(W >= H ? 0 : 90) : roundedRect(W, H, p.cornerRadius);
    plate = prism(outline, pt);
    const inset = hd / 2 + 2;
    const holes: [number, number][] = [];
    if (hole === 'left') holes.push([-W / 2 + inset, 0]);
    if (hole === 'top') holes.push([0, H / 2 - inset]);
    if (hole === 'corners') for (const sx of [-1, 1]) for (const sy of [-1, 1]) holes.push([sx * (W / 2 - inset), sy * (H / 2 - inset)]);
    plate = cutAll(plate, holes.map(([x, y]) => prism(drawCircle(hd / 2).translate(x, y), pt + 2, -1)));
    shift = [(marginL - marginR) / 2, -marginT / 2];
  }
  yield { label: 'stage.outer', parts: [{ name: 'plate', shape: plate }] };

  const placed: Region[] = motif.map(({ outer, holes }) => ({
    outer: outer.map(([x, y]) => [x + shift[0], y + shift[1]]),
    holes: holes.map((loop) => loop.map(([x, y]) => [x + shift[0], y + shift[1]])),
  }));
  const solid = (h: number, z: number) => regionsSolid(placed, h, z);

  if (p.style === 'raised') {
    if (p.separate) parts.push({ name: 'plate', shape: plate }, { name: 'motif', shape: solid(th, pt) });
    else parts.push({ name: 'plate', shape: plate.fuse(solid(th, pt)) as Shape3D });
  } else if (p.style === 'engraved') {
    const depth = Math.min(th, pt - 0.4);
    if (depth < th - 0.01) notes.push({ level: 'info', key: 'note.textDepth', vars: { d: round1(depth) } });
    parts.push({ name: 'plate', shape: plate.cut(solid(depth + 1, pt - depth)) as Shape3D });
    if (p.separate) parts.push({ name: 'motif', shape: solid(depth, pt - depth) });
  } else {
    parts.push({ name: 'plate', shape: plate.cut(solid(pt + 2, -1)) as Shape3D });
    if (motif.some((r) => r.holes.length)) notes.push({ level: 'info', key: 'note.motifIslands' });
  }

  notes.push({ level: 'info', key: 'note.plateSize', vars: { w: round1(W), h: round1(H), t: round1(p.style === 'raised' ? pt + th : pt) } });
  if (p.separate && parts.length > 1) notes.push({ level: 'info', key: 'note.motifSeparate' });
  if (p.mirror) notes.push({ level: 'info', key: 'note.motifMirror' });
  if (countPoints(motif) > MAX_POINTS) notes.push({ level: 'warn', key: 'note.traceBusy' });
  return { parts, notes };
}
