// Loading a picture in the browser: any image file becomes the small bitmap
// a generator keeps as a parameter. Nothing leaves the page.
import { decodeImage, encodeImage, fromRgba } from './generators/image';

const isSvg = (file: File) => file.type === 'image/svg+xml' || /\.svg$/i.test(file.name);

/**
 * An SVG often states no size, or one too small to trace well. Give it an
 * explicit, large one; being vector, it loses nothing.
 */
async function sizedSvg(file: File, longSide: number): Promise<Blob> {
  const doc = new DOMParser().parseFromString(await file.text(), 'image/svg+xml');
  const root = doc.documentElement;
  if (root.nodeName !== 'svg' || doc.querySelector('parsererror')) throw new Error('not an SVG');
  const box = (root.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
  const stated = [root.getAttribute('width'), root.getAttribute('height')].map((v) => (v && !v.includes('%') ? parseFloat(v) : NaN));
  const w = box.length === 4 && box[2] > 0 ? box[2] : stated[0];
  const h = box.length === 4 && box[3] > 0 ? box[3] : stated[1];
  if (!(w > 0 && h > 0)) return file;
  if (box.length !== 4) root.setAttribute('viewBox', `0 0 ${w} ${h}`);
  const scale = longSide / Math.max(w, h);
  root.setAttribute('width', String(Math.round(w * scale)));
  root.setAttribute('height', String(Math.round(h * scale)));
  return new Blob([new XMLSerializer().serializeToString(doc)], { type: 'image/svg+xml' });
}

/** Read an image file (SVG, PNG, JPEG, WebP …) into the text form of a picture parameter. */
export async function readPicture(file: File, mode: 'mask' | 'photo', maxSize: number): Promise<string> {
  // Several times the stored size, so that averaging down leaves soft edges.
  const work = mode === 'mask' ? 1600 : maxSize * 3;
  const url = URL.createObjectURL(isSvg(file) ? await sizedSvg(file, work) : file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, work / Math.max(img.naturalWidth, img.naturalHeight));
    const width = Math.round(img.naturalWidth * scale);
    const height = Math.round(img.naturalHeight * scale);
    if (!(width > 0 && height > 0)) throw new Error('empty image');
    const canvas = Object.assign(document.createElement('canvas'), { width, height });
    const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, width, height);
    return encodeImage(fromRgba(ctx.getImageData(0, 0, width, height).data, width, height, mode, maxSize));
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Show a picture parameter on a canvas; returns false if there is none. */
export function drawPicture(canvas: HTMLCanvasElement, text: string, mode: 'mask' | 'photo'): boolean {
  const bitmap = decodeImage(text);
  if (!bitmap) return false;
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const pixels = new ImageData(bitmap.width, bitmap.height);
  for (let i = 0; i < bitmap.data.length; i++) {
    // A mask stores ink, which shows dark; a photo stores brightness.
    const v = mode === 'mask' ? 255 - bitmap.data[i] : bitmap.data[i];
    pixels.data.set([v, v, v, 255], 4 * i);
  }
  (canvas.getContext('2d') as CanvasRenderingContext2D).putImageData(pixels, 0, 0);
  return true;
}
