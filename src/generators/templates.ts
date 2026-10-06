// Starting points the user can load and then change. Each template is a set
// of overrides on top of the generator's defaults.
import { BOARDS } from './boards';
import type { Params } from './types';

type Edge = 'left' | 'right' | 'front' | 'back';

interface Port {
  type: string;
  edge: Edge;
  /** Centre along the edge, in board coordinates (X for front/back, Y for left/right). */
  at: number;
  /** Centre above the top face of the board. */
  up: number;
  extra?: Params;
}

const PCB_THICKNESS = 1.6;

/** A snap-lid box around a board, with openings where its connectors are. */
function boardCase(board: string, screw: string, standoff: number, clearAbove: number, ports: Port[], extra: Params = {}): Params {
  const { length, width } = BOARDS[board];
  const wall = 2;
  const gap = 1.5; // between board edge and wall
  const openings = ports.map((port): Params => {
    const centred = port.edge === 'front' || port.edge === 'back' ? port.at - length / 2 : port.at - width / 2;
    // Offsets run to the right as seen from outside, so two walls count backwards.
    const offset = port.edge === 'back' || port.edge === 'left' ? -centred : centred;
    return { type: port.type, face: port.edge, offset: Math.round(offset * 10) / 10, height: Math.round((standoff + PCB_THICKNESS + port.up) * 10) / 10, ...port.extra };
  });
  return {
    shape: 'box',
    length: Math.ceil(length + 2 * (gap + wall)),
    width: Math.ceil(width + 2 * (gap + wall)),
    // Connectors must stay below the lip of the snap lid, hence the extra 7 mm.
    height: Math.ceil(standoff + PCB_THICKNESS + clearAbove + 2 * wall + 7),
    wall,
    cornerRadius: 3,
    pcb: true,
    pcbBoard: board,
    pcbScrew: screw,
    standoffHeight: standoff,
    lidFix: 'snap',
    openings,
    lidVent: 'hex',
    lidVentSize: 4,
    lidVentGap: 1.6,
    ...extra,
  };
}

const sd = (at: number, edge: Edge = 'left'): Port => ({ type: 'sd', edge, at, up: -PCB_THICKNESS - 0.8 });
const audio: Params = { preset: 'audio35' };

export const ENCLOSURE_TEMPLATES: Record<string, Params> = {
  demo: {},
  rpi5: boardCase('rpi', 'M2.5', 4, 17, [
    { type: 'usbc', edge: 'front', at: 11.2, up: 1.6 },
    { type: 'microhdmi', edge: 'front', at: 25.8, up: 1.5 },
    { type: 'microhdmi', edge: 'front', at: 39.2, up: 1.5 },
    { type: 'rj45', edge: 'right', at: 10.2, up: 6.8 },
    { type: 'usba2', edge: 'right', at: 29.1, up: 8 },
    { type: 'usba2', edge: 'right', at: 47, up: 8 },
    sd(28),
  ]),
  rpi4: boardCase('rpi', 'M2.5', 4, 17, [
    { type: 'usbc', edge: 'front', at: 11.2, up: 1.6 },
    { type: 'microhdmi', edge: 'front', at: 26, up: 1.5 },
    { type: 'microhdmi', edge: 'front', at: 39.5, up: 1.5 },
    { type: 'round', edge: 'front', at: 54, up: 3, extra: audio },
    { type: 'usba2', edge: 'right', at: 9, up: 8 },
    { type: 'usba2', edge: 'right', at: 27, up: 8 },
    { type: 'rj45', edge: 'right', at: 45.75, up: 6.8 },
    sd(28),
  ]),
  rpi3: boardCase('rpi', 'M2.5', 4, 17, [
    { type: 'microusb', edge: 'front', at: 10.6, up: 1.3 },
    { type: 'hdmi', edge: 'front', at: 32, up: 3.2 },
    { type: 'round', edge: 'front', at: 53.5, up: 3, extra: audio },
    { type: 'rj45', edge: 'right', at: 10.25, up: 6.8 },
    { type: 'usba2', edge: 'right', at: 29, up: 8 },
    { type: 'usba2', edge: 'right', at: 47, up: 8 },
    sd(28),
  ]),
  rpizero: boardCase('rpizero', 'M2.5', 3, 6, [
    { type: 'minihdmi', edge: 'front', at: 12.4, up: 1.7 },
    { type: 'microusb', edge: 'front', at: 41.4, up: 1.3 },
    { type: 'microusb', edge: 'front', at: 54, up: 1.3 },
    sd(16.9),
  ]),
  pico: boardCase('pico', 'M2', 3, 5, [{ type: 'microusb', edge: 'left', at: 10.5, up: 1.3 }], { lidVent: 'none' }),
  uno: boardCase('uno', 'M3', 4, 15, [
    { type: 'usbb', edge: 'left', at: 38.2, up: 5.6 },
    { type: 'barrel', edge: 'left', at: 7.7, up: 5.6 },
  ]),
  mega: boardCase('mega', 'M3', 4, 15, [
    { type: 'usbb', edge: 'left', at: 38.2, up: 5.6 },
    { type: 'barrel', edge: 'left', at: 7.7, up: 5.6 },
  ]),
  feather: boardCase('feather', 'M2.5', 3, 8, [{ type: 'microusb', edge: 'left', at: 11.43, up: 1.3 }], { lidVent: 'none' }),
  esp32devkit: boardCase('esp32devkit', 'M2.5', 4, 8, [{ type: 'microusb', edge: 'left', at: 14.1, up: 1.3 }], { lidVent: 'none' }),
  beaglebone: boardCase('beaglebone', 'M3', 4, 17, []),
  // A plain project box with a hinged, sealed lid
  hinged: { length: 140, width: 90, height: 50, wall: 3, pcb: false, lidFix: 'snap', hinge: true, hingeCount: 2, gasket: true, gasketWidth: 1.5, openings: [{ type: 'gland', face: 'left', thread: 'M16', height: 22 }], lidVent: 'none' },
  // Round sensor housing with a twist-lock lid
  round: { shape: 'round', diameter: 80, height: 40, pcb: false, lidFix: 'twist', openings: [{ type: 'gland', face: 'back', thread: 'PG7', height: 16 }], lidVent: 'holes', lidVentSize: 2.5 },
  speaker: { length: 100, width: 100, height: 50, pcb: false, lidVent: 'none', openings: [{ type: 'speaker', face: 'lid', speaker: '66' }, { type: 'usbc', face: 'back', height: 8 }] },
  dinrail: { length: 90, width: 60, height: 40, pcbLength: 70, pcbWidth: 40, dinClip: true, lidVent: 'slots', openings: [{ type: 'rect', face: 'front', width: 30, rectHeight: 10, height: 14 }] },
};
