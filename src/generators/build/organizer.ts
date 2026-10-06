import { makeBaseBox, type Shape3D } from 'replicad';
import type { Note } from '../types';
import { fuseAll, ParamError, round1, roundedBox, type Build, type Vec3 } from './common';

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

  const dx = Math.round(p.dividersX);
  const dy = Math.round(p.dividersY);
  const dividers: Shape3D[] = [];
  for (let i = 1; i <= dx; i++) {
    dividers.push(makeBaseBox(t, bd - t, h).translate(-bw / 2 + t / 2 + (i * (bw - t)) / (dx + 1), 0, 0));
  }
  for (let j = 1; j <= dy; j++) {
    dividers.push(makeBaseBox(bw - t, t, h).translate(0, -bd / 2 + t / 2 + (j * (bd - t)) / (dy + 1), 0));
  }
  if (dividers.length) {
    yield { label: 'stage.hollow', parts: [{ name: 'box', shape: box, instances: [instances[0]] }] };
    box = box.fuse(fuseAll(dividers)) as Shape3D;
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
