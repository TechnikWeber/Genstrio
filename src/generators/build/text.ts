import { drawCircle, drawEllipse, drawText, type Drawing, type Shape3D } from 'replicad';
import type { Note } from '../types';
import { cutAll, ParamError, prism, round1, roundedRect, type Build, type Part } from './common';

export interface TextParams {
  text: string;
  font: string;
  size: number;
  lineSpacing: number;
  align: 'left' | 'center' | 'right';
  style: 'raised' | 'engraved' | 'cutout' | 'letters';
  textHeight: number;
  mirror: boolean;
  bar: boolean;
  separate: boolean;
  plateShape: 'rect' | 'pill' | 'ellipse';
  plateThickness: number;
  padding: number;
  cornerRadius: number;
  plateWidth: number;
  plateHeight: number;
  border: number;
  hole: 'none' | 'left' | 'top' | 'both' | 'corners';
  holeDiameter: number;
}

/** Fonts the worker has loaded; a text can only be built in one of these. */
export const loadedFonts = new Set<string>();

// Height of a capital letter relative to the font size
const capHeights = new Map<string, number>();
function capHeight(font: string): number {
  let ratio = capHeights.get(font);
  if (!ratio) capHeights.set(font, (ratio = drawText('H', { fontSize: 100, fontFamily: font }).boundingBox.height / 100));
  return ratio;
}

/** Extrude every outline of a drawing; letters come out as a compound of solids. */
const extrude = (drawing: Drawing, h: number, z: number) => prism(drawing, h, z);

export function* buildText(p: TextParams): Build {
  if (!loadedFonts.has(p.font)) throw new ParamError('err.fontMissing');
  const lines = p.text.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 8);
  if (!lines.length) throw new ParamError('err.noText');
  const notes: Note[] = [];

  // --- lay out the lines, centred on the origin --------------------------------
  const cap = p.size;
  const fontSize = cap / capHeight(p.font);
  const step = cap * p.lineSpacing;
  const drawn = lines.map((line) => drawText(line, { fontSize, fontFamily: p.font }));
  const widths = drawn.map((d) => d.boundingBox.width);
  const textW = Math.max(...widths);
  const placed = drawn.map((d, i) => {
    const [[x0]] = d.boundingBox.bounds;
    const x = p.align === 'left' ? -textW / 2 : p.align === 'right' ? textW / 2 - widths[i] : -widths[i] / 2;
    return d.translate(x - x0, -i * step);
  });
  // Descenders hang below the last baseline, accents rise above the first line.
  const bottom = Math.min(...placed.map((d) => d.boundingBox.bounds[0][1]));
  const top = Math.max(...placed.map((d) => d.boundingBox.bounds[1][1]));
  const textH = top - bottom;
  const shiftY = -(top + bottom) / 2;

  // --- the plate -------------------------------------------------------------
  const hd = p.holeDiameter;
  const eye = hd + 4; // room a hole takes at the edge
  const hole = p.plateShape === 'ellipse' && p.hole === 'corners' ? 'both' : p.hole;
  const marginL = hole === 'left' || hole === 'both' || hole === 'corners' ? eye : 0;
  const marginR = hole === 'both' || hole === 'corners' ? eye : 0;
  const marginT = hole === 'top' ? eye : 0;
  const grow = p.plateShape === 'ellipse' ? Math.SQRT2 : 1;
  const rim = p.style === 'raised' ? p.border : 0;
  const W = Math.max(p.plateWidth, (textW + 2 * p.padding + 2 * rim) * grow + marginL + marginR);
  const Hp = Math.max(p.plateHeight, (textH + 2 * p.padding + 2 * rim) * grow + marginT);
  const outline = (inset: number): Drawing => {
    if (p.plateShape === 'ellipse') return drawEllipse(Math.max(W, Hp) / 2 - inset, Math.min(W, Hp) / 2 - inset).rotate(W >= Hp ? 0 : 90);
    const r = p.plateShape === 'pill' ? Math.min(W, Hp) / 2 : p.cornerRadius;
    return roundedRect(W - 2 * inset, Hp - 2 * inset, Math.max(0, r - inset));
  };
  const pt = p.plateThickness;
  const th = p.textHeight;

  const text = (h: number, z: number): Shape3D => {
    const solids = placed.map((d) => extrude(d.translate((marginL - marginR) / 2, shiftY - marginT / 2), h, z));
    let shape = solids.length === 1 ? solids[0] : solids.reduce((a, b) => a.fuse(b) as Shape3D);
    // A stamp prints mirrored, so its imprint reads the right way round.
    if (p.mirror) shape = shape.mirror('YZ') as Shape3D;
    return shape;
  };

  const parts: Part[] = [];
  if (p.style === 'letters') {
    let letters = text(th, 0);
    if (p.bar) {
      // A bar under every baseline joins loose letters into one piece.
      const bh = Math.max(1.2, cap * 0.14);
      for (let i = 0; i < lines.length; i++) letters = letters.fuse(prism(roundedRect(widths[i], bh, bh / 2 - 0.01).translate(placed[i].boundingBox.center[0], shiftY - i * step - bh * 0.3), th)) as Shape3D;
    }
    parts.push({ name: 'text', shape: letters });
    notes.push({ level: 'info', key: 'note.textSize', vars: { w: round1(textW), h: round1(textH) } });
    if (!p.bar) notes.push({ level: 'info', key: 'note.textLoose' });
    return { parts, notes };
  }

  let plate = prism(outline(0), pt);
  yield { label: 'stage.outer', parts: [{ name: 'plate', shape: plate }] };

  const holes: [number, number][] = [];
  const inset = hd / 2 + 2;
  if (hole === 'left' || hole === 'both') holes.push([-W / 2 + inset, 0]);
  if (hole === 'both') holes.push([W / 2 - inset, 0]);
  if (hole === 'top') holes.push([0, Hp / 2 - inset]);
  if (hole === 'corners') for (const sx of [-1, 1]) for (const sy of [-1, 1]) holes.push([sx * (W / 2 - inset), sy * (Hp / 2 - inset)]);
  plate = cutAll(plate, holes.map(([x, y]) => prism(drawCircle(hd / 2).translate(x, y), pt + 2, -1)));

  if (p.style === 'raised') {
    if (rim > 0) plate = plate.fuse(prism(outline(0), th, pt).cut(prism(outline(rim), th + 2, pt - 1))) as Shape3D;
    const relief = text(th + 0.2, pt - 0.2);
    if (p.separate) parts.push({ name: 'plate', shape: plate }, { name: 'text', shape: text(th, pt) });
    else parts.push({ name: 'plate', shape: plate.fuse(relief) as Shape3D });
  } else if (p.style === 'engraved') {
    const depth = Math.min(th, pt - 0.4);
    if (depth < th - 0.01) notes.push({ level: 'info', key: 'note.textDepth', vars: { d: round1(depth) } });
    plate = plate.cut(text(depth + 1, pt - depth)) as Shape3D;
    parts.push({ name: 'plate', shape: plate });
    // The inlay fills the engraving, for a second colour.
    if (p.separate) parts.push({ name: 'text', shape: text(depth, pt - depth) });
  } else {
    plate = plate.cut(text(pt + 2, -1)) as Shape3D;
    parts.push({ name: 'plate', shape: plate });
    if (p.font !== 'allerta-stencil') notes.push({ level: 'info', key: 'note.textIslands' });
  }

  notes.unshift({ level: 'info', key: 'note.plateSize', vars: { w: round1(W), h: round1(Hp), t: round1(p.style === 'raised' ? pt + th : pt) } });
  if (p.separate && parts.length > 1) notes.push({ level: 'info', key: 'note.textSeparate' });
  if (p.mirror) notes.push({ level: 'info', key: 'note.textMirror' });
  return { parts, notes };
}
