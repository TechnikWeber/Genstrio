// Pictures as parameters: a small greyscale bitmap, deflated and written as
// text, so it travels with the other values into storage, project files and links.
import { unzlibSync, zlibSync } from 'fflate';

export interface Bitmap {
  width: number;
  height: number;
  /** One byte per pixel, row by row from the top. */
  data: Uint8Array;
}

export function encodeImage({ width, height, data }: Bitmap): string {
  const packed = zlibSync(data, { level: 9 });
  let binary = '';
  for (let i = 0; i < packed.length; i += 0x8000) binary += String.fromCharCode(...packed.subarray(i, i + 0x8000));
  return `${width}x${height}:${btoa(binary)}`;
}

/** The bitmap of an encoded picture, or null if the text is not one. */
export function decodeImage(text: string): Bitmap | null {
  const match = /^(\d+)x(\d+):(.+)$/.exec(text);
  if (!match) return null;
  try {
    const width = Number(match[1]);
    const height = Number(match[2]);
    const binary = atob(match[3]);
    const packed = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) packed[i] = binary.charCodeAt(i);
    const data = unzlibSync(packed);
    return width > 0 && height > 0 && data.length === width * height ? { width, height, data } : null;
  } catch {
    return null;
  }
}

/** Shrink by averaging, which keeps soft edges where a shape covers part of a pixel. */
export function shrink(src: Bitmap, maxSize: number): Bitmap {
  const scale = Math.min(1, maxSize / Math.max(src.width, src.height));
  const width = Math.max(1, Math.round(src.width * scale));
  const height = Math.max(1, Math.round(src.height * scale));
  if (width === src.width && height === src.height) return src;
  const data = new Uint8Array(width * height);
  const fx = src.width / width;
  const fy = src.height / height;
  for (let y = 0; y < height; y++) {
    const y0 = y * fy;
    const y1 = (y + 1) * fy;
    for (let x = 0; x < width; x++) {
      const x0 = x * fx;
      const x1 = (x + 1) * fx;
      let sum = 0;
      let area = 0;
      for (let sy = Math.floor(y0); sy < Math.min(src.height, Math.ceil(y1)); sy++) {
        const wy = Math.min(y1, sy + 1) - Math.max(y0, sy);
        for (let sx = Math.floor(x0); sx < Math.min(src.width, Math.ceil(x1)); sx++) {
          const wgt = wy * (Math.min(x1, sx + 1) - Math.max(x0, sx));
          sum += wgt * src.data[sy * src.width + sx];
          area += wgt;
        }
      }
      data[y * width + x] = Math.round(sum / area);
    }
  }
  return { width, height, data };
}

/**
 * Turn RGBA pixels into the bitmap a generator works with.
 * `photo`: brightness, as if the picture lay on white paper.
 * `mask`: how much of each pixel belongs to the shape. A picture with
 * transparency is a shape on nothing, less whatever in it is white (unless
 * that leaves nothing: a white logo); otherwise dark counts as shape. The
 * result is cropped to the shape.
 */
export function fromRgba(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number, mode: 'mask' | 'photo', maxSize: number): Bitmap {
  const n = width * height;
  const data = new Uint8Array(n);
  const luma = (i: number) => 0.2126 * rgba[4 * i] + 0.7152 * rgba[4 * i + 1] + 0.0722 * rgba[4 * i + 2];
  if (mode === 'photo') {
    for (let i = 0; i < n; i++) {
      const a = rgba[4 * i + 3] / 255;
      data[i] = Math.round(luma(i) * a + 255 * (1 - a));
    }
    return shrink({ width, height, data }, maxSize);
  }
  let clear = 0;
  for (let i = 0; i < n; i++) if (rgba[4 * i + 3] < 128) clear++;
  const cutOut = clear > n * 0.02;
  if (cutOut) {
    let solid = 0;
    let coloured = 0;
    for (let i = 0; i < n; i++) {
      const alpha = rgba[4 * i + 3];
      data[i] = Math.round(alpha * Math.min(1, (255 - luma(i)) / 24));
      solid += alpha;
      coloured += data[i];
    }
    if (coloured < solid * 0.05) for (let i = 0; i < n; i++) data[i] = rgba[4 * i + 3];
  } else {
    for (let i = 0; i < n; i++) data[i] = Math.round(255 - luma(i));
  }

  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[y * width + x] < 128) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < x0) return shrink({ width, height, data }, maxSize);
  const cw = x1 - x0 + 1;
  const ch = y1 - y0 + 1;
  const cropped = new Uint8Array(cw * ch);
  for (let y = 0; y < ch; y++) cropped.set(data.subarray((y0 + y) * width + x0, (y0 + y) * width + x0 + cw), y * cw);
  return shrink({ width: cw, height: ch, data: cropped }, maxSize);
}
