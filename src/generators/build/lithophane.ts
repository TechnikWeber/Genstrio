import { decodeImage } from '../image';
import type { Note } from '../types';
import { ParamError, round1, type Build, type TriMesh } from './common';
import { samplePhoto } from './trace';

export interface LithophaneParams {
  image: string;
  negative: boolean;
  form: 'flat' | 'arc' | 'cylinder';
  width: number;
  angle: number;
  diameter: number;
  minThickness: number;
  maxThickness: number;
  border: number;
}

// A nozzle draws lines about this wide; a finer mesh would only make the file bigger.
const FINEST = 0.4;
const MAX_COLUMNS = 640;
const MAX_CELLS = 260_000;

type Picture = { width: number; height: number; data: Uint8Array };

/** Scale a picture to another size, blending neighbouring pixels. */
function resample(src: Picture, width: number, height: number): Picture {
  if (width === src.width && height === src.height) return src;
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const fy = height > 1 ? (y * (src.height - 1)) / (height - 1) : 0;
    const y0 = Math.floor(fy);
    const y1 = Math.min(src.height - 1, y0 + 1);
    for (let x = 0; x < width; x++) {
      const fx = width > 1 ? (x * (src.width - 1)) / (width - 1) : 0;
      const x0 = Math.floor(fx);
      const x1 = Math.min(src.width - 1, x0 + 1);
      const top = src.data[y0 * src.width + x0] * (x1 - fx) + src.data[y0 * src.width + x1] * (fx - x0) + (x1 === x0 ? src.data[y0 * src.width + x0] : 0);
      const low = src.data[y1 * src.width + x0] * (x1 - fx) + src.data[y1 * src.width + x1] * (fx - x0) + (x1 === x0 ? src.data[y1 * src.width + x0] : 0);
      data[y * width + x] = Math.round(y1 === y0 ? top : top * (y1 - fy) + low * (fy - y0));
    }
  }
  return { width, height, data };
}

/**
 * A lithophane as a closed mesh: a sheet whose thickness follows the picture,
 * thin where it is bright. It stands upright, the picture facing the front
 * (−Y); bent, it bulges towards the viewer, and as a cylinder it closes into
 * a lamp shade. One vertex per pixel on the picture side; the smooth back
 * only has vertices along its rim.
 */
export function lithophaneMesh(p: LithophaneParams, source: Picture): { mesh: TriMesh; width: number; height: number; pitch: number } {
  const wrap = p.form === 'cylinder';
  // As many columns as the print can show, but never fewer than the picture has.
  const span = wrap ? Math.PI * p.diameter : p.width - 2 * p.border;
  let across = Math.min(MAX_COLUMNS, Math.max(source.width, Math.round(span / FINEST)));
  across = Math.min(across, Math.floor(Math.sqrt((MAX_CELLS * source.width) / source.height)));
  const picture = resample(source, across, Math.max(2, Math.round((across * source.height) / source.width)));
  const thin = Math.min(p.minThickness, p.maxThickness);
  const thick = Math.max(p.minThickness, p.maxThickness);
  const pitch = wrap ? (Math.PI * p.diameter) / picture.width : Math.max(0.05, (p.width - 2 * p.border) / (picture.width - 1));
  const b = Math.round(p.border / pitch);
  const bx = wrap ? 0 : b;
  const nx = picture.width + 2 * bx;
  const ny = picture.height + 2 * b;
  const width = wrap ? p.diameter : (nx - 1) * pitch;
  const height = (ny - 1) * pitch;
  // Bent sheets are measured along their back, which keeps its radius.
  const radius = wrap ? Math.max(1, p.diameter / 2 - thick) : width / ((p.angle * Math.PI) / 180);

  const columns = wrap ? nx : nx - 1;
  const rim = wrap ? 2 * nx : 2 * nx + 2 * (ny - 2);
  const vertices = new Float32Array(3 * (nx * ny + rim));
  const shade = new Float32Array(nx * ny + rim).fill(0.8);
  const place = (index: number, i: number, j: number, t: number) => {
    const z = (ny - 1 - j) * pitch;
    if (p.form === 'flat') {
      vertices.set([i * pitch - width / 2, -t, z], 3 * index);
    } else {
      const phi = wrap ? (i / nx - 0.5) * 2 * Math.PI : ((i * pitch - width / 2) / radius);
      const r = radius + t;
      vertices.set([r * Math.sin(phi), (wrap ? 0 : radius) - r * Math.cos(phi), z], 3 * index);
    }
  };
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const px = i - bx;
      const py = j - b;
      const inside = px >= 0 && py >= 0 && px < picture.width && py < picture.height;
      const light = inside ? picture.data[py * picture.width + px] / 255 : 0;
      const dark = p.negative ? light : 1 - light;
      place(j * nx + i, i, j, inside ? thin + (thick - thin) * dark : thick);
      shade[j * nx + i] = inside ? 0.12 + 0.88 * (1 - dark) : 0.1;
    }
  }
  // The back only needs its rim: top row, bottom row and, unless it closes on itself, both sides.
  const base = nx * ny;
  const back = (i: number, j: number) => {
    if (j === 0) return base + i;
    if (j === ny - 1) return base + nx + i;
    return base + 2 * nx + (i === 0 ? 0 : ny - 2) + j - 1;
  };
  for (let i = 0; i < nx; i++) for (const j of [0, ny - 1]) place(back(i, j), i, j, 0);
  if (!wrap) for (let j = 1; j < ny - 1; j++) for (const i of [0, nx - 1]) place(back(i, j), i, j, 0);

  const count = 2 * columns * (ny - 1) + 2 * columns + 4 * columns + (wrap ? 0 : 4 * (ny - 1) + 2 * (ny - 2));
  const triangles = new Uint32Array(3 * count);
  let n = 0;
  const tri = (a: number, c: number, d: number) => {
    triangles[n++] = a;
    triangles[n++] = c;
    triangles[n++] = d;
  };
  const front = (i: number, j: number) => j * nx + (i % nx);
  const top = (i: number) => back(i % nx, 0);
  const bottom = (i: number) => back(i % nx, ny - 1);
  for (let i = 0; i < columns; i++) {
    for (let j = 0; j < ny - 1; j++) {
      tri(front(i, j), front(i, j + 1), front(i + 1, j + 1));
      tri(front(i, j), front(i + 1, j + 1), front(i + 1, j));
    }
    // Upper and lower edge
    tri(front(i, 0), front(i + 1, 0), top(i + 1));
    tri(front(i, 0), top(i + 1), top(i));
    tri(front(i, ny - 1), bottom(i + 1), front(i + 1, ny - 1));
    tri(front(i, ny - 1), bottom(i), bottom(i + 1));
    // The back, one strip per column; the outermost strips fan out to the side rims.
    if (!wrap && i === 0) {
      for (let j = 0; j < ny - 1; j++) tri(top(1), back(0, j + 1), back(0, j));
      tri(top(1), bottom(1), bottom(0));
    } else if (!wrap && i === columns - 1) {
      for (let j = 0; j < ny - 1; j++) tri(top(i), back(nx - 1, j), back(nx - 1, j + 1));
      tri(top(i), bottom(i + 1), bottom(i));
    } else {
      tri(top(i), top(i + 1), bottom(i + 1));
      tri(top(i), bottom(i + 1), bottom(i));
    }
  }
  if (!wrap) {
    for (let j = 0; j < ny - 1; j++) {
      tri(back(0, j), back(0, j + 1), front(0, j + 1));
      tri(back(0, j), front(0, j + 1), front(0, j));
      tri(back(nx - 1, j), front(nx - 1, j + 1), back(nx - 1, j + 1));
      tri(back(nx - 1, j), front(nx - 1, j), front(nx - 1, j + 1));
    }
  }
  return { mesh: { vertices, triangles: triangles.subarray(0, n), shade }, width, height, pitch };
}

export function* buildLithophane(p: LithophaneParams): Build {
  const notes: Note[] = [];
  const picture = p.image ? decodeImage(p.image) : samplePhoto();
  if (!picture || picture.width < 8 || picture.height < 8) throw new ParamError('err.noImage');
  if (!p.image) notes.push({ level: 'info', key: 'note.lithoSample' });
  if (p.form !== 'cylinder' && p.width - 2 * p.border < 10) throw new ParamError('err.lithoBorder');
  const { mesh, width, height, pitch } = lithophaneMesh(p, picture);
  notes.push({ level: 'info', key: p.form === 'cylinder' ? 'note.lithoCylinder' : 'note.lithoSize', vars: { w: round1(width), h: round1(height), p: Math.round(pitch * 100) / 100 } });
  notes.push({ level: 'info', key: 'note.lithoPrint' });
  if (pitch > 0.6) notes.push({ level: 'info', key: 'note.lithoCoarse', vars: { p: Math.round(pitch * 100) / 100 } });
  return { parts: [], meshes: [{ name: 'lithophane', mesh }], notes };
}
