import { draw, drawCircle, drawPolysides, makeBaseBox, makeCompound, type Drawing, type Shape3D, type Sketch } from 'replicad';
import type { Note } from '../types';
import { cutAll, fuseAll, ParamError, prism, revolveZ, round1, roundedBox, roundedRect, type Build, type Part, type Placement } from './common';

export interface GridfinityParams {
  kind: 'bin' | 'baseplate';
  unitsX: number;
  unitsY: number;
  unitsZ: number;
  lip: boolean;
  fill: 'hollow' | 'solid' | 'holes';
  wall: number;
  floor: number;
  divX: number;
  divY: number;
  dividerDrop: number;
  scoop: number;
  label: 'none' | 'full' | 'left' | 'center' | 'right';
  labelWidth: number;
  labelDepth: number;
  holePreset: 'custom' | 'bit' | 'aaa' | 'aa' | 'c18650' | 'pen';
  holeShape: 'round' | 'hex' | 'square';
  holeSize: number;
  holeDepth: number;
  holeGap: number;
  baseHoles: 'none' | 'magnets' | 'screws' | 'both';
  baseHolesAt: 'corners' | 'all';
  magnetDiameter: number;
  magnetDepth: number;
  plateSize: 'units' | 'drawer';
  plateX: number;
  plateY: number;
  drawerWidth: number;
  drawerDepth: number;
  alignX: 'left' | 'center' | 'right';
  alignY: 'front' | 'center' | 'back';
  maxPrint: number;
  plateFloor: number;
  plateMagnets: boolean;
  plateScrews: 'none' | 'corners' | 'all';
  plateScrewDiameter: number;
}

// The Gridfinity standard: a 42 mm grid, 7 mm height units.
const PITCH = 42;
const UNIT_Z = 7;
const BIN_GAP = 0.5; // a bin is this much smaller than its grid cells
const RADIUS = 3.75; // outer corner of a bin
const FOOT_H = 4.75;
const LIP_H = 4.1; // the standard 4.4 mm lip, less the knife edge at its top
const MAGNET_AT = 13; // magnet and screw holes, from the centre of a cell
const SCREW_D = 3;
const SCREW_DEPTH = 6;
const SOCKET_H = 4.65;

/** Tool holder presets: opening shape, width and depth. */
const HOLDERS: Record<string, { shape: 'round' | 'hex' | 'square'; size: number; depth: number; gap: number }> = {
  bit: { shape: 'hex', size: 6.7, depth: 9, gap: 3 },
  aaa: { shape: 'round', size: 10.9, depth: 14, gap: 1.6 },
  aa: { shape: 'round', size: 14.9, depth: 14, gap: 1.6 },
  c18650: { shape: 'round', size: 18.9, depth: 14, gap: 1.6 },
  pen: { shape: 'round', size: 12, depth: 100, gap: 2 },
};

type Section = [inset: number, z: number];

/** A solid through rounded rectangles that are `inset` from an l × w outline of corner radius r, with straight flanks in between. */
function profile(l: number, w: number, r: number, sections: Section[], x = 0, y = 0): Shape3D {
  const sketches = sections.map(([inset, z]) => roundedRect(l - 2 * inset, w - 2 * inset, Math.max(0.1, r - inset)).translate(x, y).sketchOnPlane('XY', z) as Sketch);
  return sketches[0].loftWith(sketches.slice(1), { ruled: true });
}

/** A round pocket, `depth` deep below `top`. */
const hole = (d: number, depth: number, x: number, y: number, top: number) => prism(drawCircle(d / 2).translate(x, y), depth + 1, top - depth);

function* buildBin(p: GridfinityParams): Build {
  const notes: Note[] = [];
  const warn = (key: string, vars?: Note['vars']) => {
    if (!notes.some((n) => n.key === key)) notes.push({ level: 'warn', key, vars });
  };
  const nx = Math.round(p.unitsX);
  const ny = Math.round(p.unitsY);
  const L = nx * PITCH - BIN_GAP;
  const W = ny * PITCH - BIN_GAP;
  const H = Math.round(p.unitsZ) * UNIT_Z;
  const hollow = p.fill === 'hollow';
  const t = p.wall;
  const screws = p.baseHoles === 'screws' || p.baseHoles === 'both';
  const magnets = p.baseHoles === 'magnets' || p.baseHoles === 'both';
  // The floor stays closed above the screw holes.
  const floorZ = Math.max(FOOT_H + p.floor, screws ? SCREW_DEPTH + 0.8 : 0, magnets ? p.magnetDepth + 0.8 : 0);
  if (hollow && H - floorZ < 2) throw new ParamError('err.binTooLow');
  const top = H + (p.lip ? LIP_H : 0);

  // One foot per grid cell, under a body with the outline of the whole bin
  const foot = profile(PITCH - BIN_GAP, PITCH - BIN_GAP, RADIUS, [[2.95, 0], [2.15, 0.8], [2.15, 2.6], [0, FOOT_H]]);
  const centres: [number, number][] = [];
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) centres.push([(i - (nx - 1) / 2) * PITCH, (j - (ny - 1) / 2) * PITCH]);
  const outer = roundedBox(L, W, RADIUS, top - FOOT_H, FOOT_H);
  const feet = centres.map(([x, y]) => foot.clone().translate(x, y, 0) as Shape3D);
  let bin = outer.fuse(feet.length === 1 ? feet[0] : (makeCompound(feet) as Shape3D)) as Shape3D;
  yield { label: 'stage.outer', parts: [{ name: 'bin', shape: bin }] };

  // Cavity and stacking lip are one tool: the lip grows out of the wall at 45°, so it prints without support.
  const lip: Section[] = [[2.6, H], [1.9, H + 0.7], [1.9, H + 2.5], [0.3, H + LIP_H], [0.3, H + LIP_H + 1]];
  if (hollow) {
    const under = Math.max(0, 2.6 - t);
    const lead: Section[] = under > 0 ? [[t, floorZ], [t, Math.max(floorZ + 0.5, H - under)]] : [[t, floorZ]];
    const sections = p.lip ? (t < 2.6 ? [...lead, ...lip] : [[2.6, floorZ] as Section, ...lip]) : [[t, floorZ] as Section, [t, H + 1] as Section];
    bin = bin.cut(profile(L, W, RADIUS, sections)) as Shape3D;
  } else if (p.lip) {
    bin = bin.cut(profile(L, W, RADIUS, lip)) as Shape3D;
  }
  yield { label: 'stage.hollow', parts: [{ name: 'bin', shape: bin }] };

  const cuts: Shape3D[] = [];
  if (hollow) {
    const dx = Math.round(p.divX);
    const dy = Math.round(p.divY);
    const dh = Math.max(2, H - floorZ - p.dividerDrop);
    const adds: Shape3D[] = [];
    // Centre lines of the walls that bound the compartments
    const xs = Array.from({ length: dx + 2 }, (_, i) => -L / 2 + t / 2 + (i * (L - t)) / (dx + 1));
    const ys = Array.from({ length: dy + 2 }, (_, j) => -W / 2 + t / 2 + (j * (W - t)) / (dy + 1));
    for (const x of xs.slice(1, -1)) adds.push(makeBaseBox(t, W - t, dh).translate(x, 0, floorZ));
    for (const y of ys.slice(1, -1)) adds.push(makeBaseBox(L - t, t, dh).translate(0, y, floorZ));

    // A rounded ramp at the front of every row, to slide small parts out with a finger
    const scoop = Math.min(p.scoop, H - floorZ - 1, (W - t) / (dy + 1) - t - 2);
    if (p.scoop > 0 && scoop < 2) warn('note.noRoomScoop');
    else if (p.scoop > 0) {
      const z0 = floorZ - 0.3;
      for (const y of ys.slice(0, -1)) {
        const front = y + t / 2;
        const k = scoop * (1 - Math.SQRT1_2);
        const ramp = draw([y, z0]).lineTo([front + scoop, z0]).lineTo([front + scoop, floorZ]).threePointsArcTo([front, floorZ + scoop], [front + k, floorZ + k]).lineTo([y, floorZ + scoop]).close();
        adds.push((ramp.sketchOnPlane('YZ', -L / 2 + t / 2) as Sketch).extrude(L - t) as Shape3D);
      }
    }

    // Label ledges with a 45° underside, at the back of every compartment
    if (p.label !== 'none') {
      const d = Math.min(p.labelDepth, H - floorZ - 1, (W - t) / (dy + 1) - t - 2);
      if (d < 3) warn('note.noRoomLabel');
      else {
        const backs = p.dividerDrop > 0 ? ys.slice(-1) : ys.slice(1);
        for (const y of backs) {
          const ledge = draw([y, H]).lineTo([y - t / 2 - d, H]).lineTo([y, H - d - t / 2]).close();
          for (let i = 0; i <= dx; i++) {
            const span = xs[i + 1] - xs[i];
            const w = p.label === 'full' ? span : Math.min(p.labelWidth + t, span);
            const x0 = p.label === 'right' ? xs[i + 1] - w : p.label === 'left' || p.label === 'full' ? xs[i] : xs[i] + (span - w) / 2;
            adds.push((ledge.sketchOnPlane('YZ', x0) as Sketch).extrude(w) as Shape3D);
          }
        }
      }
    }
    if (adds.length) bin = bin.fuse(fuseAll(adds).intersect(roundedBox(L, W, RADIUS, H, 0)) as Shape3D) as Shape3D;
    notes.push({ level: 'info', key: 'note.gfInside', vars: { l: round1((L - t) / (dx + 1) - t), w: round1((W - t) / (dy + 1) - t), h: round1(H - floorZ), n: (dx + 1) * (dy + 1) } });
  } else if (p.fill === 'holes') {
    // A solid block with a field of pockets: bits, batteries, pens …
    const h = p.holePreset === 'custom' ? { shape: p.holeShape, size: p.holeSize, depth: p.holeDepth, gap: p.holeGap } : HOLDERS[p.holePreset];
    const depth = Math.min(h.depth, H - 1.2);
    const margin = (p.lip ? 2.6 : 1.2) + 0.8;
    let pitch = h.size + h.gap;
    const count = (span: number) => Math.max(0, Math.floor((span - 2 * margin - h.size) / pitch) + 1);
    while (count(L) * count(W) > 300) pitch *= 1.1;
    const cx = count(L);
    const cy = count(W);
    if (!cx || !cy) warn('note.noRoomHoles');
    const shape: Drawing = h.shape === 'round' ? drawCircle(h.size / 2) : h.shape === 'hex' ? drawPolysides(h.size / Math.sqrt(3), 6) : roundedRect(h.size, h.size, 0);
    for (let i = 0; i < cx; i++) for (let j = 0; j < cy; j++) cuts.push(prism(shape.translate((i - (cx - 1) / 2) * pitch, (j - (cy - 1) / 2) * pitch), depth + 1, H - depth));
    if (cx * cy) notes.push({ level: 'info', key: 'note.gfHoles', vars: { n: cx * cy, nx: cx, ny: cy, d: round1(h.size), depth: round1(depth) } });
  }

  if (p.baseHoles !== 'none') {
    const spots: [number, number][] = [];
    for (const [x, y] of centres) {
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
          const outermost = Math.abs(x + sx * MAGNET_AT) > (L - PITCH) / 2 && Math.abs(y + sy * MAGNET_AT) > (W - PITCH) / 2;
          if (p.baseHolesAt === 'all' || outermost) spots.push([x + sx * MAGNET_AT, y + sy * MAGNET_AT]);
        }
      }
    }
    for (const [x, y] of spots) {
      // One stepped tool where a screw hole continues above the magnet
      const md = magnets ? p.magnetDiameter / 2 : SCREW_D / 2;
      const steps: [number, number][] = [[0, -1], [md, -1], [md, magnets ? p.magnetDepth : SCREW_DEPTH]];
      if (magnets && screws && SCREW_DEPTH > p.magnetDepth) steps.push([SCREW_D / 2, p.magnetDepth], [SCREW_D / 2, SCREW_DEPTH]);
      const [, depth] = steps[steps.length - 1];
      cuts.push(revolveZ([...steps, [0, depth]]).translate(x, y, 0) as Shape3D);
    }
    if (magnets) notes.push({ level: 'info', key: 'note.gfMagnets', vars: { n: spots.length, d: p.magnetDiameter, depth: p.magnetDepth } });
    if (screws) notes.push({ level: 'info', key: 'note.gfScrews', vars: { n: spots.length } });
    if (floorZ > FOOT_H + p.floor + 0.01 && hollow) notes.push({ level: 'info', key: 'note.gfFloorRaised', vars: { z: round1(floorZ) } });
  }
  bin = cutAll(bin, cuts);

  notes.unshift({ level: 'info', key: 'note.gfBin', vars: { x: nx, y: ny, z: Math.round(p.unitsZ), l: L, w: W, h: round1(top) } });
  return { parts: [{ name: 'bin', shape: bin }], notes };
}

/**
 * Split `units` cells into as few runs as fit the print bed, the rims at both
 * ends included. The runs are arranged symmetrically where that is possible,
 * so opposite plates come out alike.
 */
function runs(units: number, before: number, after: number, maxPrint: number): number[] {
  for (let k = 1; k <= units; k++) {
    const small = Math.floor(units / k);
    let large = units % k; // this many runs are one cell longer
    let rest = k - large;
    const sizes = new Array<number>(k);
    for (let lo = 0, hi = k - 1; lo <= hi; lo++, hi--) {
      // The shorter runs go to the ends, which also carry the rim.
      if (lo === hi) sizes[lo] = rest ? small : small + 1;
      else if (rest >= 2) [sizes[lo], sizes[hi], rest] = [small, small, rest - 2];
      else if (large >= 2) [sizes[lo], sizes[hi], large] = [small + 1, small + 1, large - 2];
      else [sizes[lo], sizes[hi], rest, large] = [small, small + 1, rest - 1, large - 1];
    }
    const fits = sizes.every((n, i) => n * PITCH + (i === 0 ? before : 0) + (i === k - 1 ? after : 0) <= maxPrint);
    if (fits || k === units) return sizes;
  }
  return [units];
}

interface Tile {
  ux: number;
  uy: number;
  /** Rim beyond the cells: left, right, front, back. */
  pads: [number, number, number, number];
  /** Cells with a screw hole, as "column,row". */
  screws: string[];
}

function* buildBaseplate(p: GridfinityParams): Build {
  const notes: Note[] = [];
  const drawer = p.plateSize === 'drawer';
  const nx = drawer ? Math.floor(p.drawerWidth / PITCH) : Math.round(p.plateX);
  const ny = drawer ? Math.floor(p.drawerDepth / PITCH) : Math.round(p.plateY);
  if (nx < 1 || ny < 1) throw new ParamError('err.drawerTooSmall');
  // What is left of the drawer becomes a solid rim, so the plate cannot slide.
  const restX = drawer ? p.drawerWidth - nx * PITCH : 0;
  const restY = drawer ? p.drawerDepth - ny * PITCH : 0;
  const share = (rest: number, align: string): [number, number] => (align === 'center' ? [rest / 2, rest / 2] : align === 'left' || align === 'front' ? [0, rest] : [rest, 0]);
  const [padL, padR] = share(restX, p.alignX);
  const [padF, padB] = share(restY, p.alignY);

  const screwD = p.plateScrewDiameter;
  const floor = Math.max(p.plateFloor, p.plateMagnets ? p.magnetDepth + 0.8 : 0, p.plateScrews !== 'none' ? screwD / 2 + 1 : 0);
  if (floor > p.plateFloor + 0.01) notes.push({ level: 'info', key: 'note.gfPlateFloor', vars: { t: round1(floor) } });
  const H = floor + SOCKET_H;

  const cols = runs(nx, padL, padR, p.maxPrint);
  const rows = runs(ny, padF, padB, p.maxPrint);
  const single = cols.length * rows.length === 1;

  function makeTile(tile: Tile): Shape3D {
    const [l, r, f, b] = tile.pads;
    const bw = tile.ux * PITCH + l + r;
    const bd = tile.uy * PITCH + f + b;
    const block = roundedBox(bw, bd, single ? 4 : 0, H).translate((r - l) / 2, (b - f) / 2, 0) as Shape3D;
    const tools: Shape3D[] = [];
    for (let i = 0; i < tile.ux; i++) {
      for (let j = 0; j < tile.uy; j++) {
        const x = (i - (tile.ux - 1) / 2) * PITCH;
        const y = (j - (tile.uy - 1) / 2) * PITCH;
        // The socket a bin's foot sits in; without a floor it is open at the bottom
        const socket: Section[] = [[2.9, floor], [2.2, floor + 0.7], [2.2, floor + 2.5], [0.05, H], [0.05, H + 1]];
        tools.push(profile(PITCH, PITCH, 4, floor > 0 ? socket : [[2.9, -1], ...socket], x, y));
        if (p.plateMagnets) for (const sx of [-1, 1]) for (const sy of [-1, 1]) tools.push(hole(p.magnetDiameter, p.magnetDepth, x + sx * MAGNET_AT, y + sy * MAGNET_AT, floor));
        if (p.plateScrews === 'all' || tile.screws.includes(`${i},${j}`)) {
          const sink = screwD / 2;
          tools.push(revolveZ([[0, -1], [screwD / 2, -1], [screwD / 2, floor - sink], [screwD, floor], [screwD, floor + 0.5], [0, floor + 0.5]]).translate(x, y, 0) as Shape3D);
        }
      }
    }
    return cutAll(block, tools);
  }

  const keyOf = (tile: Tile) => `${tile.ux}x${tile.uy}/${tile.pads.map((v) => v.toFixed(2)).join('/')}/${[...tile.screws].sort().join(' ')}`;
  /** The same tile after half a turn. */
  const turned = ({ ux, uy, pads: [l, r, f, b], screws }: Tile): Tile => ({
    ux,
    uy,
    pads: [r, l, b, f],
    screws: screws.map((cell) => cell.split(',').map(Number)).map(([i, j]) => `${ux - 1 - i},${uy - 1 - j}`),
  });

  // Tiles of the same size and rim are built and exported once; that includes tiles which only differ by half a turn.
  const kinds = new Map<string, { tile: Tile; at: Placement[] }>();
  let x = -(nx * PITCH + padL + padR) / 2;
  cols.forEach((ux, ci) => {
    const l = ci === 0 ? padL : 0;
    const r = ci === cols.length - 1 ? padR : 0;
    let y = -(ny * PITCH + padF + padB) / 2;
    rows.forEach((uy, ri) => {
      const f = ri === 0 ? padF : 0;
      const b = ri === rows.length - 1 ? padB : 0;
      // Screws in the corners of the whole plate, wherever its tiles end up
      const screws: string[] = [];
      if (p.plateScrews === 'corners') {
        const is = [...(ci === 0 ? [0] : []), ...(ci === cols.length - 1 ? [ux - 1] : [])];
        const js = [...(ri === 0 ? [0] : []), ...(ri === rows.length - 1 ? [uy - 1] : [])];
        for (const i of new Set(is)) for (const j of new Set(js)) screws.push(`${i},${j}`);
      }
      const tile: Tile = { ux, uy, pads: [l, r, f, b], screws };
      const other = turned(tile);
      const half = !kinds.has(keyOf(tile)) && (kinds.has(keyOf(other)) || keyOf(other) < keyOf(tile));
      const kind = half ? other : tile;
      if (!kinds.has(keyOf(kind))) kinds.set(keyOf(kind), { tile: kind, at: [] });
      kinds.get(keyOf(kind))!.at.push([x + l + (ux * PITCH) / 2, y + f + (uy * PITCH) / 2, 0, half ? 180 : 0]);
      y += uy * PITCH + f + b;
    });
    x += ux * PITCH + l + r;
  });

  const parts: Part[] = [];
  const names = new Set<string>();
  let shelf = 0;
  for (const kind of kinds.values()) {
    const { tile } = kind;
    const [l, r] = tile.pads;
    const shape = makeTile(tile);
    const left = (tile.ux * PITCH) / 2 + l;
    const offset = parts.length ? shelf + left : 0;
    let name = single ? 'baseplate' : `plate-${tile.ux}x${tile.uy}`;
    for (let n = 2; names.has(name); n++) name = `plate-${tile.ux}x${tile.uy}-${n}`;
    names.add(name);
    parts.push({ name, shape: offset ? (shape.translate(offset, 0, 0) as Shape3D) : shape, instances: kind.at.map(([px, py, , turn = 0]): Placement => [turn ? px + offset : px - offset, py, 0, turn]) });
    shelf = offset + (tile.ux * PITCH) / 2 + r + 10;
    if (!single) {
      const vars = { x: tile.ux, y: tile.uy, w: round1(tile.ux * PITCH + l + r), d: round1(tile.uy * PITCH + tile.pads[2] + tile.pads[3]), n: kind.at.length };
      notes.push({ level: 'info', key: 'note.gfTile', vars });
    }
    yield { label: 'stage.grid', parts: [...parts] };
  }

  const size = { nx, ny, l: round1(nx * PITCH + restX), w: round1(ny * PITCH + restY), h: round1(H) };
  if (!single) notes.unshift({ level: 'info', key: 'note.gfTiles', vars: { n: cols.length * rows.length, kinds: kinds.size } });
  if (drawer && restX + restY > 0.05) notes.unshift({ level: 'info', key: 'note.gfRim', vars: { px: round1(restX), py: round1(restY) } });
  notes.unshift({ level: 'info', key: 'note.gfPlate', vars: size });
  if (Math.max(...cols.map((n) => n * PITCH), ...rows.map((n) => n * PITCH)) > p.maxPrint) notes.push({ level: 'warn', key: 'note.boxExceedsBed', vars: { bed: p.maxPrint } });
  return { parts, notes, frame: drawer ? [p.drawerWidth, p.drawerDepth] : undefined };
}

export function buildGridfinity(p: GridfinityParams): Build {
  return p.kind === 'baseplate' ? buildBaseplate(p) : buildBin(p);
}
