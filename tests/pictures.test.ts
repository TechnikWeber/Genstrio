import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import opencascade from 'replicad-opencascadejs';
import { loadFont, makeBaseBox, makeCylinder, measureVolume, setOC, type Shape3D } from 'replicad';
import { beforeAll, describe, expect, it } from 'vitest';
import { BUILDERS, loadedFonts, ParamError, type BuildResult, type Stage } from '../src/generators/build';
import { FONTS } from '../src/generators/fonts';
import { GENERATORS } from '../src/generators/meta';
import { defaults, fromTemplate, newItem, sanitize, type GeneratorId, type ListParam, type Params } from '../src/generators/types';
import { lithophaneMesh, type LithophaneParams } from '../src/generators/build/lithophane';
import { qrMatrix } from '../src/generators/build/qr';
import { areaOf, covers, distanceField, frameOf, gridRegions, sampleMask, traceBand, traceRegions } from '../src/generators/build/trace';
import { decodeImage, encodeImage, fromRgba, type Bitmap } from '../src/generators/image';
import { meshPart, vertexNormals, write3mf, writeStl, type WeldedMesh } from '../src/engine/export';
import { formatLength, parseLength, setUnit } from '../src/units';

beforeAll(async () => {
  const wasm = createRequire(import.meta.url).resolve('replicad-opencascadejs/wasm');
  const oc = await (opencascade as unknown as (o: object) => Promise<never>)({ wasmBinary: readFileSync(wasm) });
  setOC(oc);
  for (const font of FONTS) {
    const file = readFileSync(new URL(`../src/fonts/${font}.woff`, import.meta.url));
    await loadFont(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer, font);
    loadedFonts.add(font);
  }
}, 60_000);

function run(id: GeneratorId, overrides: Params = {}): { result: BuildResult; stages: Stage[] } {
  const gen = BUILDERS[id]({ ...defaults(GENERATORS[id]), ...overrides });
  const stages: Stage[] = [];
  for (;;) {
    const step = gen.next();
    if (step.done) return { result: step.value, stages };
    stages.push(step.value);
  }
}

const size = (s: Shape3D) => {
  const [[x0, y0, z0], [x1, y1, z1]] = s.boundingBox.bounds;
  return [x1 - x0, y1 - y0, z1 - z0];
};
const warnings = (r: BuildResult) => r.notes.filter((n) => n.level === 'warn').map((n) => n.key);

const opening = (o: Params): Params => ({ ...newItem(GENERATORS.enclosure.params.find((d) => d.key === 'openings') as ListParam), ...o });
const plain: Params = { openings: [], lidVent: 'none', bodyVent: 'none' };
const volumes = (overrides: Params) => run('enclosure', overrides).result.parts.map((part) => measureVolume(part.shape));

describe('tracing', () => {
  it('finds the outline of a shape and grows it by any distance', () => {
    const field = distanceField(sampleMask('circle'), { pad: 40 });
    const frame = frameOf(field, 50)!;
    expect(frame.width).toBeCloseTo(50, 1);
    expect(frame.height).toBeCloseTo(50, 1);
    const circle = traceRegions(field, frame);
    expect(circle).toHaveLength(1);
    expect(circle[0].holes).toHaveLength(0);
    expect(areaOf(circle) / (Math.PI * 25 ** 2)).toBeCloseTo(1, 2);
    expect(areaOf(traceRegions(field, frame, 3)) / (Math.PI * 28 ** 2)).toBeCloseTo(1, 2);
    expect(areaOf(traceRegions(field, frame, -5)) / (Math.PI * 20 ** 2)).toBeCloseTo(1, 2);
    // A wall of constant width around it
    const wall = traceBand(field, frame, 0, 2);
    expect(wall).toHaveLength(1);
    expect(wall[0].holes).toHaveLength(1);
    expect(areaOf(wall) / (Math.PI * (27 ** 2 - 25 ** 2))).toBeCloseTo(1, 1);
    expect(covers(wall, [26, 0])).toBe(true);
    expect(covers(wall, [0, 0])).toBe(false);
  });

  it('keeps holes, or closes them for an outline only', () => {
    const moon = sampleMask('circle');
    // Punch a hole into the disc
    const ring: Bitmap = { ...moon, data: moon.data.map((v, i) => (Math.hypot((i % moon.width) - 100, Math.floor(i / moon.width) - 100) < 40 ? 0 : v)) };
    const open = distanceField(ring);
    expect(traceRegions(open, frameOf(open, 50)!)[0].holes).toHaveLength(1);
    const closed = distanceField(ring, { fillHoles: true });
    expect(traceRegions(closed, frameOf(closed, 50)!)[0].holes).toHaveLength(0);
    expect(frameOf(distanceField({ width: 20, height: 20, data: new Uint8Array(400) }), 50)).toBeNull();
  });

  it('mirrors on request and reads light on dark when inverted', () => {
    const half: Bitmap = { width: 40, height: 20, data: new Uint8Array(800).map((_, i) => (i % 40 < 10 ? 255 : 0)) };
    const field = distanceField(half, { pad: 6 });
    // Ten pixels wide, twenty high: its middle lies between pixel centres.
    const [px, py] = [6 + 4.5, 6 + 9.5];
    expect(frameOf(field, 30)!.toMm([px, py])[0]).toBeCloseTo(0, 6);
    expect(frameOf(field, 30)!.toMm([px, py])[1]).toBeCloseTo(0, 6);
    expect(frameOf(field, 30)!.width).toBeCloseTo(15, 6);
    const wide = distanceField(half, { pad: 6, invert: true });
    expect(frameOf(wide, 30)!.width).toBeCloseTo(30, 0);
    expect(frameOf(wide, 30, true)!.toMm([0, 0])[0]).toBeCloseTo(-frameOf(wide, 30)!.toMm([0, 0])[0], 6);
  });

  it('packs a picture into text and back', () => {
    const bitmap = sampleMask('star', 64);
    const text = encodeImage(bitmap);
    expect(text.startsWith('64x64:')).toBe(true);
    expect(decodeImage(text)).toEqual(bitmap);
    expect(decodeImage('64x64:AAAA')).toBeNull();
    expect(decodeImage('nonsense')).toBeNull();
  });

  it('reads a shape from a picture by transparency or by darkness, cropped to it', () => {
    const rgba = (alpha: boolean) => {
      const data = new Uint8Array(4 * 100 * 80).fill(255);
      for (let y = 0; y < 80; y++) {
        for (let x = 0; x < 100; x++) {
          const inside = x >= 20 && x < 60 && y >= 10 && y < 30;
          // Either black on white, or a white shape on nothing
          if (alpha) data[4 * (y * 100 + x) + 3] = inside ? 255 : 0;
          else if (inside) data.fill(0, 4 * (y * 100 + x), 4 * (y * 100 + x) + 3);
        }
      }
      return data;
    };
    for (const alpha of [false, true]) {
      const mask = fromRgba(rgba(alpha), 100, 80, 'mask', 200);
      expect([mask.width, mask.height], String(alpha)).toEqual([40, 20]);
      expect(mask.data.every((v) => v === 255)).toBe(true);
    }
    const small = fromRgba(rgba(false), 100, 80, 'mask', 10);
    expect([small.width, small.height]).toEqual([10, 5]);
    const photo = fromRgba(rgba(true), 100, 80, 'photo', 50);
    expect([photo.width, photo.height]).toEqual([50, 40]);
    // Transparent counts as white paper
    expect(photo.data[0]).toBe(255);
  });
});

describe('qr', () => {
  it('encodes text into a code with its three finder patterns', () => {
    const small = qrMatrix('HI', 'L');
    expect(small.count).toBe(21);
    expect(small.version).toBe(1);
    for (const [r, c] of [[0, 0], [0, 20], [20, 0]]) {
      // A 7 × 7 frame around a 3 × 3 block, in three corners
      const dr = r === 0 ? 1 : -1;
      const dc = c === 0 ? 1 : -1;
      expect(small.dark(r, c)).toBe(true);
      expect(small.dark(r + dr, c + dc)).toBe(false);
      expect(small.dark(r + 3 * dr, c + 3 * dc)).toBe(true);
    }
    expect(qrMatrix('x'.repeat(200), 'H').count).toBeGreaterThan(small.count);
    expect(() => qrMatrix('x'.repeat(3000), 'H')).toThrow(ParamError);
    // Umlauts take two bytes each in UTF-8, so they need the larger code.
    expect(qrMatrix('ä'.repeat(15), 'L').count).toBeGreaterThan(qrMatrix('a'.repeat(15), 'L').count);
  });

  it('traces the dark modules exactly, the right way round', () => {
    const matrix = qrMatrix('https://example.com', 'M');
    const n = matrix.count;
    const regions = gridRegions(matrix.dark, n, 2, 0.01);
    let dark = 0;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (matrix.dark(r, c)) dark++;
        // Row 0 is at the top, column 0 at the left.
        expect(covers(regions, [(c + 0.5 - n / 2) * 2, (n / 2 - r - 0.5) * 2]), `${r}/${c}`).toBe(matrix.dark(r, c));
      }
    }
    expect(areaOf(gridRegions(matrix.dark, n, 2))).toBeCloseTo(dark * 4, 6);
    // Modules that touch only at a corner are parted, so no outline touches another.
    const corners = regions.flatMap((region) => [region.outer, ...region.holes]).flat().map(([x, y]) => `${x.toFixed(4)}/${y.toFixed(4)}`);
    expect(new Set(corners).size).toBe(corners.length);
  });

  it('raises the code on a plate with a quiet zone', () => {
    const { result } = run('qr', { text: 'https://example.com', size: 50, quiet: 4, separate: true });
    const [plate, code] = result.parts;
    const matrix = qrMatrix('https://example.com', 'M');
    const cell = 50 / matrix.count;
    const [w, h, t] = size(plate.shape);
    expect(w).toBeCloseTo(50 + 8 * cell, 2);
    expect(h).toBeCloseTo(50 + 8 * cell, 2);
    expect(t).toBeCloseTo(1.6, 3);
    expect(size(code.shape)[0]).toBeCloseTo(50, 1);
    expect(code.shape.boundingBox.bounds[0][2]).toBeCloseTo(1.6, 3);
    let dark = 0;
    for (let r = 0; r < matrix.count; r++) for (let c = 0; c < matrix.count; c++) if (matrix.dark(r, c)) dark++;
    expect(measureVolume(code.shape) / (dark * cell * cell * 0.6)).toBeCloseTo(1, 1);
    // In one piece, the plate carries the same code.
    const joined = run('qr', { text: 'https://example.com', size: 50 }).result.parts;
    expect(joined).toHaveLength(1);
    expect(joined[0].shape.solids.length).toBe(1);
    expect(measureVolume(joined[0].shape)).toBeCloseTo(measureVolume(plate.shape) + measureVolume(code.shape), -1);
  });

  it('engraves, labels and adds a hole', () => {
    const flat = measureVolume(run('qr', { style: 'engraved', relief: 0.01 }).result.parts[0].shape);
    const { result } = run('qr', { style: 'engraved', relief: 0.8 });
    expect(measureVolume(result.parts[0].shape)).toBeLessThan(flat - 100);
    expect(size(result.parts[0].shape)[2]).toBeCloseTo(1.6, 3);
    const plain = size(run('qr').result.parts[0].shape);
    const labelled = size(run('qr', { label: 'WiFi', labelSize: 6 }).result.parts[0].shape);
    expect(labelled[1]).toBeGreaterThan(plain[1] + 6);
    expect(labelled[0]).toBeCloseTo(plain[0], 2);
    expect(size(run('qr', { hole: 'top', holeDiameter: 4 }).result.parts[0].shape)[1]).toBeCloseTo(plain[1] + 8, 2);
    expect(warnings(run('qr', { size: 12 }).result)).toEqual(['note.qrFine']);
    expect(() => run('qr', { text: '   ' })).toThrow(ParamError);
  });

  it('builds every QR template cleanly', () => {
    for (const name of Object.keys(GENERATORS.qr.templates!)) {
      const { result } = run('qr', fromTemplate(GENERATORS.qr, name));
      expect(warnings(result), name).toEqual([]);
      expect(result.parts[0].shape.solids.length, name).toBe(1);
    }
  });
});

// A dark square with a square hole, off-centre on white: 60 × 60 px in a 100 × 80 picture
const framePicture = (): string => {
  const data = new Uint8Array(100 * 80);
  for (let y = 10; y < 70; y++) for (let x = 20; x < 80; x++) if (x < 35 || x >= 65 || y < 25 || y >= 55) data[y * 100 + x] = 255;
  return encodeImage({ width: 100, height: 80, data });
};

describe('relief', () => {
  it('raises a shape on a plate sized to fit it', () => {
    const { result } = run('relief');
    expect(warnings(result)).toEqual([]);
    const [w, h, t] = size(result.parts[0].shape);
    const motif = result.notes.find((n) => n.key === 'note.motifSize')!.vars!;
    expect(motif.w).toBeCloseTo(60, 0);
    expect(w).toBeCloseTo(60 + 10, 0);
    expect(h).toBeCloseTo((motif.h as number) + 10, 0);
    expect(t).toBeCloseTo(2.4 + 1.2, 2);
    expect(result.parts[0].shape.solids.length).toBe(1);
  });

  it('traces a picture, holes included', () => {
    const { result } = run('relief', { shape: 'image', image: framePicture(), size: 60, smooth: 0, style: 'shape', relief: 2 });
    const [w, h, t] = size(result.parts[0].shape);
    expect(w).toBeCloseTo(60, 0);
    expect(h).toBeCloseTo(60, 0);
    expect(t).toBeCloseTo(2, 3);
    // 60 × 60 less the 30 × 30 window, corners slightly rounded
    expect(measureVolume(result.parts[0].shape) / ((3600 - 900) * 2)).toBeCloseTo(1, 1);
    // Inverted, the window and the surroundings are the shape; the frame is not.
    const inverse = run('relief', { shape: 'image', image: framePicture(), invert: true, size: 60, style: 'shape', relief: 2 }).result;
    expect(measureVolume(inverse.parts[0].shape)).toBeGreaterThan(900 * 2);
    expect(() => run('relief', { shape: 'image' })).toThrow(ParamError);
    expect(() => run('relief', { shape: 'image', image: framePicture(), threshold: 5, invert: false, size: 60 })).not.toThrow();
  });

  it('engraves, cuts through and keeps a separate part for a second colour', () => {
    const plate = 70 * (run('relief').result.notes.find((n) => n.key === 'note.plateSize')!.vars!.h as number) * 2.4;
    const engraved = run('relief', { style: 'engraved', relief: 1 }).result;
    const cutout = run('relief', { style: 'cutout' }).result;
    const separate = run('relief', { separate: true }).result;
    expect(size(engraved.parts[0].shape)[2]).toBeCloseTo(2.4, 3);
    expect(measureVolume(engraved.parts[0].shape)).toBeLessThan(plate - 500);
    expect(measureVolume(cutout.parts[0].shape)).toBeLessThan(measureVolume(engraved.parts[0].shape));
    expect(separate.parts.map((part) => part.name)).toEqual(['plate', 'motif']);
    expect(separate.parts[1].shape.boundingBox.bounds[0][2]).toBeCloseTo(2.4, 3);
  });

  it('lets the plate follow the outline, with a lug for a ring', () => {
    const rect = measureVolume(run('relief', { style: 'engraved', relief: 0.01 }).result.parts[0].shape);
    const contour = run('relief', { plateShape: 'contour', padding: 3, style: 'engraved', relief: 0.01 }).result;
    expect(warnings(contour)).toEqual([]);
    expect(contour.parts[0].shape.solids.length).toBe(1);
    expect(measureVolume(contour.parts[0].shape)).toBeLessThan(rect * 0.7);
    // The margin goes round the tips of the star in an arc.
    expect(size(contour.parts[0].shape)[0]).toBeGreaterThan(65.5);
    expect(size(contour.parts[0].shape)[0]).toBeLessThan(67.5);
    const lug = run('relief', { plateShape: 'contour', padding: 3, hole: 'top' }).result.parts[0].shape;
    expect(lug.solids.length).toBe(1);
    expect(size(lug)[1]).toBeGreaterThan(size(contour.parts[0].shape)[1] + 1);
    for (const plateShape of ['rect', 'ellipse']) {
      const holes = run('relief', { plateShape, hole: 'corners' }).result;
      expect(holes.parts[0].shape.solids.length, plateShape).toBe(1);
    }
  });

  it('follows the shades of a picture as a height relief', () => {
    // A ramp from light to dark, left to right
    const data = new Uint8Array(80 * 40).map((_, i) => Math.round(((i % 80) / 79) * 255));
    const image = encodeImage({ width: 80, height: 40, data });
    const { result } = run('relief', { shape: 'image', image, size: 80, style: 'heightmap', relief: 4, plateThickness: 2, smooth: 0 });
    expect(result.parts).toHaveLength(0);
    const { mesh } = result.meshes![0];
    expect(openEdges(mesh)).toBe(0);
    const v = mesh.vertices;
    const column = (x: number) => Math.max(...Array.from({ length: v.length / 3 }, (_, i) => (Math.abs(v[3 * i] - x) < 0.3 ? v[3 * i + 2] : 0)));
    // Flat on the bed, 2 mm where the picture is white, 6 mm where it is black, half way in the middle
    expect(Math.min(...Array.from({ length: v.length / 3 }, (_, i) => v[3 * i + 2]))).toBeCloseTo(0, 6);
    expect(column(-39.8)).toBeCloseTo(2, 1);
    expect(column(0)).toBeCloseTo(4, 1);
    expect(column(39.8)).toBeCloseTo(6, 1);
    // A ramp holds half its height in volume.
    expect(meshVolume(mesh) / (80 * 40 * 4)).toBeCloseTo(1, 1);
    // Light and dark swapped, the ramp runs the other way.
    const swapped = run('relief', { shape: 'image', image, invert: true, size: 80, style: 'heightmap', relief: 4, plateThickness: 2, smooth: 0 }).result.meshes![0].mesh.vertices;
    expect(Math.max(...Array.from({ length: swapped.length / 3 }, (_, i) => (swapped[3 * i] < -39.5 ? swapped[3 * i + 2] : 0)))).toBeCloseTo(6, 1);
  });

  it('builds every relief template cleanly', () => {
    for (const name of Object.keys(GENERATORS.relief.templates!)) {
      const { result } = run('relief', fromTemplate(GENERATORS.relief, name));
      expect(warnings(result), name).toEqual([]);
      expect(result.parts.length + (result.meshes?.length ?? 0), name).toBeGreaterThan(0);
    }
  });
});

describe('cutter', () => {
  it('puts a wall of constant thickness around the shape', () => {
    const { result } = run('cutter', { shape: 'circle', size: 60, wall: 1.2, edge: 1.2, flangeWidth: 0, height: 12 });
    expect(warnings(result)).toEqual([]);
    const cutter = result.parts[0].shape;
    const [w, d, h] = size(cutter);
    expect(w).toBeCloseTo(62.4, 1);
    expect(d).toBeCloseTo(62.4, 1);
    expect(h).toBeCloseTo(12, 3);
    expect(cutter.solids.length).toBe(1);
    expect(measureVolume(cutter) / (Math.PI * (31.2 ** 2 - 30 ** 2) * 12)).toBeCloseTo(1, 1);
  });

  it('adds a grip rim below and a thin cutting edge on top', () => {
    const plain = measureVolume(run('cutter', { shape: 'circle', size: 60, wall: 1.2, edge: 1.2, flangeWidth: 0 }).result.parts[0].shape);
    const rim = run('cutter', { shape: 'circle', size: 60, wall: 1.2, edge: 1.2, flangeWidth: 5, flangeThickness: 2 }).result.parts[0].shape;
    expect(size(rim)[0]).toBeCloseTo(70, 1);
    expect(rim.solids.length).toBe(1);
    expect(measureVolume(rim) - plain).toBeCloseTo(Math.PI * (35 ** 2 - 31.2 ** 2) * 2, -1.5);
    const sharp = run('cutter', { shape: 'circle', size: 60, wall: 1.2, edge: 0.5, edgeHeight: 3, flangeWidth: 0 }).result.parts[0].shape;
    expect(sharp.solids.length).toBe(1);
    expect(plain - measureVolume(sharp)).toBeCloseTo(Math.PI * (31.2 ** 2 - 30.5 ** 2) * 3, -1.5);
  });

  it('follows the outer outline of a picture and can widen it', () => {
    const framed = run('cutter', { shape: 'image', image: framePicture(), size: 50, smooth: 0, flangeWidth: 0, edge: 1.2 }).result;
    expect(warnings(framed)).toEqual([]);
    // The window inside the frame is dough as well: one wall, not two.
    expect(framed.parts[0].shape.solids.length).toBe(1);
    expect(size(framed.parts[0].shape)[0]).toBeCloseTo(52.4, 0);
    expect(measureVolume(framed.parts[0].shape) / (4 * 51.2 * 1.2 * 14)).toBeCloseTo(1, 1);
    const wider = run('cutter', { shape: 'image', image: framePicture(), size: 50, offset: 2, flangeWidth: 0 }).result;
    expect(size(wider.parts[0].shape)[0]).toBeCloseTo(56.4, 0);
    // Two shapes in one picture give two cutters, and a word about it.
    const data = new Uint8Array(120 * 40);
    for (let y = 5; y < 35; y++) for (let x = 5; x < 115; x++) if (x < 35 || x >= 85) data[y * 120 + x] = 255;
    const two = run('cutter', { shape: 'image', image: encodeImage({ width: 120, height: 40, data }), size: 80 }).result;
    expect(warnings(two)).toEqual(['note.cutterPieces']);
  });

  it('makes a stamp for what the picture shows inside the outline', () => {
    // A face: a ring for the head, two eyes and a mouth, dark on white
    const w = 160;
    const data = new Uint8Array(w * w);
    for (let y = 0; y < w; y++) {
      for (let x = 0; x < w; x++) {
        const r = Math.hypot(x - 80, y - 80);
        const eye = Math.hypot(x - 55, y - 60) < 8 || Math.hypot(x - 105, y - 60) < 8;
        if ((r < 70 && r > 62) || eye || (Math.abs(r - 38) < 4 && y > 95)) data[y * w + x] = 255;
      }
    }
    const image = encodeImage({ width: w, height: w, data });
    const face: Params = { shape: 'image', image, size: 70, flangeWidth: 4, stampClearance: 0.5, stampMargin: 5, stampPlate: 3, stampRelief: 2 };
    const { result } = run('cutter', { ...face, stamp: 'lines' });
    expect(warnings(result)).toEqual([]);
    expect(result.parts.map((part) => part.name)).toEqual(['cutter', 'stamp', 'handle']);
    const [cutter, stamp, handle] = result.parts.map((part) => part.shape);
    expect(cutter.solids.length).toBe(1);
    expect(stamp.solids.length).toBe(1);
    // The plate drops into the cutter with play all round …
    expect(size(stamp)[0]).toBeCloseTo(70 - 1, 0);
    expect(size(stamp)[2]).toBeCloseTo(5, 3);
    const [[x0], [x1]] = stamp.boundingBox.bounds;
    const inPlace = stamp.clone().translate([-(x0 + x1) / 2, 0, 0]) as Shape3D;
    expect(measureVolume(cutter.clone().intersect(inPlace))).toBeLessThan(0.01);
    // … and carries eyes and mouth, but not the outline, which lies within the margin.
    const plate = Math.PI * 34.5 ** 2 * 3;
    const marks = (2 * Math.PI * 8 ** 2 + 0.36 * Math.PI * (42 ** 2 - 34 ** 2)) * (70 / 140) ** 2 * 2;
    const socket = 8.3 ** 2 * 2.2;
    expect(measureVolume(stamp)).toBeGreaterThan(plate - socket + marks * 0.7);
    expect(measureVolume(stamp)).toBeLessThan(plate - socket + marks * 1.4);
    // A knob with a peg slightly shorter than the socket is deep
    expect(size(handle)[2]).toBeCloseTo(14 + 2, 1);
    // The other kind raises everything but the lines.
    const areas = run('cutter', { ...face, stamp: 'areas' }).result.parts[1].shape;
    expect(measureVolume(areas)).toBeGreaterThan(measureVolume(stamp) + 1000);
    expect(run('cutter', { ...face, stamp: 'lines', stampHandle: false }).result.parts).toHaveLength(2);
    // Nothing inside a plain disc is dark, and a built-in shape has no picture to take lines from.
    const disc = encodeImage(sampleMask('circle', 120));
    expect(warnings(run('cutter', { shape: 'image', image: disc, stamp: 'areas' }).result)).toEqual(['note.stampEmpty']);
    expect(run('cutter', { shape: 'heart', stamp: 'lines' }).result.parts).toHaveLength(1);
  });

  it('builds every cutter template cleanly', () => {
    for (const name of Object.keys(GENERATORS.cutter.templates!)) {
      const { result } = run('cutter', fromTemplate(GENERATORS.cutter, name));
      expect(warnings(result), name).toEqual([]);
      expect(result.parts[0].shape.solids.length, name).toBe(1);
      expect(size(result.parts[0].shape)[2], name).toBeCloseTo(result.parts[0].shape.boundingBox.bounds[1][2], 3);
    }
  });
});

/** Volume enclosed by a mesh; only meaningful, and positive, if it is closed and faces outwards. */
function meshVolume({ vertices: v, triangles: t }: WeldedMesh): number {
  let six = 0;
  for (let i = 0; i < t.length; i += 3) {
    const [a, b, c] = [3 * t[i], 3 * t[i + 1], 3 * t[i + 2]];
    six += v[a] * (v[b + 1] * v[c + 2] - v[b + 2] * v[c + 1]) - v[a + 1] * (v[b] * v[c + 2] - v[b + 2] * v[c]) + v[a + 2] * (v[b] * v[c + 1] - v[b + 1] * v[c]);
  }
  return six / 6;
}

/** Edges that are not shared by exactly two triangles running in opposite directions. */
function openEdges({ vertices, triangles }: WeldedMesh): number {
  const edges = new Map<number, number>();
  const n = vertices.length / 3;
  for (let i = 0; i < triangles.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const key = triangles[i + k] * n + triangles[i + ((k + 1) % 3)];
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  let open = 0;
  for (const [key, count] of edges) if (count !== 1 || edges.get((key % n) * n + Math.floor(key / n)) !== 1) open++;
  return open;
}

describe('lithophane', () => {
  const litho = (overrides: Params = {}) => ({ ...defaults(GENERATORS.lithophane), ...overrides }) as unknown as LithophaneParams;
  const grey = (value: number, width = 40, height = 30): Bitmap => ({ width, height, data: new Uint8Array(width * height).fill(value) });

  it('builds a closed mesh for every form', () => {
    for (const form of ['flat', 'arc', 'cylinder']) {
      const { result } = run('lithophane', { form });
      expect(result.parts).toHaveLength(0);
      const { mesh } = result.meshes![0];
      expect(openEdges(mesh), form).toBe(0);
      expect(meshVolume(mesh), form).toBeGreaterThan(1000);
      expect(mesh.shade!.length, form).toBe(mesh.vertices.length / 3);
      expect(vertexNormals(mesh).some((v) => Number.isNaN(v)), form).toBe(false);
    }
    expect(GENERATORS.lithophane.meshOnly).toBe(true);
  });

  it('makes bright thin and dark thick, or the reverse', () => {
    const volume = (value: number, overrides: Params = {}) => {
      const { mesh, width, height } = lithophaneMesh(litho({ border: 0, width: 80, ...overrides }), grey(value));
      expect(width).toBeCloseTo(80, 3);
      expect(height).toBeCloseTo(60, 0);
      return meshVolume(mesh) / (width * height);
    };
    expect(volume(255)).toBeCloseTo(0.6, 3);
    expect(volume(0)).toBeCloseTo(3, 3);
    expect(volume(128)).toBeCloseTo(0.6 + 2.4 * (127 / 255), 2);
    expect(volume(255, { negative: true })).toBeCloseTo(3, 3);
    expect(volume(255, { minThickness: 1, maxThickness: 4 })).toBeCloseTo(1, 3);
  });

  it('frames the picture and stands it upright, facing the front', () => {
    const { mesh, width, height } = lithophaneMesh(litho({ width: 100, border: 5 }), grey(255, 60, 40));
    expect(width).toBeCloseTo(100, 0);
    const v = mesh.vertices;
    let [x0, x1, y0, y1, z0, z1] = [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity];
    for (let i = 0; i < v.length; i += 3) {
      x0 = Math.min(x0, v[i]);
      x1 = Math.max(x1, v[i]);
      y0 = Math.min(y0, v[i + 1]);
      y1 = Math.max(y1, v[i + 1]);
      z0 = Math.min(z0, v[i + 2]);
      z1 = Math.max(z1, v[i + 2]);
    }
    expect([x0, x1]).toEqual([-width / 2, width / 2].map((n) => expect.closeTo(n, 3)));
    expect([z0, z1]).toEqual([0, height].map((n) => expect.closeTo(n, 3)));
    // The back is flat at y = 0; the frame, as thick as the darkest spot, comes forward.
    expect(y1).toBeCloseTo(0, 6);
    expect(y0).toBeCloseTo(-3, 6);
    const picture = (90 * (height - 10) * 0.6 + (width * height - 90 * (height - 10)) * 3) / (width * height);
    expect(meshVolume(mesh) / (width * height)).toBeCloseTo(picture, 1);
  });

  it('bends into an arc or closes into a cylinder of the given diameter', () => {
    const flat = lithophaneMesh(litho({ width: 100, border: 0 }), grey(0, 80, 40));
    const arc = lithophaneMesh(litho({ form: 'arc', angle: 180, width: 100, border: 0 }), grey(0, 80, 40));
    const xs = (mesh: WeldedMesh) => mesh.vertices.filter((_, i) => i % 3 === 0);
    const extent = (values: Float32Array) => values.reduce((m, x) => Math.max(m, x), -Infinity) - values.reduce((m, x) => Math.min(m, x), Infinity);
    // Half a circle of 100 mm: radius 100/π at the back, 3 mm more in front
    expect(extent(xs(arc.mesh))).toBeCloseTo(2 * (100 / Math.PI + 3), 1);
    expect(meshVolume(arc.mesh)).toBeGreaterThan(meshVolume(flat.mesh));
    const tube = lithophaneMesh(litho({ form: 'cylinder', diameter: 60, border: 0 }), grey(0, 120, 40));
    expect(extent(xs(tube.mesh))).toBeCloseTo(60, 1);
    expect(openEdges(tube.mesh)).toBe(0);
    expect(meshVolume(tube.mesh) / (Math.PI * (30 ** 2 - 27 ** 2) * tube.height)).toBeCloseTo(1, 1);
  });

  it('uses the picture it is given and refuses a frame that leaves no room', () => {
    const image = encodeImage(grey(200, 64, 48));
    const { result } = run('lithophane', { image });
    expect(result.notes.map((n) => n.key)).not.toContain('note.lithoSample');
    expect(run('lithophane').result.notes.map((n) => n.key)).toContain('note.lithoSample');
    expect(() => run('lithophane', { width: 20, border: 8 })).toThrow(ParamError);
    expect(() => run('lithophane', { image: '4x4:AAAA' })).toThrow(ParamError);
  });

  it('adds a base with a slot, and a seat for a battery light', () => {
    const { result } = run('lithophane', { width: 100, border: 3, stand: 'base' });
    expect(result.parts.map((part) => part.name)).toEqual(['stand']);
    const stand = result.parts[0];
    expect(stand.shape.solids.length).toBe(1);
    // Fitted, its plate lies below the lithophane, which stands in the slot between two ribs.
    const [, dy, dz] = stand.assembled!.offset;
    const fitted = stand.shape.clone().translate([0, dy, dz]) as Shape3D;
    expect(fitted.boundingBox.bounds[1][2]).toBeCloseTo(5, 2);
    const foot = makeBaseBox(100, 3, 20).translate([0, -1.5, 0]) as Shape3D;
    expect(measureVolume(fitted.clone().intersect(foot.clone()))).toBeLessThan(0.001);
    for (const push of [-0.6, 0.6]) expect(measureVolume(fitted.clone().intersect(foot.clone().translate([0, push, 0]) as Shape3D)), String(push)).toBeGreaterThan(1);

    const lit = run('lithophane', { form: 'arc', width: 140, angle: 110, border: 3, stand: 'light', lightDiameter: 68, lightThickness: 25, lightTilt: 15, lightDistance: 50 }).result;
    const seat = lit.parts[0];
    expect(seat.shape.solids.length).toBe(1);
    expect(lit.notes.map((n) => n.key)).toContain('note.lithoLight');
    // The light, a disc leaning back by 15°, fits its hollow without touching.
    const [, sy, sz] = seat.assembled!.offset;
    const base = seat.shape.clone().translate([0, sy, sz]) as Shape3D;
    const tilt = (15 * Math.PI) / 180;
    const light = (makeCylinder(34, 25, [0, 0, -12.5], [0, 0, 1]) as Shape3D).rotate(75, [0, 0, 0], [1, 0, 0]).translate([0, 50, 2 + 34 * Math.cos(tilt) + 12.5 * Math.sin(tilt)]) as Shape3D;
    expect(measureVolume(base.clone().intersect(light.clone()))).toBeLessThan(0.001);
    expect(measureVolume(base.clone().intersect(light.clone().translate([0, 0, -3]) as Shape3D))).toBeGreaterThan(10);
    expect(() => run('lithophane', { form: 'arc', width: 30, angle: 270, stand: 'base' })).toThrow(ParamError);
  });

  it('closes a cylinder with a lid for an E27 or E14 lamp holder', () => {
    for (const [mount, hole] of [['e27', 40.5], ['e14', 28.5]] as const) {
      const { result } = run('lithophane', { form: 'cylinder', diameter: 90, mount });
      expect(result.meshes).toHaveLength(1);
      const lid = result.parts[0];
      expect(lid.name).toBe('mount');
      expect(lid.shape.solids.length).toBe(1);
      const [[x0], [x1]] = lid.shape.boundingBox.bounds;
      expect(x1 - x0).toBeCloseTo(90, 1);
      // Beside the cylinder for printing, so the two do not overlap in the file
      expect(x0).toBeGreaterThan(45);
      const centred = lid.shape.clone().translate([-(x0 + x1) / 2, 0, 0]) as Shape3D;
      const through = (d: number) => measureVolume(centred.clone().intersect(makeCylinder(d / 2, 20, [0, 0, -5], [0, 0, 1]) as Shape3D));
      expect(through(hole - 0.2), mount).toBeLessThan(0.001);
      expect(through(hole + 2), mount).toBeGreaterThan(10);
      expect(lid.assembled!.flip).toBe(true);
    }
    expect(() => run('lithophane', { form: 'cylinder', diameter: 50, mount: 'e27' })).toThrow(ParamError);
  });

  it('leans back, keeps a plinth and puts the relief on either side', () => {
    const upright = lithophaneMesh(litho({ width: 80, border: 0 }), grey(100));
    const tilted = lithophaneMesh(litho({ width: 80, border: 0, tilt: 15 }), grey(100));
    expect(openEdges(tilted.mesh)).toBe(0);
    // Leaning is a shear: the lower edge stays, the top moves back, the volume is the same.
    const reach = (mesh: WeldedMesh) => mesh.vertices.reduce((m, y, i) => (i % 3 === 1 ? Math.max(m, y) : m), -Infinity);
    expect(reach(upright.mesh)).toBeCloseTo(0, 5);
    expect(reach(tilted.mesh)).toBeCloseTo(tilted.height * Math.tan((15 * Math.PI) / 180), 3);
    expect(meshVolume(tilted.mesh)).toBeCloseTo(meshVolume(upright.mesh), 0);
    // A plinth adds height below the picture, as thick as the frame.
    const plinth = lithophaneMesh(litho({ width: 80, border: 0, foot: 6 }), grey(255));
    expect(plinth.height - upright.height).toBeCloseTo(6, 0);
    expect(meshVolume(plinth.mesh) / (80 * upright.height * 0.6 + 80 * (plinth.height - upright.height) * 3)).toBeCloseTo(1, 1);
    // Relief inside: the outside is the smooth one, at the diameter asked for.
    for (const form of ['arc', 'cylinder']) {
      const inside = lithophaneMesh(litho({ form, diameter: 60, width: 100, angle: 120, border: 0, reliefSide: 'inside' }), grey(255, 120, 40));
      const outside = lithophaneMesh(litho({ form, diameter: 60, width: 100, angle: 120, border: 0 }), grey(255, 120, 40));
      expect(openEdges(inside.mesh), form).toBe(0);
      expect(meshVolume(inside.mesh), form).toBeGreaterThan(0);
      // The thin sheet lies at the outer radius now, so there is more of it.
      expect(meshVolume(inside.mesh), form).toBeGreaterThan(meshVolume(outside.mesh) * 1.02);
    }
  });

  it('takes pictures upright or lying, and turns them', () => {
    // 60 × 40 pixels: lying. Its left third is black.
    const lying: Bitmap = { width: 60, height: 40, data: new Uint8Array(2400).map((_, i) => (i % 60 < 20 ? 0 : 255)) };
    const build = (rotate: string) => lithophaneMesh(litho({ border: 0, width: 90, rotate }), lying);
    const thickAt = (mesh: WeldedMesh, test: (x: number, z: number) => boolean) => {
      let thick = 0;
      for (let i = 0; i < mesh.vertices.length; i += 3) if (test(mesh.vertices[i], mesh.vertices[i + 2])) thick = Math.max(thick, -mesh.vertices[i + 1]);
      return thick;
    };
    const plain = build('0');
    expect(plain.height / plain.width).toBeCloseTo(40 / 60, 1);
    expect(thickAt(plain.mesh, (x) => x < -35)).toBeCloseTo(3, 3);
    expect(thickAt(plain.mesh, (x) => x > 0)).toBeCloseTo(0.6, 3);
    // A quarter turn to the right stands it upright; what was left is now on top.
    const right = build('90');
    expect(right.height / right.width).toBeCloseTo(60 / 40, 1);
    expect(openEdges(right.mesh)).toBe(0);
    expect(thickAt(right.mesh, (_, z) => z > right.height * 0.8)).toBeCloseTo(3, 3);
    expect(thickAt(right.mesh, (_, z) => z < right.height * 0.5)).toBeCloseTo(0.6, 3);
    // To the left, it is at the bottom; upside down, on the right.
    const left = build('270');
    expect(thickAt(left.mesh, (_, z) => z < left.height * 0.2)).toBeCloseTo(3, 3);
    expect(thickAt(left.mesh, (_, z) => z > left.height * 0.5)).toBeCloseTo(0.6, 3);
    const over = build('180');
    expect(over.height / over.width).toBeCloseTo(40 / 60, 1);
    expect(thickAt(over.mesh, (x) => x > 35)).toBeCloseTo(3, 3);
    expect(thickAt(over.mesh, (x) => x < 0)).toBeCloseTo(0.6, 3);
  });

  it('adjusts the picture before it becomes thickness', () => {
    const volume = (overrides: Params) => {
      const { mesh, width, height } = lithophaneMesh(litho({ border: 0, width: 80, ...overrides }), grey(128));
      return meshVolume(mesh) / (width * height);
    };
    const plain = volume({});
    expect(volume({ brightness: 20 })).toBeLessThan(plain - 0.3);
    expect(volume({ brightness: -20 })).toBeGreaterThan(plain + 0.3);
    // Contrast pivots on mid grey, which this is.
    expect(volume({ contrast: 80 })).toBeCloseTo(plain, 1);
    // Mirrored, what was left is right; smoothing blurs a hard edge.
    const split: Bitmap = { width: 40, height: 30, data: new Uint8Array(1200).map((_, i) => (i % 40 < 20 ? 0 : 255)) };
    const leftThick = (overrides: Params) => {
      const { mesh } = lithophaneMesh(litho({ border: 0, width: 80, ...overrides }), split);
      const v = mesh.vertices;
      let left = 0;
      for (let i = 0; i < v.length; i += 3) if (v[i] < -30) left = Math.max(left, -v[i + 1]);
      return left;
    };
    expect(leftThick({})).toBeCloseTo(3, 3);
    expect(leftThick({ mirror: true })).toBeCloseTo(0.6, 3);
    const steps = (overrides: Params) => new Set(Array.from(lithophaneMesh(litho({ border: 0, width: 80, ...overrides }), split).mesh.vertices.filter((_, i) => i % 3 === 1), (y) => Math.round(y * 50))).size;
    expect(steps({ smoothing: 3 })).toBeGreaterThan(steps({}) + 3);
  });

  it('prints base and picture as one, braced by struts', () => {
    const separate = run('lithophane', { width: 100, border: 3, foot: 5, stand: 'base' }).result;
    const { result } = run('lithophane', { width: 100, border: 3, foot: 5, tilt: 10, stand: 'base', standPrint: 'joined', struts: 2, strutHeight: 30 });
    expect(result.parts).toHaveLength(0);
    expect(result.meshes).toHaveLength(1);
    expect(result.notes.map((n) => n.key)).toEqual(expect.arrayContaining(['note.lithoJoined', 'note.lithoTilt']));
    const { mesh } = result.meshes![0];
    // Two closed shells in one mesh, standing on the bed together
    expect(openEdges(mesh)).toBe(0);
    const zs = mesh.vertices.filter((_, i) => i % 3 === 2);
    expect(zs.reduce((m, z) => Math.min(m, z), Infinity)).toBeCloseTo(0, 5);
    const alone = separate.meshes![0].mesh;
    const top = (m: WeldedMesh) => m.vertices.reduce((best, z, i) => (i % 3 === 2 ? Math.max(best, z) : best), -Infinity);
    // The picture stands 0.3 mm deep in the 2.4 mm plate.
    expect(top(mesh) - top(alone)).toBeCloseTo(2.1, 3);
    expect(meshVolume(mesh)).toBeGreaterThan(meshVolume(alone) + measureVolume(separate.parts[0].shape));
    expect(mesh.shade!.length).toBe(mesh.vertices.length / 3);
    // Struts are part of a separate base, too, and stay clear of the picture's back.
    const braced = run('lithophane', { width: 100, border: 3, stand: 'base', struts: 3, strutHeight: 40, strutDepth: 20 }).result.parts[0];
    expect(braced.shape.solids.length).toBe(1);
    expect(measureVolume(braced.shape)).toBeGreaterThan(measureVolume(separate.parts[0].shape) + 3 * 0.5 * 40 * 15 * 2.4 * 0.8);
    const [, dy, dz] = braced.assembled!.offset;
    const fitted = braced.shape.clone().translate([0, dy, dz]) as Shape3D;
    expect(fitted.boundingBox.bounds[1][2]).toBeCloseTo(40 - 0.2, 1);
    expect(measureVolume(fitted.clone().intersect(makeBaseBox(100, 3, 60).translate([0, -1.5, 0]) as Shape3D))).toBeLessThan(0.001);
    // A deeper slot and a tea light lying flat in a ring
    const deep = run('lithophane', { width: 100, border: 3, stand: 'base', slotDepth: 10 }).result.parts[0].shape;
    expect(deep.boundingBox.bounds[1][2]).toBeCloseTo(2.4 + 10, 2);
    const tea = run('lithophane', { form: 'arc', width: 110, angle: 140, stand: 'light', lightSeat: 'flat', lightDiameter: 38, lightDistance: 30 }).result.parts[0];
    const ring = tea.shape.clone().translate([0, tea.assembled!.offset[1], tea.assembled!.offset[2]]) as Shape3D;
    expect(measureVolume(ring.clone().intersect(makeCylinder(19, 10, [0, 30, 0.01], [0, 0, 1]) as Shape3D))).toBeLessThan(0.001);
    expect(measureVolume(ring.clone().intersect(makeCylinder(21, 10, [0, 30, 0.01], [0, 0, 1]) as Shape3D))).toBeGreaterThan(5);
  });

  it('writes its mesh as STL and 3MF', () => {
    const { mesh } = run('lithophane').result.meshes![0];
    const stl = writeStl([mesh]);
    expect(stl.byteLength).toBe(84 + 50 * (mesh.triangles.length / 3));
    expect(new DataView(stl.buffer).getUint32(80, true)).toBe(mesh.triangles.length / 3);
    const zip = write3mf([{ name: 'lithophane', mesh }]);
    expect(String.fromCharCode(zip[0], zip[1])).toBe('PK');
  });

  it('builds every lithophane template cleanly', () => {
    for (const name of Object.keys(GENERATORS.lithophane.templates!)) {
      const { result } = run('lithophane', fromTemplate(GENERATORS.lithophane, name));
      expect(openEdges(result.meshes![0].mesh), name).toBe(0);
    }
  });
});

describe('hinge', () => {
  const pair = (shape: Shape3D) => shape.solids.map((solid) => solid as Shape3D);

  it('prints a hinge in place whose leaves turn freely', () => {
    const { result } = run('hinge');
    expect(warnings(result)).toEqual([]);
    const hinge = result.parts[0].shape;
    expect(hinge.solids.length).toBe(2);
    const [l, w, h] = size(hinge);
    expect(l).toBeCloseTo(40, 2);
    expect(w).toBeCloseTo(2 * (4 + 18), 2);
    expect(h).toBeCloseTo(8, 2);
    expect(hinge.boundingBox.bounds[0][2]).toBeCloseTo(0, 3);
    const [a, b] = pair(hinge);
    expect(measureVolume(a.clone().intersect(b.clone()))).toBeLessThan(0.001);
    // Swung up, and folded right over onto the other leaf: still nothing collides.
    for (const angle of [45, 90, 135, 180]) {
      const turned = b.clone().rotate(angle, [0, 0, 4], [1, 0, 0]) as Shape3D;
      expect(measureVolume(a.clone().intersect(turned)), String(angle)).toBeLessThan(0.001);
    }
    // But the knuckles hold on to each other: pulled along the axis or apart, the leaves collide.
    expect(measureVolume(a.clone().intersect(b.clone().translate([2, 0, 0]) as Shape3D))).toBeGreaterThan(1);
    expect(measureVolume(a.clone().intersect(b.clone().translate([0, 2, 0]) as Shape3D))).toBeGreaterThan(1);
  });

  it('cuts screw holes and refuses what cannot work', () => {
    const plain = measureVolume(run('hinge', { holes: 0 }).result.parts[0].shape);
    const drilled = measureVolume(run('hinge', { holes: 2, holeDiameter: 4, countersunk: false }).result.parts[0].shape);
    expect(plain - drilled).toBeCloseTo(4 * Math.PI * 4 * 3, 0);
    expect(measureVolume(run('hinge', { holes: 2, holeDiameter: 4, countersunk: true }).result.parts[0].shape)).toBeLessThan(drilled - 20);
    expect(() => run('hinge', { length: 20, knuckles: 9 })).toThrow(ParamError);
    expect(run('hinge', { clearance: 0.15 }).result.notes.map((n) => n.key)).toContain('note.tightFit');
  });

  it('prints a sliding bolt in place, with its keeper', () => {
    const { result } = run('hinge', { type: 'bolt', length: 55, throw: 15 });
    expect(result.parts.map((part) => part.name)).toEqual(['bolt', 'keeper']);
    const [housing, bolt] = pair(result.parts[0].shape);
    const keeper = result.parts[1].shape;
    expect(result.parts[0].shape.solids.length).toBe(2);
    expect(keeper.solids.length).toBe(1);
    expect(measureVolume(housing.clone().intersect(bolt.clone()))).toBeLessThan(0.001);
    // It slides out by its throw, into the keeper, and no further.
    const out = bolt.clone().translate([15, 0, 0]) as Shape3D;
    expect(measureVolume(housing.clone().intersect(out.clone()))).toBeLessThan(0.001);
    expect(measureVolume(keeper.clone().intersect(out.clone()))).toBeLessThan(0.001);
    expect(out.boundingBox.bounds[1][0]).toBeGreaterThan(keeper.boundingBox.bounds[0][0] + 10);
    expect(measureVolume(housing.clone().intersect(bolt.clone().translate([17, 0, 0]) as Shape3D))).toBeGreaterThan(1);
    expect(measureVolume(housing.clone().intersect(bolt.clone().translate([-2, 0, 0]) as Shape3D))).toBeGreaterThan(1);
    // The channel narrows towards the top: the bolt cannot be lifted out.
    expect(measureVolume(housing.clone().intersect(bolt.clone().translate([0, 0, 2]) as Shape3D))).toBeGreaterThan(1);
    expect(() => run('hinge', { type: 'bolt', length: 30, throw: 40 })).toThrow(ParamError);
    expect(() => run('hinge', { type: 'bolt', boltWidth: 8, boltHeight: 8 })).toThrow(ParamError);
  });

  it('builds every hinge template cleanly', () => {
    for (const name of Object.keys(GENERATORS.hinge.templates!)) {
      const { result } = run('hinge', fromTemplate(GENERATORS.hinge, name));
      expect(warnings(result), name).toEqual([]);
      const [a, b] = pair(result.parts[0].shape);
      expect(measureVolume(a.clone().intersect(b.clone())), name).toBeLessThan(0.001);
    }
  });
});
