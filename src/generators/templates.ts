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
  dinrail: { length: 90, width: 60, height: 40, pcbLength: 70, pcbWidth: 40, din: 'back', lidVent: 'slots', openings: [{ type: 'rect', face: 'front', width: 30, rectHeight: 10, height: 14 }] },
};

export const ADAPTER_TEMPLATES: Record<string, Params> = {
  demo: {},
  // Joins or repairs two garden hoses
  hoseJoin: { std1: 'hose13', barbs1: true, len1: 30, std2: 'hose19', barbs2: true, len2: 30, barbCount1: 5, barbCount2: 5, transition: 8 },
  // Screws into a 3/4" tap connector or pump and takes a 1/2" hose
  tapToHose: { std1: 'g34m', len1: 14, std2: 'hose13', barbs2: true, len2: 30, barbCount2: 5, wall: 2.4, transition: 8 },
  // Thread adapter, e.g. from a 1/2" tap to 3/4" garden fittings
  threadReducer: { std1: 'g12f', len1: 14, std2: 'g34m', len2: 14, wall: 3, transition: 6 },
  // Shop vacuum hose to a power tool port
  vacuum: { std1: 'vac35', len1: 35, std2: 'custom', d2: 27, fit2: 'inside', barbs2: false, len2: 35, transition: 15 },
  // Dust extraction: 100 mm duct down to a 50 mm hose
  dust: { std1: 'dust100', len1: 40, std2: 'dust50', len2: 40, wall: 2.4, transition: 40 },
  drainReducer: { std1: 'ht50', len1: 40, std2: 'ht40', len2: 40, wall: 2.4, transition: 10 },
  drainElbow: { std1: 'ht40', len1: 35, std2: 'ht40', len2: 35, wall: 2.4, angle: 45, bendRadius: 45 },
  // Duct connection screwed to a wall or panel
  ductFlange: { std1: 'custom', d1: 100, fit1: 'inside', len1: 15, std2: 'custom', d2: 100, fit2: 'inside', barbs2: false, len2: 40, flange: 'end1', flangeDiameter: 140, flangeThickness: 3, flangeHoles: 4, transition: 0 },
};

// Drawer sizes are typical inner dimensions; furniture differs, so measure before printing.
export const ORGANIZER_TEMPLATES: Record<string, Params> = {
  demo: {},
  kitchen30: { drawerWidth: 200, drawerDepth: 470, height: 60, targetSize: 110 },
  kitchen45: { drawerWidth: 350, drawerDepth: 470, height: 60, targetSize: 120 },
  kitchen60: { drawerWidth: 500, drawerDepth: 470, height: 60, targetSize: 125 },
  kitchen80: { drawerWidth: 700, drawerDepth: 470, height: 60, targetSize: 140 },
  // Long compartments for knives, forks and spoons, short ones in front for the small stuff
  cutlery: { drawerWidth: 500, drawerDepth: 470, height: 50, layout: 'custom', colRatios: '1, 1, 1, 1, 1.4', rowRatios: '1, 2.4', cornerRadius: 8, grip: 'none' },
  mixed: { drawerWidth: 400, drawerDepth: 450, height: 45, layout: 'random', targetSize: 90, seed: 7 },
  desk: { drawerWidth: 330, drawerDepth: 400, height: 35, layout: 'custom', colRatios: '2, 1, 1', rowRatios: '1, 1, 2' },
  workshop: { drawerWidth: 540, drawerDepth: 410, height: 45, targetSize: 90, wall: 1.6, dividersX: 1, label: true, labelDepth: 10 },
  smallParts: { drawerWidth: 300, drawerDepth: 400, height: 30, targetSize: 60, cornerRadius: 3, dividersY: 1 },
  bathroom: { drawerWidth: 400, drawerDepth: 350, height: 70, targetSize: 130, drain: 'holes', grip: 'frontback', cornerRadius: 10 },
};

export const GRIDFINITY_TEMPLATES: Record<string, Params> = {
  demo: {},
  small: { unitsX: 1, unitsY: 1, unitsZ: 3 },
  parts: { unitsX: 3, unitsY: 2, unitsZ: 3, divX: 2, divY: 1, scoop: 12, label: 'full' },
  magnetic: { unitsX: 2, unitsY: 2, unitsZ: 6, baseHoles: 'magnets', baseHolesAt: 'corners' },
  bits: { unitsX: 2, unitsY: 1, unitsZ: 3, fill: 'holes', holePreset: 'bit' },
  batteries: { unitsX: 2, unitsY: 2, unitsZ: 4, fill: 'holes', holePreset: 'aa' },
  plate: { kind: 'baseplate', plateX: 4, plateY: 4 },
  plateMagnets: { kind: 'baseplate', plateX: 3, plateY: 3, plateMagnets: true, plateScrews: 'corners' },
  // Fills a whole drawer, cut into plates that fit the printer
  drawer: { kind: 'baseplate', plateSize: 'drawer', drawerWidth: 400, drawerDepth: 450 },
};

export const HOOK_TEMPLATES: Record<string, Params> = {
  demo: {},
  coat: { width: 25, thickness: 7, reach: 45, tipHeight: 25, angle: 15, bend: 8, plateHeight: 80, plateThickness: 5 },
  keys: { width: 10, thickness: 4, reach: 18, tipHeight: 10, angle: 20, bend: 3, plateHeight: 40, plateThickness: 4, count: 5, spacing: 35, screwCount: 2 },
  broom: { type: 'cradle', width: 25, thickness: 5, diameter: 25, tipHeight: 4, plateHeight: 70 },
  shelf: { type: 'bracket', width: 30, thickness: 6, reach: 120, tipHeight: 0, plateHeight: 110, plateThickness: 6, rib: 5 },
  door: { mount: 'door', width: 25, thickness: 5, reach: 30, tipHeight: 20, plateHeight: 70, plateThickness: 3 },
  pegboard: { mount: 'pegboard', width: 12, thickness: 5, reach: 40, tipHeight: 12, plateHeight: 45 },
  towel: { mount: 'tape', width: 40, thickness: 5, reach: 25, tipHeight: 18, angle: 0, bend: 8, plateHeight: 60, plateThickness: 3 },
};

export const TEXT_TEMPLATES: Record<string, Params> = {
  demo: {},
  keychain: { text: 'Keys', font: 'fredoka', size: 9, plateShape: 'pill', hole: 'left', plateThickness: 2, padding: 4 },
  doorSign: { text: 'Workshop', font: 'zilla-slab', size: 18, border: 1.6, hole: 'both', padding: 8, cornerRadius: 5, plateThickness: 3 },
  twoColour: { text: 'Hello', font: 'pacifico', size: 16, separate: true, plateShape: 'ellipse', textHeight: 0.8 },
  stamp: { text: 'OK', font: 'bebas-neue', size: 14, mirror: true, textHeight: 2, plateThickness: 4, padding: 3 },
  stencil: { text: 'FRAGILE', font: 'allerta-stencil', size: 25, style: 'cutout', plateThickness: 1.2, padding: 10 },
  letters: { text: 'Home', font: 'pacifico', size: 30, style: 'letters', textHeight: 5, bar: false },
  label: { text: 'M3 × 10\nM3 × 16', font: 'jetbrains-mono', size: 6, style: 'engraved', textHeight: 0.6, plateThickness: 1.6, padding: 3, cornerRadius: 1.5 },
};
