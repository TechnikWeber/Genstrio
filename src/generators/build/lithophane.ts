import type { Shape3D } from 'replicad';
import { decodeImage } from '../image';
import type { Note } from '../types';
import { ParamError, round1, weldedMesh, type Build, type Part, type TriMesh } from './common';
import { buildMount, buildStand, PLATE } from './lithoholder';
import { samplePhoto } from './trace';

export interface LithophaneParams {
  image: string;
  negative: boolean;
  mirror: boolean;
  brightness: number;
  contrast: number;
  smoothing: number;
  form: 'flat' | 'arc' | 'cylinder';
  width: number;
  angle: number;
  diameter: number;
  tilt: number;
  reliefSide: 'outside' | 'inside';
  minThickness: number;
  maxThickness: number;
  border: number;
  foot: number;
  stand: 'none' | 'base' | 'light';
  standPrint: 'separate' | 'joined';
  slotDepth: number;
  slotPlay: number;
  struts: number;
  strutHeight: number;
  strutDepth: number;
  lightSeat: 'lean' | 'flat';
  lightDiameter: number;
  lightThickness: number;
  lightTilt: number;
  lightDistance: number;
  mount: 'none' | 'e27' | 'e14';
  mountVents: boolean;
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

/** Brightness and contrast, mirroring, and a blur that takes the grain out of a photo. */
function adjust(src: Picture, p: LithophaneParams): Picture {
  const { width, height } = src;
  let data = new Uint8Array(width * height);
  const gain = 1 + (p.contrast ?? 0) / 100;
  const lift = (p.brightness ?? 0) / 100;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = src.data[y * width + (p.mirror ? width - 1 - x : x)] / 255;
      data[y * width + x] = Math.round(255 * Math.min(1, Math.max(0, (v - 0.5) * gain + 0.5 + lift)));
    }
  }
  for (let pass = 0; pass < (p.smoothing ?? 0); pass++) {
    const next = new Uint8Array(data);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x;
        next[i] = Math.round((4 * data[i] + 2 * (data[i - 1] + data[i + 1] + data[i - width] + data[i + width]) + data[i - width - 1] + data[i - width + 1] + data[i + width - 1] + data[i + width + 1]) / 16);
      }
    }
    data = next;
  }
  return { width, height, data };
}

export interface Lithophane {
  mesh: TriMesh;
  width: number;
  height: number;
  pitch: number;
  /** Radius of the smooth side of a bent one. */
  radius: number;
  /** Thickness of the frame. */
  thick: number;
}

/**
 * A lithophane as a closed mesh: a sheet whose thickness follows the picture,
 * thin where it is bright. It stands upright, the picture facing the front
 * (−Y); bent, it bulges towards the viewer, and as a cylinder it closes into
 * a lamp shade. Tilted, it leans back while its lower edge stays on the
 * ground. One vertex per pixel on the picture side; the smooth side only has
 * vertices along its rim.
 */
export function lithophaneMesh(p: LithophaneParams, source: Picture): Lithophane {
  const wrap = p.form === 'cylinder';
  // As many columns as the print can show, but never fewer than the picture has.
  const span = wrap ? Math.PI * p.diameter : p.width - 2 * p.border;
  let across = Math.min(MAX_COLUMNS, Math.max(source.width, Math.round(span / FINEST)));
  across = Math.min(across, Math.floor(Math.sqrt((MAX_CELLS * source.width) / source.height)));
  const picture = adjust(resample(source, across, Math.max(2, Math.round((across * source.height) / source.width))), p);
  const thin = Math.min(p.minThickness, p.maxThickness);
  const thick = Math.max(p.minThickness, p.maxThickness);
  const pitch = wrap ? (Math.PI * p.diameter) / picture.width : Math.max(0.05, (p.width - 2 * p.border) / (picture.width - 1));
  const b = Math.round(p.border / pitch);
  // A plain strip below the picture, for what stands in a slot.
  const foot = Math.round((p.foot ?? 0) / pitch);
  const bx = wrap ? 0 : b;
  const nx = picture.width + 2 * bx;
  const ny = picture.height + 2 * b + foot;
  const width = wrap ? p.diameter : (nx - 1) * pitch;
  const height = (ny - 1) * pitch;
  // Bent sheets are measured along their inner side, which keeps its radius.
  const radius = wrap ? Math.max(1, p.diameter / 2 - thick) : width / ((p.angle * Math.PI) / 180);
  const lean = wrap ? 0 : Math.tan(((p.tilt ?? 0) * Math.PI) / 180);
  // With the relief inside, the smooth side is the outer one.
  const inward = p.form !== 'flat' && p.reliefSide === 'inside';

  const columns = wrap ? nx : nx - 1;
  const rim = wrap ? 2 * nx : 2 * nx + 2 * (ny - 2);
  const vertices = new Float32Array(3 * (nx * ny + rim));
  const shade = new Float32Array(nx * ny + rim).fill(0.8);
  /** `t` is the thickness at a vertex of the picture side; the smooth side has none. */
  const place = (index: number, i: number, j: number, t: number | null) => {
    const z = (ny - 1 - j) * pitch;
    const out = inward ? (t === null ? thick : thick - t) : (t ?? 0);
    if (p.form === 'flat') {
      vertices.set([i * pitch - width / 2, -out + z * lean, z], 3 * index);
    } else {
      const phi = wrap ? (i / nx - 0.5) * 2 * Math.PI : (i * pitch - width / 2) / radius;
      const r = radius + out;
      vertices.set([r * Math.sin(phi), (wrap ? 0 : radius) - r * Math.cos(phi) + z * lean, z], 3 * index);
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
  // The smooth side only needs its rim: top row, bottom row and, unless it closes on itself, both sides.
  const base = nx * ny;
  const back = (i: number, j: number) => {
    if (j === 0) return base + i;
    if (j === ny - 1) return base + nx + i;
    return base + 2 * nx + (i === 0 ? 0 : ny - 2) + j - 1;
  };
  for (let i = 0; i < nx; i++) for (const j of [0, ny - 1]) place(back(i, j), i, j, null);
  if (!wrap) for (let j = 1; j < ny - 1; j++) for (const i of [0, nx - 1]) place(back(i, j), i, j, null);

  const count = 2 * columns * (ny - 1) + 2 * columns + 4 * columns + (wrap ? 0 : 4 * (ny - 1) + 2 * (ny - 2));
  const triangles = new Uint32Array(3 * count);
  let n = 0;
  // Swapping the two sides of the sheet turns every face over, so the corners go round the other way.
  const tri = (a: number, c: number, d: number) => {
    triangles[n++] = a;
    triangles[n++] = inward ? d : c;
    triangles[n++] = inward ? c : d;
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
    // The smooth side, one strip per column; the outermost strips fan out to the side rims.
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
  return { mesh: { vertices, triangles: triangles.subarray(0, n), shade }, width, height, pitch, radius, thick };
}

/** Several closed meshes as one, each keeping its own shell; a slicer joins what overlaps. */
function mergeMeshes(meshes: TriMesh[], lift: number): TriMesh {
  const vertices = new Float32Array(meshes.reduce((sum, mesh) => sum + mesh.vertices.length, 0));
  const triangles = new Uint32Array(meshes.reduce((sum, mesh) => sum + mesh.triangles.length, 0));
  const shade = new Float32Array(vertices.length / 3).fill(0.55);
  let v = 0;
  let t = 0;
  for (const mesh of meshes) {
    vertices.set(mesh.vertices, 3 * v);
    if (mesh.shade) shade.set(mesh.shade, v);
    for (let i = 0; i < mesh.triangles.length; i++) triangles[t++] = mesh.triangles[i] + v;
    v += mesh.vertices.length / 3;
  }
  for (let i = 2; i < vertices.length; i += 3) vertices[i] += lift;
  return { vertices, triangles, shade };
}

export function* buildLithophane(p: LithophaneParams): Build {
  const notes: Note[] = [];
  const picture = p.image ? decodeImage(p.image) : samplePhoto();
  if (!picture || picture.width < 8 || picture.height < 8) throw new ParamError('err.noImage');
  if (!p.image) notes.push({ level: 'info', key: 'note.lithoSample' });
  if (p.form !== 'cylinder' && p.width - 2 * p.border < 10) throw new ParamError('err.lithoBorder');
  const litho = lithophaneMesh(p, picture);
  let { mesh } = litho;
  const { width, height, pitch, radius, thick } = litho;
  notes.push({ level: 'info', key: p.form === 'cylinder' ? 'note.lithoCylinder' : 'note.lithoSize', vars: { w: round1(width), h: round1(height), p: Math.round(pitch * 100) / 100 } });
  notes.push({ level: 'info', key: 'note.lithoPrint' });
  if (pitch > 0.6) notes.push({ level: 'info', key: 'note.lithoCoarse', vars: { p: Math.round(pitch * 100) / 100 } });
  if (p.form !== 'cylinder' && p.tilt > 0) notes.push({ level: 'info', key: 'note.lithoTilt', vars: { a: p.tilt } });

  const parts: Part[] = [];
  if (p.form === 'cylinder' && p.mount !== 'none') {
    // Beside the cylinder for printing; fitted, it closes the top, collar down.
    const at = p.diameter + 8;
    parts.push({ name: 'mount', shape: buildMount(p.mount, p.diameter / 2, radius, p.mountVents).translate([at, 0, 0]) as Shape3D, assembled: { flip: true, offset: [at, 0, height + 2] } });
    notes.push({ level: 'info', key: 'note.lithoMount', vars: { d: p.mount === 'e27' ? 40.5 : 28.5 } });
  }
  if (p.form !== 'cylinder' && p.stand !== 'none') {
    const joined = p.standPrint === 'joined';
    const stand = buildStand({ ...p, form: p.form, radius, foot: thick, joined, light: p.stand === 'light' ? p.lightSeat : 'none' });
    if (joined) {
      // One print: the stand reaches a little into the picture, and both stand on the bed together.
      const sink = 0.3;
      const base = weldedMesh(stand.translate([0, 0, sink - PLATE]) as Shape3D, 0.05);
      mesh = mergeMeshes([mesh, base], PLATE - sink);
      notes.push({ level: 'info', key: 'note.lithoJoined' });
    } else {
      // Behind the lithophane for printing; fitted, it stands in the slot.
      const lean = Math.tan((p.tilt * Math.PI) / 180) * height;
      const reach = (p.form === 'flat' ? 0 : p.angle <= 180 ? radius * (1 - Math.cos((p.angle * Math.PI) / 360)) : 2 * radius + thick) + lean;
      const shift = reach + 10 - stand.boundingBox.bounds[0][1];
      parts.push({ name: 'stand', shape: stand.translate([0, shift, 0]) as Shape3D, assembled: { flip: false, offset: [0, -shift, -PLATE] } });
      notes.push({ level: 'info', key: p.stand === 'light' ? 'note.lithoLight' : 'note.lithoStand' });
    }
    if (p.foot < p.slotDepth - 0.5) notes.push({ level: 'info', key: 'note.lithoFoot', vars: { h: p.slotDepth } });
  }
  return { parts, meshes: [{ name: 'lithophane', mesh }], notes };
}
