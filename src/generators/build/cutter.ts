import type { Shape3D } from 'replicad';
import type { Note } from '../types';
import { fuseAll, ParamError, regionsSolid, round1, type Build } from './common';
import { sourceBitmap } from './relief';
import { countPoints, distanceField, frameOf, traceBand, type Region, type SampleShape } from './trace';

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
  return { parts: [{ name: 'cutter', shape: cutter }], notes };
}
