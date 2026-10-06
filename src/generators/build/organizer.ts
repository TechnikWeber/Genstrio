import { draw, makeBaseBox, type Shape3D, type Sketch } from 'replicad';
import type { Note } from '../types';
import { cutAll, fuseAll, ParamError, patternCells, prism, round1, roundedBox, roundedRect, type Build, type Pattern, type Vec3 } from './common';

export interface OrganizerParams {
  drawerWidth: number;
  drawerDepth: number;
  height: number;
  layout: 'auto' | 'manual';
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

export function* buildOrganizer(p: OrganizerParams): Build {
  const notes: Note[] = [];
  const nx = cells(p.drawerWidth, p, p.columns);
  const ny = cells(p.drawerDepth, p, p.rows);
  const cellW = p.drawerWidth / nx;
  const cellD = p.drawerDepth / ny;
  const bw = cellW - p.gap;
  const bd = cellD - p.gap;
  const t = p.wall;
  const h = p.height;
  const floor = Math.min(p.floor, h - 1);
  if (Math.min(bw, bd) < 2 * t + 4) throw new ParamError('err.boxTooSmall');

  const instances: Vec3[] = [];
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      instances.push([(i - (nx - 1) / 2) * cellW, (j - (ny - 1) / 2) * cellD, 0]);
    }
  }

  const r = Math.min(p.cornerRadius, Math.min(bw, bd) / 2 - 0.5);
  const outer = roundedBox(bw, bd, r, h);
  yield { label: 'stage.outer', parts: [{ name: 'box', shape: outer, instances: [instances[0]] }] };

  let box = outer.cut(roundedBox(bw - 2 * t, bd - 2 * t, r - t, h, floor)) as Shape3D;

  const cuts: Shape3D[] = [];

  // Drain openings go in before the dividers, so a divider never ends up with a hole under it.
  if (p.drain !== 'none') {
    const m = t + Math.max(2, r * 0.3);
    const { cells, coarsened } = patternCells(p.drain, p.drainSize, p.drainGap, p.drainSize * 3, bw - 2 * m, bd - 2 * m, () => true);
    if (!cells.length) notes.push({ level: 'warn', key: 'note.noRoomDrain' });
    if (coarsened) notes.push({ level: 'info', key: 'note.patternCoarsened' });
    for (const c of cells) cuts.push(prism(c.drawing.translate(c.x, c.y), floor + 2, -1));
    box = cutAll(box, cuts.splice(0));
  }

  const dx = Math.round(p.dividersX);
  const dy = Math.round(p.dividersY);
  const dh = Math.max(floor + 2, h - p.dividerDrop);
  const dividers: Shape3D[] = [];
  for (let i = 1; i <= dx; i++) {
    dividers.push(makeBaseBox(t, bd - t, dh).translate(-bw / 2 + t / 2 + (i * (bw - t)) / (dx + 1), 0, 0));
  }
  for (let j = 1; j <= dy; j++) {
    dividers.push(makeBaseBox(bw - t, t, dh).translate(0, -bd / 2 + t / 2 + (j * (bd - t)) / (dy + 1), 0));
  }

  // A ledge along the back wall to stick a label on; its 45° underside prints without support.
  if (p.label) {
    const d = Math.min(p.labelDepth, h - floor - 1, bd / 2);
    const y = bd / 2 - t / 2;
    const ledge = (draw([y, h]).lineTo([y - d, h]).lineTo([y, h - d]).close().sketchOnPlane('YZ', -bw / 2 + t / 2) as Sketch).extrude(bw - t) as Shape3D;
    dividers.push(ledge.intersect(outer) as Shape3D);
  }

  if (dividers.length) {
    yield { label: 'stage.hollow', parts: [{ name: 'box', shape: box, instances: [instances[0]] }] };
    box = box.fuse(fuseAll(dividers)) as Shape3D;
  }

  // Finger grips: rounded notches in the upper rim.
  if (p.grip !== 'none') {
    const gd = Math.min(p.gripDepth, h - floor - 2);
    const sides = p.grip === 'front' ? [0] : p.grip === 'frontback' ? [0, 180] : [0, 90, 180, 270];
    for (const angle of sides) {
      const span = angle % 180 === 0 ? bw : bd;
      const dist = angle % 180 === 0 ? bd / 2 : bw / 2;
      const gw = Math.min(p.gripWidth, span - 2 * r - 2 * t - 2);
      if (gw < 6 || gd < 2) {
        notes.push({ level: 'warn', key: 'note.noRoomGrip' });
        break;
      }
      // Twice as tall as deep and centred on the rim, so only the lower corners are rounded.
      const notch = prism(roundedRect(gw, 2 * gd, Math.min(gd, gw / 2) * 0.6), t + 2, -1)
        .rotate(90, [0, 0, 0], [1, 0, 0])
        .translate(0, -dist + t, h)
        .rotate(angle, [0, 0, 0], [0, 0, 1]);
      cuts.push(notch);
    }
    box = cutAll(box, cuts);
  }

  const parts = [{ name: 'box', shape: box, instances }];
  yield { label: 'stage.grid', parts };

  notes.push({
    level: 'info',
    key: 'note.organizerGrid',
    vars: { nx, ny, n: nx * ny, w: round1(bw), d: round1(bd) },
  });
  const bed = p.layout === 'auto' ? p.maxPrint : 0;
  if (bed && Math.max(bw, bd) > bed) notes.push({ level: 'warn', key: 'note.boxExceedsBed', vars: { bed } });
  return { parts, notes, frame: [p.drawerWidth, p.drawerDepth] };
}
