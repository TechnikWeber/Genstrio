import qrcode from 'qrcode-generator';
import { drawCircle, type Shape3D } from 'replicad';
import type { Note } from '../types';
import { cutAll, ParamError, prism, regionsSolid, round1, roundedRect, type Build, type Part } from './common';
import { layoutText, textSolid } from './text';
import { gridRegions, type Region } from './trace';

export interface QrParams {
  text: string;
  ecc: 'L' | 'M' | 'Q' | 'H';
  size: number;
  quiet: number;
  style: 'raised' | 'engraved';
  relief: number;
  separate: boolean;
  plateThickness: number;
  cornerRadius: number;
  hole: 'none' | 'top' | 'left';
  holeDiameter: number;
  label: string;
  font: string;
  labelSize: number;
}

export interface QrMatrix {
  /** Modules along one side. */
  count: number;
  version: number;
  dark: (row: number, col: number) => boolean;
}

/** Encode a text as the smallest QR code that holds it at the given error correction. */
export function qrMatrix(text: string, ecc: QrParams['ecc']): QrMatrix {
  // The encoder takes one byte per character, so the text goes in as UTF-8.
  const bytes = String.fromCharCode(...new TextEncoder().encode(text));
  const code = qrcode(0, ecc);
  try {
    code.addData(bytes, 'Byte');
    code.make();
  } catch {
    throw new ParamError('err.qrTooLong');
  }
  const count = code.getModuleCount();
  return { count, version: (count - 17) / 4, dark: (row, col) => code.isDark(row, col) };
}

// Corners pulled in by this much part modules that only touch diagonally,
// which would otherwise share an edge no solid can have.
const INSET = 0.01;

export function* buildQr(p: QrParams): Build {
  const text = p.text.trim();
  if (!text) throw new ParamError('err.noText');
  const notes: Note[] = [];
  const matrix = qrMatrix(text, p.ecc);
  const cell = p.size / matrix.count;
  const quiet = p.quiet * cell;
  const side = p.size + 2 * quiet;

  const label = p.label.trim() ? layoutText(p.label, p.font, p.labelSize, 1.5, 'center') : null;
  const labelBand = label ? label.height + Math.max(quiet, p.labelSize * 0.6) : 0;
  const hd = p.holeDiameter;
  const eye = p.hole === 'none' ? 0 : hd + 4;
  const W = Math.max(side, label ? label.width + 2 * quiet : 0) + (p.hole === 'left' ? eye : 0);
  const H = side + labelBand + (p.hole === 'top' ? eye : 0);
  // Centre of the code on a plate centred on the origin
  const cx = p.hole === 'left' ? eye / 2 : 0;
  const cy = -H / 2 + labelBand + side / 2;
  const pt = p.plateThickness;

  let plate = prism(roundedRect(W, H, p.cornerRadius), pt);
  if (p.hole === 'top') plate = cutAll(plate, [prism(drawCircle(hd / 2).translate(0, H / 2 - eye / 2), pt + 2, -1)]);
  if (p.hole === 'left') plate = cutAll(plate, [prism(drawCircle(hd / 2).translate(-W / 2 + eye / 2, cy), pt + 2, -1)]);
  yield { label: 'stage.outer', parts: [{ name: 'plate', shape: plate }] };

  const regions: Region[] = gridRegions(matrix.dark, matrix.count, cell, INSET).map(({ outer, holes }) => ({
    outer: outer.map(([x, y]) => [x + cx, y + cy]),
    holes: holes.map((hole) => hole.map(([x, y]) => [x + cx, y + cy])),
  }));
  const marks = (h: number, z: number): Shape3D => {
    const code = regionsSolid(regions, h, z);
    return label ? (code.fuse(textSolid(label, h, z, cx, -H / 2 + labelBand / 2 + (labelBand - label.height) / 4)) as Shape3D) : code;
  };

  const parts: Part[] = [];
  if (p.style === 'raised') {
    if (p.separate) parts.push({ name: 'plate', shape: plate }, { name: 'code', shape: marks(p.relief, pt) });
    // Set flush on the plate: fusing faces that only touch is several times quicker than fusing an overlap.
    else parts.push({ name: 'plate', shape: plate.fuse(marks(p.relief, pt)) as Shape3D });
  } else {
    const depth = Math.min(p.relief, pt - 0.4);
    if (depth < p.relief - 0.01) notes.push({ level: 'info', key: 'note.textDepth', vars: { d: round1(depth) } });
    parts.push({ name: 'plate', shape: plate.cut(marks(depth + 1, pt - depth)) as Shape3D });
    if (p.separate) parts.push({ name: 'code', shape: marks(depth, pt - depth) });
  }

  notes.unshift({ level: 'info', key: 'note.qrSize', vars: { n: matrix.count, v: matrix.version, m: Math.round(cell * 100) / 100, w: round1(W), h: round1(H) } });
  if (cell < 0.8) notes.push({ level: 'warn', key: 'note.qrFine', vars: { m: Math.round(cell * 100) / 100 } });
  notes.push({ level: 'info', key: p.separate ? 'note.qrSeparate' : p.style === 'raised' ? 'note.qrColour' : 'note.qrFill' });
  return { parts, notes };
}
