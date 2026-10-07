import { drawCircle, type Shape3D } from 'replicad';
import type { Bitmap } from '../image';
import type { Note } from '../types';
import { fuseAll, ParamError, prism, regionsSolid, round1, roundedRect, type Build, type Part } from './common';
import { sourceBitmap } from './relief';
import { countPoints, distanceField, frameOf, traceBand, traceRegions, traceWithin, type Field, type Frame, type Region, type SampleShape } from './trace';

export interface CutterParams {
  shape: SampleShape | 'image';
  image: string;
  invert: boolean;
  threshold: number;
  smooth: number;
  size: number;
  offset: number;
  height: number;
  wall: number;
  edge: number;
  edgeHeight: number;
  flangeWidth: number;
  flangeThickness: number;
  stamp: 'none' | 'lines' | 'areas';
  stampClearance: number;
  stampMargin: number;
  stampPlate: number;
  stampRelief: number;
  stampHandle: boolean;
}

const PEG = 8;

/**
 * The stamp that goes with a cutter: a plate that drops into it, carrying
 * whatever the picture shows inside its outline as a relief. Like the cutter
 * it is seen from the side that meets the dough, so it is mirrored too.
 */
function buildStamp(p: CutterParams, bitmap: Bitmap, field: Field, frame: Frame, notes: Note[]): Part[] {
  const edge = p.offset - p.stampClearance;
  const plateRegions = traceRegions(field, frame, edge, 0.04).map(({ outer }) => ({ outer, holes: [] }));
  if (!plateRegions.length) throw new ParamError('err.stampSmall');
  // What to raise: the ink of the picture (or what it leaves blank), as far as it lies well inside the plate.
  const keep = (edge - p.stampMargin) / frame.scale;
  const data = new Uint8Array(bitmap.width * bitmap.height);
  for (let y = 0; y < bitmap.height; y++) {
    for (let x = 0; x < bitmap.width; x++) {
      const i = y * bitmap.width + x;
      const inside = Math.min(1, Math.max(0, keep - field.data[(y + field.pad) * field.width + x + field.pad] + 0.5));
      let ink = bitmap.data[i] / 255;
      if (p.invert) ink = 1 - ink;
      ink = Math.min(1, Math.max(0, ink - p.threshold / 100 + 0.5));
      data[i] = Math.round(255 * inside * (p.stamp === 'areas' ? 1 - ink : ink));
    }
  }
  const detail = distanceField({ width: bitmap.width, height: bitmap.height, data }, { pad: field.pad, smooth: Math.min(p.smooth, 1) });
  const { regions, coarsened } = traceWithin(detail, frame, 0, 0.04, 1800);
  if (coarsened) notes.push({ level: 'info', key: 'note.traceCoarse' });

  const pt = p.stampPlate;
  let stamp = regionsSolid(plateRegions, pt);
  if (regions.length) stamp = stamp.fuse(regionsSolid(regions, p.stampRelief, pt)) as Shape3D;
  else notes.push({ level: 'warn', key: 'note.stampEmpty' });
  const parts: Part[] = [{ name: 'stamp', shape: stamp }];

  if (p.stampHandle) {
    // The grip sits where the plate is widest: the spot deepest inside the outline.
    let deepest = 0;
    for (let i = 1; i < field.data.length; i++) if (field.data[i] < field.data[deepest]) deepest = i;
    const [cx, cy] = frame.toMm([deepest % field.width, Math.floor(deepest / field.width)]);
    const room = -field.data[deepest] * frame.scale + edge;
    if (room < PEG) {
      notes.push({ level: 'warn', key: 'note.stampNoHandle' });
    } else {
      const depth = Math.min(3, pt - 0.8);
      // A square socket in the back of the plate, which lies on the bed …
      parts[0].shape = stamp.cut(prism(roundedRect(PEG + 0.3, PEG + 0.3, 0).translate(cx, cy), depth + 1, -1)) as Shape3D;
      // … and a knob with the peg that is pressed or glued into it.
      const radius = Math.min(14, Math.max(PEG, room - 1));
      const knob = prism(drawCircle(radius), 14).fuse(prism(roundedRect(PEG, PEG, 0), depth - 0.2 + 0.2, 13.8)) as Shape3D;
      parts.push({ name: 'handle', shape: knob });
    }
  }
  notes.push({ level: 'info', key: 'note.stampUse' });
  return parts;
}

const MAX_POINTS = 2400;

export function* buildCutter(p: CutterParams): Build {
  const notes: Note[] = [];
  const bitmap = sourceBitmap(p);
  const perPixel = p.size / Math.max(bitmap.width, bitmap.height);
  const reach = Math.max(p.wall, p.flangeWidth) + Math.max(0, p.offset);
  // A cutter follows the outer outline only: whatever the shape encloses is dough, too.
  const field = distanceField(bitmap, {
    threshold: p.threshold / 100,
    invert: p.shape === 'image' && p.invert,
    smooth: p.smooth,
    fillHoles: true,
    pad: (reach + 4) / perPixel + 4,
  });
  // Printed flange down, the cutter is seen from its cutting side, so the
  // outline is mirrored there and comes out right on the dough.
  const frame = frameOf(field, p.size, true);
  if (!frame) throw new ParamError('err.emptyImage');

  const edge = Math.min(p.edge, p.wall);
  const tip = edge < p.wall - 0.01 ? Math.min(p.edgeHeight, p.height - p.flangeThickness - 1) : 0;
  const flange = Math.max(p.flangeWidth, p.wall);
  let tolerance = 0.02;
  let layers: { band: Region[]; z: number; h: number }[] = [];
  for (let attempt = 0; attempt < 8; attempt++) {
    const band = (width: number) => traceBand(field, frame, p.offset, p.offset + width, tolerance);
    layers = [{ band: band(flange), z: 0, h: p.flangeThickness }];
    if (flange > p.wall + 0.01) layers.push({ band: band(p.wall), z: p.flangeThickness, h: p.height - p.flangeThickness - tip });
    else layers[0].h = p.height - tip;
    if (tip > 0) layers.push({ band: band(edge), z: p.height - tip, h: tip });
    if (layers.reduce((n, layer) => n + countPoints(layer.band), 0) <= MAX_POINTS) break;
    tolerance *= 1.6;
  }
  if (layers.some((layer) => !layer.band.length)) throw new ParamError('err.emptyImage');
  if (tolerance > 0.05) notes.push({ level: 'info', key: 'note.traceCoarse' });

  const solids = layers.map((layer) => regionsSolid(layer.band, layer.h, layer.z));
  yield { label: 'stage.flange', parts: [{ name: 'cutter', shape: solids[0] }] };
  const cutter: Shape3D = fuseAll(solids);

  const pieces = layers[0].band.length;
  notes.push({ level: 'info', key: 'note.cutterSize', vars: { w: round1(frame.width + 2 * p.offset), h: round1(frame.height + 2 * p.offset), o: round1(frame.width + 2 * (p.offset + flange)) } });
  notes.push({ level: 'info', key: 'note.cutterPrint' });
  if (pieces > 1) notes.push({ level: 'warn', key: 'note.cutterPieces', vars: { n: pieces } });
  if (edge < 0.4) notes.push({ level: 'info', key: 'note.cutterEdge' });
  const parts: Part[] = [{ name: 'cutter', shape: cutter }];
  if (p.stamp !== 'none' && p.shape === 'image') {
    yield { label: 'stage.cutter', parts: [...parts] };
    // Laid out side by side: cutter, stamp, grip.
    let x = frame.width / 2 + Math.max(0, p.offset) + flange + 4;
    for (const part of buildStamp(p, bitmap, field, frame, notes)) {
      const [[x0], [x1]] = part.shape.boundingBox.bounds;
      part.shape = part.shape.translate([x - x0, 0, 0]) as Shape3D;
      x += x1 - x0 + 4;
      parts.push(part);
    }
  }
  return { parts, notes };
}
