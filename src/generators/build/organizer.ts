import { draw, makeBaseBox, type Shape3D, type Sketch } from 'replicad';
import type { Note } from '../types';
import { cutAll, fuseAll, ParamError, patternCells, prism, round1, roundedBox, roundedRect, type Build, type Part, type Pattern, type Vec3 } from './common';

export interface OrganizerParams {
  drawerWidth: number;
  drawerDepth: number;
  height: number;
  layout: 'auto' | 'manual' | 'custom';
  colRatios: string;
  rowRatios: string;
  targetSize: number;
  maxPrint: number;
  columns: number;
  rows: number;
  gap: number;
  wall: number;
  floor: number;
  cornerRadius: number;
  dividersX: number;
  dividersY: number;
  dividerDrop: number;
  grip: 'none' | 'front' | 'frontback' | 'all';
  gripWidth: number;
  gripDepth: number;
  drain: 'none' | Pattern;
  drainSize: number;
  drainGap: number;
  label: boolean;
  labelDepth: number;
}

/** Number of equal cells along one drawer axis. */
function cells(span: number, p: OrganizerParams, manual: number): number {
  if (p.layout === 'manual') return Math.round(manual);
  const fitsBed = Math.ceil((span - p.gap) / p.maxPrint);
  return Math.max(1, fitsBed, Math.round(span / p.targetSize));
}

/** Cell sizes along one drawer axis: equal, or in the proportions the user typed. */
function split(span: number, p: OrganizerParams, manual: number, ratios: string): number[] {
  if (p.layout !== 'custom') {
    const n = cells(span, p, manual);
    return Array.from({ length: n }, () => span / n);
  }
  const parts = ratios.split(/[,; ]+/).map(Number).filter((v) => v > 0);
  const list = parts.length ? parts : [1];
  const sum = list.reduce((a, b) => a + b, 0);
  return list.map((v) => (span * v) / sum);
}

export function* buildOrganizer(p: OrganizerParams): Build {
  const notes: Note[] = [];
  const warn = (key: string) => {
    if (!notes.some((n) => n.key === key)) notes.push({ level: 'warn', key });
  };
  const cols = split(p.drawerWidth, p, p.columns, p.colRatios);
  const rows = split(p.drawerDepth, p, p.rows, p.rowRatios);
  const t = p.wall;
  const h = p.height;
  const floor = Math.min(p.floor, h - 1);
  if (Math.min(...cols, ...rows) - p.gap < 2 * t + 4) throw new ParamError('err.boxTooSmall');

  /** One box of the given footprint, centred on the origin; yields its bare outer body first. */
  function* makeBox(bw: number, bd: number): Generator<Shape3D, Shape3D, void> {
    const r = Math.min(p.cornerRadius, Math.min(bw, bd) / 2 - 0.5);
    const outer = roundedBox(bw, bd, r, h);
    yield outer;
    let box = outer.cut(roundedBox(bw - 2 * t, bd - 2 * t, r - t, h, floor)) as Shape3D;
    const cuts: Shape3D[] = [];

    // Drain openings go in before the dividers, so a divider never ends up with a hole under it.
    if (p.drain !== 'none') {
      const m = t + Math.max(2, r * 0.3);
      const { cells: holes, coarsened } = patternCells(p.drain, p.drainSize, p.drainGap, p.drainSize * 3, bw - 2 * m, bd - 2 * m, () => true);
      if (!holes.length) warn('note.noRoomDrain');
      if (coarsened && !notes.some((n) => n.key === 'note.patternCoarsened')) notes.push({ level: 'info', key: 'note.patternCoarsened' });
      box = cutAll(box, holes.map((c) => prism(c.drawing.translate(c.x, c.y), floor + 2, -1)));
    }

    const dx = Math.round(p.dividersX);
    const dy = Math.round(p.dividersY);
    const dh = Math.max(floor + 2, h - p.dividerDrop);
    const adds: Shape3D[] = [];
    for (let i = 1; i <= dx; i++) adds.push(makeBaseBox(t, bd - t, dh).translate(-bw / 2 + t / 2 + (i * (bw - t)) / (dx + 1), 0, 0));
    for (let j = 1; j <= dy; j++) adds.push(makeBaseBox(bw - t, t, dh).translate(0, -bd / 2 + t / 2 + (j * (bd - t)) / (dy + 1), 0));

    // A ledge along the back wall to stick a label on; its 45° underside prints without support.
    if (p.label) {
      const d = Math.min(p.labelDepth, h - floor - 1, bd / 2);
      const y = bd / 2 - t / 2;
      const ledge = (draw([y, h]).lineTo([y - d, h]).lineTo([y, h - d]).close().sketchOnPlane('YZ', -bw / 2 + t / 2) as Sketch).extrude(bw - t) as Shape3D;
      adds.push(ledge.intersect(outer) as Shape3D);
    }
    if (adds.length) box = box.fuse(fuseAll(adds)) as Shape3D;

    // Finger grips: rounded notches in the upper rim.
    if (p.grip !== 'none') {
      const gd = Math.min(p.gripDepth, h - floor - 2);
      const sides = p.grip === 'front' ? [0] : p.grip === 'frontback' ? [0, 180] : [0, 90, 180, 270];
      for (const angle of sides) {
        const span = angle % 180 === 0 ? bw : bd;
        const dist = angle % 180 === 0 ? bd / 2 : bw / 2;
        const gw = Math.min(p.gripWidth, span - 2 * r - 2 * t - 2);
        if (gw < 6 || gd < 2) {
          warn('note.noRoomGrip');
          continue;
        }
        // Twice as tall as deep and centred on the rim, so only the lower corners are rounded.
        cuts.push(
          prism(roundedRect(gw, 2 * gd, Math.min(gd, gw / 2) * 0.6), t + 2, -1)
            .rotate(90, [0, 0, 0], [1, 0, 0])
            .translate(0, -dist + t, h)
            .rotate(angle, [0, 0, 0], [0, 0, 1]),
        );
      }
      box = cutAll(box, cuts);
    }
    return box;
  }

  // Group the cells by footprint: every distinct size is built and exported once.
  const kinds = new Map<string, { bw: number; bd: number; at: Vec3[] }>();
  let x = -p.drawerWidth / 2;
  for (const cw of cols) {
    let y = -p.drawerDepth / 2;
    for (const cd of rows) {
      const key = `${cw.toFixed(2)}x${cd.toFixed(2)}`;
      if (!kinds.has(key)) kinds.set(key, { bw: cw - p.gap, bd: cd - p.gap, at: [] });
      kinds.get(key)!.at.push([x + cw / 2, y + cd / 2, 0]);
      y += cd;
    }
    x += cw;
  }

  const parts: Part[] = [];
  let shelf = 0; // exported boxes sit side by side instead of on top of each other
  for (const kind of kinds.values()) {
    const steps = makeBox(kind.bw, kind.bd);
    let step = steps.next();
    while (!step.done) {
      if (!parts.length) yield { label: 'stage.outer', parts: [{ name: 'box', shape: step.value, instances: [kind.at[0]] }] };
      step = steps.next();
    }
    const offset = parts.length ? shelf + kind.bw / 2 : 0;
    const name = kinds.size > 1 ? `box-${round1(kind.bw)}x${round1(kind.bd)}` : 'box';
    parts.push({ name, shape: offset ? step.value.translate(offset, 0, 0) : step.value, instances: kind.at.map(([px, py]): Vec3 => [px - offset, py, 0]) });
    shelf = offset + kind.bw / 2 + 10;
    if (kinds.size > 1) notes.push({ level: 'info', key: 'note.organizerKind', vars: { n: kind.at.length, w: round1(kind.bw), d: round1(kind.bd) } });
    yield { label: 'stage.grid', parts: [...parts] };
  }

  if (kinds.size === 1) {
    const [kind] = kinds.values();
    notes.unshift({ level: 'info', key: 'note.organizerGrid', vars: { nx: cols.length, ny: rows.length, n: kind.at.length, w: round1(kind.bw), d: round1(kind.bd) } });
    if (p.layout === 'auto' && Math.max(kind.bw, kind.bd) > p.maxPrint) notes.push({ level: 'warn', key: 'note.boxExceedsBed', vars: { bed: p.maxPrint } });
  } else {
    notes.unshift({ level: 'info', key: 'note.organizerMixed', vars: { n: cols.length * rows.length, kinds: kinds.size } });
  }
  return { parts, notes, frame: [p.drawerWidth, p.drawerDepth] };
}
