import { BOARDS } from './boards';
import { FITTINGS } from './fittings';
import { FONTS } from './fonts';
import {
  ADAPTER_TEMPLATES,
  CUTTER_TEMPLATES,
  ENCLOSURE_TEMPLATES,
  GEAR_TEMPLATES,
  GRIDFINITY_TEMPLATES,
  HINGE_TEMPLATES,
  HOOK_TEMPLATES,
  LITHOPHANE_TEMPLATES,
  ORGANIZER_TEMPLATES,
  QR_TEMPLATES,
  RELIEF_TEMPLATES,
  TEXT_TEMPLATES,
} from './templates';
import type { FieldDef, GeneratorId, GeneratorMeta, Params } from './types';

const hasPcb = (p: Params) => p.pcb === true;
const customPcb = (p: Params) => hasPcb(p) && p.pcbBoard === 'custom';
const hasLid = (p: Params) => p.lid === true;
const powered = (p: Params) => p.battery !== 'none';
const isBox = (p: Params) => p.shape === 'box';
const lidScrewed = (p: Params) => hasLid(p) && p.lidFix === 'screws';
const lidSnaps = (p: Params) => hasLid(p) && p.lidFix === 'snap';
const lettered = (p: Params) => hasLid(p) && String(p.lidText).trim() !== '';
const hinged = (p: Params) => hasLid(p) && p.hinge === true;
const onPlate = (o: Params) => o.face === 'lid' || o.face === 'floor';
const is = (key: string, ...values: string[]) => (p: Params) => values.includes(p[key] as string);

export const SCREW_SIZES = ['M2', 'M2.5', 'M3', 'M4', 'M5'];
export const VENT_PATTERNS = ['none', 'slots', 'holes', 'hex', 'triangles', 'grid'];

const opening: FieldDef[] = [
  { key: 'type', group: 'openings', type: 'select', options: ['round', 'gland', 'cable', 'rect', 'usbc', 'microusb', 'usba', 'usba2', 'usbb', 'hdmi', 'minihdmi', 'microhdmi', 'rj45', 'barrel', 'sd', 'speaker', 'fan'], default: 'round' },
  { key: 'face', group: 'openings', type: 'select', options: ['front', 'back', 'left', 'right', 'lid', 'floor'], default: 'front' },
  {
    key: 'preset', group: 'openings', type: 'select', default: 'custom', showIf: is('type', 'round'),
    options: ['custom', 'sma', 'bnc', 'led3', 'led5', 'audio35', 'toggle', 'pot', 'dcjack', 'button12', 'button16', 'button19', 'button22'],
  },
  { key: 'diameter', group: 'openings', type: 'number', min: 1, max: 200, sliderMax: 40, step: 0.1, default: 8, unit: 'mm', showIf: (o) => o.type === 'cable' || (o.type === 'round' && o.preset === 'custom') },
  {
    key: 'thread', group: 'openings', type: 'select', default: 'M16', showIf: is('type', 'gland'),
    options: ['M12', 'M16', 'M20', 'M25', 'M32', 'M40', 'PG7', 'PG9', 'PG11', 'PG13.5', 'PG16', 'PG21'],
  },
  { key: 'printThread', group: 'openings', type: 'bool', default: false, showIf: is('type', 'gland') },
  { key: 'width', group: 'openings', type: 'number', min: 1, max: 300, sliderMax: 80, step: 0.1, default: 20, unit: 'mm', showIf: is('type', 'rect') },
  { key: 'rectHeight', group: 'openings', type: 'number', min: 1, max: 300, sliderMax: 80, step: 0.1, default: 10, unit: 'mm', showIf: is('type', 'rect') },
  { key: 'radius', group: 'openings', type: 'number', min: 0, max: 50, sliderMax: 10, step: 0.1, default: 1, unit: 'mm', showIf: is('type', 'rect') },
  { key: 'speaker', group: 'openings', type: 'select', options: ['20', '23', '28', '36', '40', '45', '50', '57', '66', '77'], default: '40', showIf: is('type', 'speaker') },
  { key: 'ring', group: 'openings', type: 'bool', default: true, showIf: (o) => o.type === 'speaker' && onPlate(o) },
  { key: 'fan', group: 'openings', type: 'select', options: ['25', '30', '40', '50', '60', '70', '80', '92', '120'], default: '40', showIf: is('type', 'fan') },
  { key: 'grille', group: 'openings', type: 'select', options: ['holes', 'hex', 'grid', 'slots', 'triangles', 'open'], default: 'holes', showIf: is('type', 'speaker', 'fan') },
  { key: 'offset', group: 'openings', type: 'number', min: -250, max: 250, sliderMax: 100, step: 0.5, default: 0, unit: 'mm' },
  { key: 'height', group: 'openings', type: 'number', min: 0, max: 300, sliderMax: 60, step: 0.1, default: 10, unit: 'mm', showIf: (o) => !onPlate(o) },
  { key: 'offsetY', group: 'openings', type: 'number', min: -250, max: 250, sliderMax: 100, step: 0.5, default: 0, unit: 'mm', showIf: onPlate },
];

const vent = (target: 'lid' | 'body', extra: FieldDef[] = []): FieldDef[] => {
  const k = `${target}Vent`;
  const on = (p: Params) => p[k] !== 'none' && (target === 'body' || hasLid(p));
  return [
    { key: k, group: k, type: 'select', options: VENT_PATTERNS, default: target === 'lid' ? 'slots' : 'none', showIf: target === 'lid' ? hasLid : undefined },
    ...extra.map((d) => ({ ...d, group: k, showIf: on })),
    { key: `${k}Size`, group: k, type: 'number', min: 1, max: 30, sliderMax: 12, step: 0.1, default: 2, unit: 'mm', showIf: on },
    { key: `${k}Gap`, group: k, type: 'number', min: 0.8, max: 30, sliderMax: 12, step: 0.1, default: 2.4, unit: 'mm', showIf: on },
    { key: `${k}Length`, group: k, type: 'number', min: 2, max: 300, sliderMax: 100, step: 1, default: target === 'lid' ? 40 : 15, unit: 'mm', showIf: (p) => on(p) && p[k] === 'slots' },
    { key: `${k}Area`, group: k, type: 'number', min: 10, max: 100, step: 1, default: 70, unit: '%', showIf: on },
  ];
};

export const enclosure: GeneratorMeta = {
  id: 'enclosure',
  params: [
    { key: 'shape', group: 'outer', type: 'select', options: ['box', 'round', 'polygon'], default: 'box' },
    { key: 'length', group: 'outer', type: 'number', min: 20, max: 500, sliderMax: 300, step: 1, default: 120, unit: 'mm', showIf: isBox },
    { key: 'width', group: 'outer', type: 'number', min: 20, max: 500, sliderMax: 300, step: 1, default: 80, unit: 'mm', showIf: isBox },
    { key: 'diameter', group: 'outer', type: 'number', min: 20, max: 500, sliderMax: 300, step: 1, default: 100, unit: 'mm', showIf: (p) => !isBox(p) },
    { key: 'sides', group: 'outer', type: 'number', min: 3, max: 12, step: 1, default: 6, showIf: is('shape', 'polygon') },
    { key: 'height', group: 'outer', type: 'number', min: 10, max: 300, sliderMax: 150, step: 1, default: 35, unit: 'mm' },
    { key: 'wall', group: 'outer', type: 'number', min: 0.8, max: 10, sliderMax: 6, step: 0.1, default: 2, unit: 'mm' },
    { key: 'cornerRadius', group: 'outer', type: 'number', min: 0, max: 60, sliderMax: 30, step: 0.5, default: 4, unit: 'mm', showIf: (p) => p.shape !== 'round' },

    { key: 'pcb', group: 'pcb', type: 'bool', default: true },
    { key: 'pcbBoard', group: 'pcb', type: 'select', options: ['custom', ...Object.keys(BOARDS)], default: 'custom', showIf: hasPcb },
    { key: 'pcbLength', group: 'pcb', type: 'number', min: 10, max: 480, sliderMax: 280, step: 0.5, default: 100, unit: 'mm', showIf: customPcb },
    { key: 'pcbWidth', group: 'pcb', type: 'number', min: 10, max: 480, sliderMax: 280, step: 0.5, default: 60, unit: 'mm', showIf: customPcb },
    { key: 'holeInset', group: 'pcb', type: 'number', min: 1.5, max: 50, sliderMax: 20, step: 0.1, default: 3.5, unit: 'mm', showIf: customPcb },
    { key: 'standoffHeight', group: 'pcb', type: 'number', min: 1, max: 60, sliderMax: 30, step: 0.5, default: 5, unit: 'mm', showIf: hasPcb },
    { key: 'pcbOffsetX', group: 'pcb', type: 'number', min: -200, max: 200, sliderMax: 100, step: 0.5, default: 0, unit: 'mm', showIf: hasPcb },
    { key: 'pcbOffsetY', group: 'pcb', type: 'number', min: -200, max: 200, sliderMax: 100, step: 0.5, default: 0, unit: 'mm', showIf: hasPcb },
    { key: 'pcbScrew', group: 'pcb', type: 'select', options: SCREW_SIZES, default: 'M3', showIf: hasPcb },
    { key: 'pcbHole', group: 'pcb', type: 'select', options: ['selftap', 'insert'], default: 'selftap', showIf: hasPcb },

    { key: 'battery', group: 'battery', type: 'select', options: ['none', 'aaa', 'aa', 'c18650', 'block9v'], default: 'none' },
    { key: 'batteryCount', group: 'battery', type: 'number', min: 1, max: 6, step: 1, default: 2, showIf: powered },
    { key: 'batteryX', group: 'battery', type: 'number', min: -250, max: 250, sliderMax: 100, step: 0.5, default: 0, unit: 'mm', showIf: powered },
    { key: 'batteryY', group: 'battery', type: 'number', min: -250, max: 250, sliderMax: 100, step: 0.5, default: 0, unit: 'mm', showIf: powered },
    { key: 'batteryTurn', group: 'battery', type: 'bool', default: false, showIf: powered },

    { key: 'lid', group: 'lid', type: 'bool', default: true },
    { key: 'lidFix', group: 'lid', type: 'select', options: ['screws', 'snap', 'twist', 'bolt', 'none'], default: 'screws', showIf: hasLid },
    { key: 'boltWidth', group: 'lid', type: 'number', min: 6, max: 30, sliderMax: 20, step: 0.5, default: 10, unit: 'mm', showIf: (p) => hasLid(p) && p.lidFix === 'bolt' },
    { key: 'lidScrew', group: 'lid', type: 'select', options: SCREW_SIZES, default: 'M3', showIf: lidScrewed },
    { key: 'lidHole', group: 'lid', type: 'select', options: ['selftap', 'insert'], default: 'selftap', showIf: lidScrewed },
    { key: 'lidHead', group: 'lid', type: 'select', options: ['flat', 'countersunk', 'counterbore'], default: 'flat', showIf: lidScrewed },
    { key: 'snapCount', group: 'lid', type: 'number', min: 1, max: 4, step: 1, default: 1, showIf: lidSnaps },
    { key: 'snapWidth', group: 'lid', type: 'number', min: 3, max: 60, sliderMax: 30, step: 0.5, default: 10, unit: 'mm', showIf: lidSnaps },
    { key: 'snapHeight', group: 'lid', type: 'number', min: 0.2, max: 2, step: 0.05, default: 0.6, unit: 'mm', showIf: lidSnaps },
    { key: 'lidThickness', group: 'lid', type: 'number', min: 0.8, max: 10, sliderMax: 6, step: 0.1, default: 2, unit: 'mm', showIf: hasLid },
    { key: 'clearance', group: 'lid', type: 'number', min: 0, max: 1, step: 0.05, default: 0.2, unit: 'mm', fit: true, showIf: hasLid },
    { key: 'hinge', group: 'lid', type: 'bool', default: false, showIf: hasLid },
    { key: 'hingeType', group: 'lid', type: 'select', options: ['pin', 'clip'], default: 'pin', showIf: hinged },
    { key: 'hingeCount', group: 'lid', type: 'number', min: 1, max: 4, step: 1, default: 2, showIf: hinged },
    { key: 'hingeWidth', group: 'lid', type: 'number', min: 10, max: 120, sliderMax: 60, step: 1, default: 24, unit: 'mm', showIf: hinged },
    { key: 'hingePin', group: 'lid', type: 'number', min: 1, max: 6, step: 0.05, default: 1.75, unit: 'mm', showIf: hinged },
    { key: 'gasket', group: 'lid', type: 'bool', default: false, showIf: hasLid },
    { key: 'gasketWidth', group: 'lid', type: 'number', min: 1, max: 5, step: 0.1, default: 1.5, unit: 'mm', showIf: (p) => hasLid(p) && p.gasket === true },

    { key: 'lidText', group: 'lidText', type: 'text', default: '', pattern: '^[\\s\\S]{0,120}$', lines: true, maxLength: 120, showIf: hasLid },
    { key: 'lidTextFont', group: 'lidText', type: 'select', options: FONTS, default: 'inter', showIf: lettered },
    { key: 'lidTextSize', group: 'lidText', type: 'number', min: 2, max: 100, sliderMax: 30, step: 0.5, default: 8, unit: 'mm', showIf: lettered },
    { key: 'lidTextStyle', group: 'lidText', type: 'select', options: ['engraved', 'raised'], default: 'engraved', showIf: lettered },
    { key: 'lidTextDepth', group: 'lidText', type: 'number', min: 0.2, max: 5, sliderMax: 2, step: 0.1, default: 0.6, unit: 'mm', showIf: lettered },
    { key: 'lidTextX', group: 'lidText', type: 'number', min: -250, max: 250, sliderMax: 100, step: 0.5, default: 0, unit: 'mm', showIf: lettered },
    { key: 'lidTextY', group: 'lidText', type: 'number', min: -250, max: 250, sliderMax: 100, step: 0.5, default: 0, unit: 'mm', showIf: lettered },
    { key: 'lidTextTurn', group: 'lidText', type: 'select', options: ['0', '90', '180', '270'], default: '0', showIf: lettered },

    {
      key: 'openings', group: 'openings', type: 'list', item: opening, max: 16,
      default: [{ type: 'usbc', face: 'front', height: 8.2 }],
    },

    ...vent('lid'),
    ...vent('body', [
      { key: 'bodyVentWalls', group: '', type: 'select', options: ['none', 'sides', 'frontback', 'all'], default: 'sides' },
      { key: 'bodyVentFloor', group: '', type: 'bool', default: false },
    ]),

    { key: 'ears', group: 'mount', type: 'select', options: ['none', 'two', 'four'], default: 'none' },
    { key: 'earHole', group: 'mount', type: 'number', min: 2, max: 10, step: 0.1, default: 4.5, unit: 'mm', showIf: (p) => p.ears !== 'none' },
    { key: 'earSides', group: 'mount', type: 'select', options: ['leftright', 'frontback'], default: 'leftright', showIf: (p) => p.ears !== 'none' },
    { key: 'earSpacing', group: 'mount', type: 'number', min: 0, max: 480, sliderMax: 200, step: 1, default: 0, unit: 'mm', showIf: (p) => p.ears === 'four' },
    { key: 'earOffset', group: 'mount', type: 'number', min: -240, max: 240, sliderMax: 100, step: 1, default: 0, unit: 'mm', showIf: (p) => p.ears !== 'none' },
    { key: 'din', group: 'mount', type: 'select', options: ['none', 'back', 'front', 'left', 'right', 'floor'], default: 'none' },
    { key: 'dinOffset', group: 'mount', type: 'number', min: -240, max: 240, sliderMax: 100, step: 1, default: 0, unit: 'mm', showIf: (p) => p.din !== 'none' },
  ],
  templates: ENCLOSURE_TEMPLATES,
};

const bent = (p: Params) => (p.angle as number) > 0;
const flanged = (p: Params) => p.flange !== 'none';
const branched = (p: Params) => !bent(p) && p.branch !== 'none';

const STANDARDS = ['custom', ...Object.keys(FITTINGS)];

/** The parameters of one adapter end. */
const end = (n: 1 | 2 | 3, d: number, fit: string, barbs: boolean): FieldDef[] => {
  const group = `end${n}`;
  const custom = (p: Params) => p[`std${n}`] === 'custom';
  const plugs = (p: Params) => (custom(p) ? p[`fit${n}`] === 'inside' : FITTINGS[p[`std${n}`] as string]?.fit === 'inside' && !FITTINGS[p[`std${n}`] as string]?.thread);
  const barbed = (p: Params) => plugs(p) && p[`barbs${n}`] === true;
  return [
    { key: `std${n}`, group, type: 'select', options: STANDARDS, default: 'custom' },
    { key: `d${n}`, group, type: 'number', min: 1, max: 1000, sliderMax: 200, step: 0.1, default: d, unit: 'mm', showIf: custom },
    { key: `fit${n}`, group, type: 'select', options: ['inside', 'over'], default: fit, showIf: custom },
    { key: `len${n}`, group, type: 'number', min: 1, max: 500, sliderMax: 100, step: 1, default: 25, unit: 'mm' },
    { key: `barbs${n}`, group, type: 'bool', default: barbs, showIf: plugs },
    { key: `barbCount${n}`, group, type: 'number', min: 1, max: 12, step: 1, default: 4, showIf: barbed },
    { key: `barbHeight${n}`, group, type: 'number', min: 0.2, max: 5, sliderMax: 2, step: 0.1, default: 0.8, unit: 'mm', showIf: barbed },
    { key: `barbPitch${n}`, group, type: 'number', min: 1.5, max: 20, sliderMax: 10, step: 0.5, default: 4, unit: 'mm', showIf: barbed },
  ];
};

export const adapter: GeneratorMeta = {
  id: 'adapter',
  templates: ADAPTER_TEMPLATES,
  params: [
    ...end(1, 32, 'over', false),
    ...end(2, 40, 'inside', true),

    { key: 'branch', group: 'end3', type: 'select', options: ['none', 'tee', 'cross'], default: 'none', showIf: (p) => !bent(p) },
    // A third end, only there with a branch
    ...end(3, 20, 'inside', true).map((def): FieldDef => ({ ...def, showIf: (p) => branched(p) && (def.showIf?.(p) ?? true) })),
    { key: 'branchAngle', group: 'end3', type: 'number', min: 30, max: 90, step: 5, default: 90, unit: '°', showIf: branched },

    { key: 'wall', group: 'body', type: 'number', min: 0.4, max: 50, sliderMax: 10, step: 0.1, default: 2, unit: 'mm' },
    { key: 'transition', group: 'body', type: 'number', min: 0, max: 500, sliderMax: 100, step: 1, default: 10, unit: 'mm' },
    { key: 'clearance', group: 'body', type: 'number', min: -1, max: 5, sliderMax: 1, step: 0.05, default: 0.3, unit: 'mm', fit: true },
    { key: 'chamfer', group: 'body', type: 'number', min: 0, max: 5, sliderMax: 2, step: 0.1, default: 0.6, unit: 'mm' },
    { key: 'angle', group: 'body', type: 'number', min: 0, max: 180, step: 1, default: 0, unit: '°' },
    { key: 'bendRadius', group: 'body', type: 'number', min: 1, max: 1000, sliderMax: 200, step: 1, default: 40, unit: 'mm', showIf: bent },

    { key: 'flange', group: 'flange', type: 'select', options: ['none', 'end1', 'between'], default: 'none' },
    { key: 'flangeDiameter', group: 'flange', type: 'number', min: 10, max: 1200, sliderMax: 200, step: 1, default: 70, unit: 'mm', showIf: flanged },
    { key: 'flangeThickness', group: 'flange', type: 'number', min: 1, max: 30, sliderMax: 10, step: 0.5, default: 4, unit: 'mm', showIf: flanged },
    { key: 'flangeHoles', group: 'flange', type: 'number', min: 0, max: 12, step: 1, default: 4, showIf: flanged },
    { key: 'flangeHoleDiameter', group: 'flange', type: 'number', min: 2, max: 20, sliderMax: 10, step: 0.1, default: 4.5, unit: 'mm', showIf: (p) => flanged(p) && (p.flangeHoles as number) > 0 },
  ],
};

const manual = (p: Params) => p.layout === 'manual';
const sized = (p: Params) => p.layout === 'auto' || p.layout === 'random';
// One to twelve positive numbers, separated by commas or spaces
const RATIOS = '^\\s*\\d+(\\.\\d+)?(\\s*[,; ]\\s*\\d+(\\.\\d+)?){0,11}\\s*$';

export const organizer: GeneratorMeta = {
  id: 'organizer',
  templates: ORGANIZER_TEMPLATES,
  params: [
    { key: 'drawerWidth', group: 'drawer', type: 'number', min: 30, max: 1200, step: 1, default: 287, unit: 'mm' },
    { key: 'drawerDepth', group: 'drawer', type: 'number', min: 30, max: 1200, step: 1, default: 410, unit: 'mm' },
    { key: 'height', group: 'drawer', type: 'number', min: 5, max: 250, step: 1, default: 40, unit: 'mm' },

    { key: 'layout', group: 'grid', type: 'select', options: ['auto', 'manual', 'custom', 'random'], default: 'auto' },
    { key: 'targetSize', group: 'grid', type: 'number', min: 20, max: 400, step: 1, default: 100, unit: 'mm', showIf: sized },
    { key: 'maxPrint', group: 'grid', type: 'number', min: 80, max: 600, step: 1, default: 220, unit: 'mm', bed: true, showIf: sized },
    { key: 'mix', group: 'grid', type: 'number', min: 10, max: 90, step: 5, default: 50, unit: '%', showIf: (p) => p.layout === 'random' },
    { key: 'seed', group: 'grid', type: 'number', min: 1, max: 9999, step: 1, default: 1, dice: true, showIf: (p) => p.layout === 'random' },
    { key: 'colRatios', group: 'grid', type: 'text', default: '2, 1, 1', pattern: RATIOS, showIf: (p) => p.layout === 'custom' },
    { key: 'rowRatios', group: 'grid', type: 'text', default: '1, 1, 2', pattern: RATIOS, showIf: (p) => p.layout === 'custom' },
    { key: 'columns', group: 'grid', type: 'number', min: 1, max: 20, step: 1, default: 3, showIf: manual },
    { key: 'rows', group: 'grid', type: 'number', min: 1, max: 20, step: 1, default: 4, showIf: manual },
    { key: 'gap', group: 'grid', type: 'number', min: 0, max: 5, step: 0.1, default: 0.5, unit: 'mm' },

    { key: 'wall', group: 'box', type: 'number', min: 0.4, max: 10, sliderMax: 5, step: 0.1, default: 1.2, unit: 'mm' },
    { key: 'floor', group: 'box', type: 'number', min: 0.4, max: 10, sliderMax: 5, step: 0.1, default: 1.2, unit: 'mm' },
    { key: 'cornerRadius', group: 'box', type: 'number', min: 0, max: 30, step: 0.5, default: 4, unit: 'mm' },
    { key: 'dividersX', group: 'box', type: 'number', min: 0, max: 8, step: 1, default: 0 },
    { key: 'dividersY', group: 'box', type: 'number', min: 0, max: 8, step: 1, default: 0 },
    { key: 'dividerDrop', group: 'box', type: 'number', min: 0, max: 200, sliderMax: 40, step: 1, default: 0, unit: 'mm', showIf: (p) => (p.dividersX as number) + (p.dividersY as number) > 0 },

    { key: 'grip', group: 'extras', type: 'select', options: ['none', 'front', 'frontback', 'all'], default: 'none' },
    { key: 'gripWidth', group: 'extras', type: 'number', min: 8, max: 300, sliderMax: 100, step: 1, default: 30, unit: 'mm', showIf: (p) => p.grip !== 'none' },
    { key: 'gripDepth', group: 'extras', type: 'number', min: 3, max: 100, sliderMax: 40, step: 1, default: 10, unit: 'mm', showIf: (p) => p.grip !== 'none' },
    { key: 'drain', group: 'extras', type: 'select', options: ['none', 'holes', 'slots', 'hex', 'grid'], default: 'none' },
    { key: 'drainSize', group: 'extras', type: 'number', min: 1.5, max: 30, sliderMax: 15, step: 0.5, default: 4, unit: 'mm', showIf: (p) => p.drain !== 'none' },
    { key: 'drainGap', group: 'extras', type: 'number', min: 1, max: 60, sliderMax: 30, step: 0.5, default: 8, unit: 'mm', showIf: (p) => p.drain !== 'none' },
    { key: 'label', group: 'extras', type: 'bool', default: false },
    { key: 'labelDepth', group: 'extras', type: 'number', min: 5, max: 40, step: 1, default: 12, unit: 'mm', showIf: (p) => p.label === true },
  ],
};

const bin = (p: Params) => p.kind === 'bin';
const plate = (p: Params) => p.kind === 'baseplate';
const hollowBin = (p: Params) => bin(p) && p.fill === 'hollow';
const holder = (p: Params) => bin(p) && p.fill === 'holes';
const customHolder = (p: Params) => holder(p) && p.holePreset === 'custom';
const labelled = (p: Params) => hollowBin(p) && p.label !== 'none';
const inDrawer = (p: Params) => plate(p) && p.plateSize === 'drawer';
const withMagnets = (p: Params) => (bin(p) ? p.baseHoles === 'magnets' || p.baseHoles === 'both' : p.plateMagnets === true);

export const gridfinity: GeneratorMeta = {
  id: 'gridfinity',
  templates: GRIDFINITY_TEMPLATES,
  params: [
    { key: 'kind', group: 'kind', type: 'select', options: ['bin', 'baseplate'], default: 'bin' },
    { key: 'unitsX', group: 'kind', type: 'number', min: 1, max: 10, step: 1, default: 2, showIf: bin },
    { key: 'unitsY', group: 'kind', type: 'number', min: 1, max: 10, step: 1, default: 1, showIf: bin },
    { key: 'unitsZ', group: 'kind', type: 'number', min: 2, max: 30, sliderMax: 12, step: 1, default: 3, showIf: bin },
    { key: 'lip', group: 'kind', type: 'bool', default: true, showIf: bin },
    { key: 'plateSize', group: 'kind', type: 'select', options: ['units', 'drawer'], default: 'units', showIf: plate },
    { key: 'plateX', group: 'kind', type: 'number', min: 1, max: 30, sliderMax: 10, step: 1, default: 4, showIf: (p) => plate(p) && !inDrawer(p) },
    { key: 'plateY', group: 'kind', type: 'number', min: 1, max: 30, sliderMax: 10, step: 1, default: 4, showIf: (p) => plate(p) && !inDrawer(p) },
    { key: 'drawerWidth', group: 'kind', type: 'number', min: 42, max: 1200, sliderMax: 800, step: 1, default: 400, unit: 'mm', showIf: inDrawer },
    { key: 'drawerDepth', group: 'kind', type: 'number', min: 42, max: 1200, sliderMax: 800, step: 1, default: 450, unit: 'mm', showIf: inDrawer },
    { key: 'alignX', group: 'kind', type: 'select', options: ['center', 'left', 'right'], default: 'center', showIf: inDrawer },
    { key: 'alignY', group: 'kind', type: 'select', options: ['center', 'front', 'back'], default: 'center', showIf: inDrawer },
    { key: 'maxPrint', group: 'kind', type: 'number', min: 80, max: 600, step: 1, default: 220, unit: 'mm', bed: true, showIf: plate },

    { key: 'fill', group: 'inside', type: 'select', options: ['hollow', 'holes', 'solid'], default: 'hollow', showIf: bin },
    { key: 'wall', group: 'inside', type: 'number', min: 0.8, max: 2.6, step: 0.05, default: 1.2, unit: 'mm', showIf: hollowBin },
    { key: 'floor', group: 'inside', type: 'number', min: 0.6, max: 10, sliderMax: 5, step: 0.1, default: 1.2, unit: 'mm', showIf: hollowBin },
    { key: 'divX', group: 'inside', type: 'number', min: 0, max: 12, step: 1, default: 0, showIf: hollowBin },
    { key: 'divY', group: 'inside', type: 'number', min: 0, max: 12, step: 1, default: 0, showIf: hollowBin },
    { key: 'dividerDrop', group: 'inside', type: 'number', min: 0, max: 200, sliderMax: 40, step: 1, default: 0, unit: 'mm', showIf: (p) => hollowBin(p) && (p.divX as number) + (p.divY as number) > 0 },
    { key: 'scoop', group: 'inside', type: 'number', min: 0, max: 40, sliderMax: 25, step: 1, default: 0, unit: 'mm', showIf: hollowBin },
    { key: 'label', group: 'inside', type: 'select', options: ['none', 'full', 'left', 'center', 'right'], default: 'none', showIf: hollowBin },
    { key: 'labelWidth', group: 'inside', type: 'number', min: 8, max: 200, sliderMax: 80, step: 1, default: 30, unit: 'mm', showIf: (p) => labelled(p) && p.label !== 'full' },
    { key: 'labelDepth', group: 'inside', type: 'number', min: 5, max: 30, step: 1, default: 12, unit: 'mm', showIf: labelled },
    { key: 'holePreset', group: 'inside', type: 'select', options: ['bit', 'aaa', 'aa', 'c18650', 'pen', 'custom'], default: 'bit', showIf: holder },
    { key: 'holeShape', group: 'inside', type: 'select', options: ['round', 'hex', 'square'], default: 'round', showIf: customHolder },
    { key: 'holeSize', group: 'inside', type: 'number', min: 2, max: 100, sliderMax: 40, step: 0.1, default: 8, unit: 'mm', showIf: customHolder },
    { key: 'holeDepth', group: 'inside', type: 'number', min: 2, max: 200, sliderMax: 60, step: 0.5, default: 12, unit: 'mm', showIf: customHolder },
    { key: 'holeGap', group: 'inside', type: 'number', min: 0.8, max: 40, sliderMax: 15, step: 0.1, default: 2, unit: 'mm', showIf: customHolder },

    { key: 'baseHoles', group: 'base', type: 'select', options: ['none', 'magnets', 'screws', 'both'], default: 'none', showIf: bin },
    { key: 'baseHolesAt', group: 'base', type: 'select', options: ['corners', 'all'], default: 'corners', showIf: (p) => bin(p) && p.baseHoles !== 'none' },
    { key: 'plateFloor', group: 'base', type: 'number', min: 0, max: 15, sliderMax: 8, step: 0.2, default: 0, unit: 'mm', showIf: plate },
    { key: 'plateMagnets', group: 'base', type: 'bool', default: false, showIf: plate },
    { key: 'magnetDiameter', group: 'base', type: 'number', min: 3, max: 12, step: 0.05, default: 6.5, unit: 'mm', showIf: withMagnets },
    { key: 'magnetDepth', group: 'base', type: 'number', min: 1, max: 6, step: 0.1, default: 2.4, unit: 'mm', showIf: withMagnets },
    { key: 'plateScrews', group: 'base', type: 'select', options: ['none', 'corners', 'all'], default: 'none', showIf: plate },
    { key: 'plateScrewDiameter', group: 'base', type: 'number', min: 2.5, max: 6, step: 0.1, default: 4, unit: 'mm', showIf: (p) => plate(p) && p.plateScrews !== 'none' },
  ],
};

const isHook = is('type', 'hook');
const isBracket = is('type', 'bracket');
const onWall = (p: Params) => p.mount === 'screws' || p.mount === 'tape';

export const hook: GeneratorMeta = {
  id: 'hook',
  templates: HOOK_TEMPLATES,
  params: [
    { key: 'type', group: 'shape', type: 'select', options: ['hook', 'cradle', 'clip', 'clamp', 'bracket'], default: 'hook' },
    { key: 'width', group: 'shape', type: 'number', min: 4, max: 200, sliderMax: 60, step: 1, default: 20, unit: 'mm' },
    { key: 'thickness', group: 'shape', type: 'number', min: 2, max: 30, sliderMax: 12, step: 0.5, default: 5, unit: 'mm' },
    { key: 'reach', group: 'shape', type: 'number', min: 5, max: 400, sliderMax: 150, step: 1, default: 30, unit: 'mm', showIf: (p) => !is('type', 'cradle', 'clip', 'clamp')(p) },
    { key: 'diameter', group: 'shape', type: 'number', min: 5, max: 300, sliderMax: 100, step: 0.5, default: 30, unit: 'mm', showIf: is('type', 'cradle', 'clip', 'clamp') },
    { key: 'clipOpening', group: 'shape', type: 'number', min: 60, max: 170, step: 5, default: 110, unit: '°', showIf: is('type', 'clip') },
    { key: 'tipHeight', group: 'shape', type: 'number', min: 0, max: 150, sliderMax: 50, step: 1, default: 15, unit: 'mm', showIf: (p) => !is('type', 'clip', 'clamp')(p) },
    { key: 'angle', group: 'shape', type: 'number', min: 0, max: 45, step: 1, default: 10, unit: '°', showIf: isHook },
    { key: 'bend', group: 'shape', type: 'number', min: 1, max: 60, sliderMax: 25, step: 0.5, default: 5, unit: 'mm', showIf: (p) => isHook(p) && (p.tipHeight as number) > 0 },
    { key: 'rib', group: 'shape', type: 'number', min: 0, max: 30, sliderMax: 12, step: 0.5, default: 4, unit: 'mm', showIf: isBracket },
    { key: 'shelfHoles', group: 'shape', type: 'number', min: 0, max: 4, step: 1, default: 2, showIf: isBracket },
    { key: 'count', group: 'shape', type: 'number', min: 1, max: 10, step: 1, default: 1, showIf: (p) => !isBracket(p) && p.type !== 'clamp' && onWall(p) },
    { key: 'spacing', group: 'shape', type: 'number', min: 10, max: 300, sliderMax: 120, step: 1, default: 50, unit: 'mm', showIf: (p) => !isBracket(p) && p.type !== 'clamp' && onWall(p) && (p.count as number) > 1 },

    { key: 'mount', group: 'mount', type: 'select', options: ['screws', 'tape', 'door', 'pegboard'], default: 'screws' },
    { key: 'plateHeight', group: 'mount', type: 'number', min: 10, max: 400, sliderMax: 150, step: 1, default: 60, unit: 'mm' },
    { key: 'plateThickness', group: 'mount', type: 'number', min: 2, max: 20, sliderMax: 10, step: 0.5, default: 4, unit: 'mm' },
    { key: 'screwCount', group: 'mount', type: 'number', min: 1, max: 6, step: 1, default: 2, showIf: is('mount', 'screws') },
    { key: 'screwDiameter', group: 'mount', type: 'number', min: 2, max: 8, step: 0.1, default: 4.5, unit: 'mm', showIf: (p) => p.mount === 'screws' || p.type === 'clamp' || (isBracket(p) && (p.shelfHoles as number) > 0) },
    { key: 'countersunk', group: 'mount', type: 'bool', default: true, showIf: is('mount', 'screws') },
    { key: 'doorThickness', group: 'mount', type: 'number', min: 10, max: 80, step: 0.5, default: 40, unit: 'mm', showIf: is('mount', 'door') },
    { key: 'doorLip', group: 'mount', type: 'number', min: 5, max: 100, sliderMax: 60, step: 1, default: 25, unit: 'mm', showIf: is('mount', 'door') },
    { key: 'pegSpacing', group: 'mount', type: 'number', min: 10, max: 60, step: 0.1, default: 25.4, unit: 'mm', showIf: is('mount', 'pegboard') },
    { key: 'pegSize', group: 'mount', type: 'number', min: 2, max: 10, step: 0.1, default: 4.3, unit: 'mm', showIf: is('mount', 'pegboard') },
    { key: 'boardThickness', group: 'mount', type: 'number', min: 1, max: 20, step: 0.5, default: 5, unit: 'mm', showIf: is('mount', 'pegboard') },
  ],
};

const onPlateText = (p: Params) => p.style !== 'letters';

export const text: GeneratorMeta = {
  id: 'text',
  templates: TEXT_TEMPLATES,
  params: [
    { key: 'text', group: 'text', type: 'text', default: 'Genstrio', pattern: '^[\\s\\S]{1,160}$', lines: true, maxLength: 160 },
    { key: 'font', group: 'text', type: 'select', options: FONTS, default: 'inter' },
    { key: 'size', group: 'text', type: 'number', min: 3, max: 200, sliderMax: 60, step: 0.5, default: 12, unit: 'mm' },
    { key: 'lineSpacing', group: 'text', type: 'number', min: 1, max: 3, step: 0.05, default: 1.5 },
    { key: 'align', group: 'text', type: 'select', options: ['left', 'center', 'right'], default: 'center' },
    { key: 'style', group: 'text', type: 'select', options: ['raised', 'engraved', 'cutout', 'letters'], default: 'raised' },
    { key: 'textHeight', group: 'text', type: 'number', min: 0.2, max: 50, sliderMax: 10, step: 0.1, default: 1.2, unit: 'mm', showIf: (p) => p.style !== 'cutout' },
    { key: 'bar', group: 'text', type: 'bool', default: true, showIf: is('style', 'letters') },
    { key: 'separate', group: 'text', type: 'bool', default: false, showIf: is('style', 'raised', 'engraved') },
    { key: 'mirror', group: 'text', type: 'bool', default: false },

    { key: 'plateShape', group: 'plate', type: 'select', options: ['rect', 'pill', 'ellipse'], default: 'rect', showIf: onPlateText },
    { key: 'plateThickness', group: 'plate', type: 'number', min: 0.4, max: 30, sliderMax: 10, step: 0.1, default: 2.4, unit: 'mm', showIf: onPlateText },
    { key: 'padding', group: 'plate', type: 'number', min: 0, max: 60, sliderMax: 30, step: 0.5, default: 5, unit: 'mm', showIf: onPlateText },
    { key: 'cornerRadius', group: 'plate', type: 'number', min: 0, max: 60, sliderMax: 20, step: 0.5, default: 3, unit: 'mm', showIf: (p) => onPlateText(p) && p.plateShape === 'rect' },
    { key: 'border', group: 'plate', type: 'number', min: 0, max: 10, step: 0.1, default: 0, unit: 'mm', showIf: is('style', 'raised') },
    { key: 'plateWidth', group: 'plate', type: 'number', min: 0, max: 600, sliderMax: 300, step: 1, default: 0, unit: 'mm', showIf: onPlateText },
    { key: 'plateHeight', group: 'plate', type: 'number', min: 0, max: 600, sliderMax: 300, step: 1, default: 0, unit: 'mm', showIf: onPlateText },
    { key: 'hole', group: 'plate', type: 'select', options: ['none', 'left', 'top', 'both', 'corners'], default: 'none', showIf: onPlateText },
    { key: 'holeDiameter', group: 'plate', type: 'number', min: 1, max: 20, sliderMax: 10, step: 0.1, default: 4, unit: 'mm', showIf: (p) => onPlateText(p) && p.hole !== 'none' },
  ],
};

const isSpur = is('kind', 'spur');
const isRack = is('kind', 'rack');
const isPlanetary = is('kind', 'planetary');
const round = (p: Params) => p.kind !== 'rack';
const toothed = (p: Params) => p.kind !== 'pulley';
const isPulley = is('kind', 'pulley');
const twistable = is('kind', 'spur', 'ring', 'planetary');
const isWorm = is('kind', 'worm');
const shafted = is('kind', 'spur', 'planetary', 'bevel', 'worm', 'pulley');
const hubbed = is('kind', 'spur', 'planetary', 'worm', 'pulley');
const bored = (p: Params) => shafted(p) && p.bore !== 'none';

export const gear: GeneratorMeta = {
  id: 'gear',
  templates: GEAR_TEMPLATES,
  params: [
    { key: 'kind', group: 'teeth', type: 'select', options: ['spur', 'ring', 'planetary', 'bevel', 'worm', 'rack', 'pulley'], default: 'spur' },
    // The module is a size in mm by definition, whatever unit the lengths are shown in.
    { key: 'module', group: 'teeth', type: 'number', min: 0.3, max: 10, sliderMax: 5, step: 0.05, default: 1.5, showIf: toothed },
    { key: 'teeth', group: 'teeth', type: 'number', min: 6, max: 200, sliderMax: 80, step: 1, default: 20, showIf: round },
    { key: 'teeth2', group: 'teeth', type: 'number', min: 0, max: 200, sliderMax: 80, step: 1, default: 0, showIf: is('kind', 'spur', 'bevel') },
    { key: 'shaftAngle', group: 'teeth', type: 'number', min: 45, max: 135, step: 5, default: 90, unit: '°', showIf: is('kind', 'bevel') },
    { key: 'beltWidth', group: 'teeth', type: 'number', min: 3, max: 30, sliderMax: 15, step: 0.5, default: 6, unit: 'mm', showIf: isPulley },
    { key: 'flanges', group: 'teeth', type: 'select', options: ['none', 'bottom', 'both'], default: 'both', showIf: isPulley },
    { key: 'wormStarts', group: 'teeth', type: 'number', min: 1, max: 4, step: 1, default: 1, showIf: isWorm },
    { key: 'wormDiameter', group: 'teeth', type: 'number', min: 6, max: 100, sliderMax: 40, step: 0.5, default: 16, unit: 'mm', showIf: isWorm },
    { key: 'wormLength', group: 'teeth', type: 'number', min: 8, max: 250, sliderMax: 80, step: 1, default: 30, unit: 'mm', showIf: isWorm },
    { key: 'planetTeeth', group: 'teeth', type: 'number', min: 6, max: 100, sliderMax: 40, step: 1, default: 13, showIf: isPlanetary },
    { key: 'planets', group: 'teeth', type: 'number', min: 2, max: 8, step: 1, default: 3, showIf: isPlanetary },
    { key: 'rim', group: 'teeth', type: 'number', min: 1.5, max: 40, sliderMax: 15, step: 0.5, default: 4, unit: 'mm', showIf: is('kind', 'ring', 'planetary') },
    { key: 'rackTeeth', group: 'teeth', type: 'number', min: 2, max: 100, sliderMax: 40, step: 1, default: 12, showIf: isRack },
    { key: 'rackHeight', group: 'teeth', type: 'number', min: 1, max: 50, sliderMax: 20, step: 0.5, default: 6, unit: 'mm', showIf: isRack },
    { key: 'thickness', group: 'teeth', type: 'number', min: 1, max: 100, sliderMax: 30, step: 0.5, default: 8, unit: 'mm', showIf: toothed },
    { key: 'pressureAngle', group: 'teeth', type: 'select', options: ['14.5', '20', '25'], default: '20', showIf: toothed },
    { key: 'helix', group: 'teeth', type: 'number', min: 0, max: 45, step: 1, default: 0, unit: '°', showIf: twistable },
    { key: 'herringbone', group: 'teeth', type: 'bool', default: false, showIf: (p) => twistable(p) && (p.helix as number) > 0 },
    { key: 'backlash', group: 'teeth', type: 'number', min: 0, max: 1, step: 0.01, default: 0.1, unit: 'mm', showIf: toothed },

    { key: 'bore', group: 'bore', type: 'select', options: ['none', 'round', 'd', 'hex', 'square'], default: 'round', showIf: shafted },
    { key: 'boreDiameter', group: 'bore', type: 'number', min: 1, max: 100, sliderMax: 30, step: 0.05, default: 5, unit: 'mm', showIf: bored },
    { key: 'boreFlat', group: 'bore', type: 'number', min: 0.1, max: 10, sliderMax: 3, step: 0.05, default: 0.5, unit: 'mm', showIf: (p) => shafted(p) && p.bore === 'd' },
    { key: 'hubHeight', group: 'bore', type: 'number', min: 0, max: 50, sliderMax: 20, step: 0.5, default: 0, unit: 'mm', showIf: hubbed },
    { key: 'hubDiameter', group: 'bore', type: 'number', min: 3, max: 200, sliderMax: 60, step: 0.5, default: 12, unit: 'mm', showIf: (p) => hubbed(p) && (p.hubHeight as number) > 0 },
    { key: 'carrier', group: 'bore', type: 'bool', default: true, showIf: isPlanetary },
    { key: 'pinDiameter', group: 'bore', type: 'number', min: 2, max: 30, sliderMax: 12, step: 0.1, default: 5, unit: 'mm', showIf: (p) => isPlanetary(p) && p.carrier === true },
  ],
};

const labelled2 = (p: Params) => String(p.label).trim() !== '';

export const qr: GeneratorMeta = {
  id: 'qr',
  templates: QR_TEMPLATES,
  params: [
    { key: 'text', group: 'code', type: 'text', default: 'https://technikweber.github.io/Genstrio/', pattern: '^[\\s\\S]{1,300}$', lines: true, maxLength: 300 },
    { key: 'ecc', group: 'code', type: 'select', options: ['L', 'M', 'Q', 'H'], default: 'M' },
    { key: 'size', group: 'code', type: 'number', min: 10, max: 300, sliderMax: 120, step: 0.5, default: 45, unit: 'mm' },
    { key: 'quiet', group: 'code', type: 'number', min: 1, max: 8, step: 1, default: 4 },
    { key: 'style', group: 'code', type: 'select', options: ['raised', 'engraved'], default: 'raised' },
    { key: 'relief', group: 'code', type: 'number', min: 0.2, max: 5, sliderMax: 2, step: 0.1, default: 0.6, unit: 'mm' },
    { key: 'separate', group: 'code', type: 'bool', default: false },

    { key: 'plateThickness', group: 'plate', type: 'number', min: 0.6, max: 20, sliderMax: 6, step: 0.1, default: 1.6, unit: 'mm' },
    { key: 'cornerRadius', group: 'plate', type: 'number', min: 0, max: 60, sliderMax: 20, step: 0.5, default: 3, unit: 'mm' },
    { key: 'hole', group: 'plate', type: 'select', options: ['none', 'top', 'left'], default: 'none' },
    { key: 'holeDiameter', group: 'plate', type: 'number', min: 1, max: 20, sliderMax: 10, step: 0.1, default: 4, unit: 'mm', showIf: (p) => p.hole !== 'none' },

    { key: 'label', group: 'label', type: 'text', default: '', pattern: '^[\\s\\S]{0,60}$', lines: true, maxLength: 60 },
    { key: 'font', group: 'label', type: 'select', options: FONTS, default: 'inter', showIf: labelled2 },
    { key: 'labelSize', group: 'label', type: 'number', min: 2, max: 40, sliderMax: 15, step: 0.5, default: 5, unit: 'mm', showIf: labelled2 },
  ],
};

export const SHAPES = ['image', 'heart', 'star', 'flower', 'moon', 'circle'];
const ownImage = is('shape', 'image');

/** Where a shape comes from: a built-in one or a picture, and how the picture is read. */
const motif = (shape: string, size: number, smooth: number): FieldDef[] => [
  { key: 'shape', group: 'motif', type: 'select', options: SHAPES, default: shape },
  { key: 'image', group: 'motif', type: 'image', default: '', mode: 'mask', maxSize: 360, showIf: ownImage },
  { key: 'invert', group: 'motif', type: 'bool', default: false, showIf: ownImage },
  { key: 'threshold', group: 'motif', type: 'number', min: 5, max: 95, step: 1, default: 50, unit: '%', showIf: ownImage },
  { key: 'smooth', group: 'motif', type: 'number', min: 0, max: 6, step: 1, default: smooth, showIf: ownImage },
  { key: 'size', group: 'motif', type: 'number', min: 10, max: 400, sliderMax: 200, step: 1, default: size, unit: 'mm' },
];

const onReliefPlate = (p: Params) => p.style !== 'shape' && p.style !== 'heightmap';
const reliefBase = (p: Params) => p.style !== 'shape';

export const relief: GeneratorMeta = {
  id: 'relief',
  templates: RELIEF_TEMPLATES,
  params: [
    ...motif('star', 60, 1),
    { key: 'mirror', group: 'motif', type: 'bool', default: false },

    { key: 'style', group: 'relief', type: 'select', options: ['raised', 'engraved', 'cutout', 'shape', 'heightmap'], default: 'raised' },
    { key: 'relief', group: 'relief', type: 'number', min: 0.2, max: 50, sliderMax: 10, step: 0.1, default: 1.2, unit: 'mm', showIf: (p) => p.style !== 'cutout' },
    { key: 'separate', group: 'relief', type: 'bool', default: false, showIf: is('style', 'raised', 'engraved') },

    { key: 'plateShape', group: 'plate', type: 'select', options: ['rect', 'ellipse', 'contour'], default: 'rect', showIf: onReliefPlate },
    { key: 'plateThickness', group: 'plate', type: 'number', min: 0.4, max: 30, sliderMax: 10, step: 0.1, default: 2.4, unit: 'mm', showIf: reliefBase },
    { key: 'padding', group: 'plate', type: 'number', min: 0.5, max: 60, sliderMax: 30, step: 0.5, default: 5, unit: 'mm', showIf: onReliefPlate },
    { key: 'cornerRadius', group: 'plate', type: 'number', min: 0, max: 60, sliderMax: 20, step: 0.5, default: 3, unit: 'mm', showIf: (p) => onReliefPlate(p) && p.plateShape === 'rect' },
    { key: 'hole', group: 'plate', type: 'select', options: ['none', 'top', 'left', 'corners'], default: 'none', showIf: onReliefPlate },
    { key: 'holeDiameter', group: 'plate', type: 'number', min: 1, max: 20, sliderMax: 10, step: 0.1, default: 4, unit: 'mm', showIf: (p) => onReliefPlate(p) && p.hole !== 'none' },
  ],
};

const stamped = (p: Params) => ownImage(p) && p.stamp !== 'none';

export const cutter: GeneratorMeta = {
  id: 'cutter',
  templates: CUTTER_TEMPLATES,
  params: [
    ...motif('heart', 70, 2),
    { key: 'offset', group: 'motif', type: 'number', min: -5, max: 10, step: 0.1, default: 0, unit: 'mm' },

    { key: 'height', group: 'blade', type: 'number', min: 5, max: 60, sliderMax: 30, step: 0.5, default: 14, unit: 'mm' },
    { key: 'wall', group: 'blade', type: 'number', min: 0.4, max: 4, step: 0.05, default: 1.2, unit: 'mm' },
    { key: 'edge', group: 'blade', type: 'number', min: 0.3, max: 4, sliderMax: 2, step: 0.05, default: 0.5, unit: 'mm' },
    { key: 'edgeHeight', group: 'blade', type: 'number', min: 0.5, max: 20, sliderMax: 8, step: 0.5, default: 2, unit: 'mm', showIf: (p) => (p.edge as number) < (p.wall as number) },
    { key: 'flangeWidth', group: 'blade', type: 'number', min: 0, max: 20, sliderMax: 10, step: 0.5, default: 4, unit: 'mm' },
    { key: 'flangeThickness', group: 'blade', type: 'number', min: 0.6, max: 6, sliderMax: 4, step: 0.1, default: 1.6, unit: 'mm' },

    { key: 'stamp', group: 'stamp', type: 'select', options: ['none', 'lines', 'areas'], default: 'none', showIf: ownImage },
    { key: 'stampRelief', group: 'stamp', type: 'number', min: 0.5, max: 8, sliderMax: 5, step: 0.1, default: 2, unit: 'mm', showIf: stamped },
    { key: 'stampPlate', group: 'stamp', type: 'number', min: 1.2, max: 10, sliderMax: 6, step: 0.1, default: 3, unit: 'mm', showIf: stamped },
    { key: 'stampMargin', group: 'stamp', type: 'number', min: 0, max: 20, sliderMax: 8, step: 0.1, default: 1.5, unit: 'mm', showIf: stamped },
    { key: 'stampClearance', group: 'stamp', type: 'number', min: 0, max: 3, step: 0.05, default: 0.5, unit: 'mm', fit: true, showIf: stamped },
    { key: 'stampHandle', group: 'stamp', type: 'bool', default: true, showIf: stamped },
  ],
};

const bentLitho = is('form', 'arc');
const flatLitho = is('form', 'flat', 'arc');
const lit = (p: Params) => flatLitho(p) && p.stand === 'light';

const standing = (p: Params) => flatLitho(p) && p.stand !== 'none';
const strutted = (p: Params) => standing(p) && (p.struts as number) > 0;
const mounted = (p: Params) => p.form === 'cylinder' && p.mount !== 'none';

export const lithophane: GeneratorMeta = {
  id: 'lithophane',
  templates: LITHOPHANE_TEMPLATES,
  meshOnly: true,
  params: [
    { key: 'image', group: 'picture', type: 'image', default: '', mode: 'photo', maxSize: 320 },
    { key: 'negative', group: 'picture', type: 'bool', default: false },
    { key: 'rotate', group: 'picture', type: 'select', options: ['0', '90', '180', '270'], default: '0' },
    { key: 'mirror', group: 'picture', type: 'bool', default: false },
    { key: 'brightness', group: 'picture', type: 'number', min: -50, max: 50, step: 1, default: 0, unit: '%' },
    { key: 'contrast', group: 'picture', type: 'number', min: -50, max: 100, step: 1, default: 0, unit: '%' },
    { key: 'smoothing', group: 'picture', type: 'number', min: 0, max: 5, step: 1, default: 0 },

    { key: 'form', group: 'form', type: 'select', options: ['flat', 'arc', 'cylinder', 'sphere'], default: 'flat' },
    { key: 'width', group: 'form', type: 'number', min: 20, max: 400, sliderMax: 250, step: 1, default: 100, unit: 'mm', showIf: flatLitho },
    { key: 'angle', group: 'form', type: 'number', min: 20, max: 270, step: 5, default: 90, unit: '°', showIf: bentLitho },
    { key: 'diameter', group: 'form', type: 'number', min: 20, max: 300, sliderMax: 200, step: 1, default: 70, unit: 'mm', showIf: is('form', 'cylinder', 'sphere') },
    { key: 'sphereBottom', group: 'form', type: 'number', min: 10, max: 250, sliderMax: 120, step: 1, default: 45, unit: 'mm', showIf: is('form', 'sphere') },
    { key: 'sphereTop', group: 'form', type: 'number', min: 5, max: 250, sliderMax: 120, step: 1, default: 15, unit: 'mm', showIf: is('form', 'sphere') },
    { key: 'tilt', group: 'form', type: 'number', min: 0, max: 30, step: 1, default: 0, unit: '°', showIf: flatLitho },
    { key: 'reliefSide', group: 'form', type: 'select', options: ['outside', 'inside'], default: 'outside', showIf: is('form', 'arc', 'cylinder', 'sphere') },

    { key: 'minThickness', group: 'thickness', type: 'number', min: 0.3, max: 3, sliderMax: 2, step: 0.05, default: 0.6, unit: 'mm' },
    { key: 'maxThickness', group: 'thickness', type: 'number', min: 1, max: 8, sliderMax: 5, step: 0.1, default: 3, unit: 'mm' },
    { key: 'border', group: 'thickness', type: 'number', min: 0, max: 20, sliderMax: 10, step: 0.5, default: 2, unit: 'mm' },
    { key: 'foot', group: 'thickness', type: 'number', min: 0, max: 40, sliderMax: 20, step: 0.5, default: 0, unit: 'mm', showIf: is('form', 'flat', 'arc', 'cylinder') },

    { key: 'stand', group: 'holder', type: 'select', options: ['none', 'base', 'light'], default: 'none', showIf: flatLitho },
    { key: 'standPrint', group: 'holder', type: 'select', options: ['separate', 'joined'], default: 'separate', showIf: standing },
    { key: 'slotDepth', group: 'holder', type: 'number', min: 2, max: 20, sliderMax: 12, step: 0.5, default: 5, unit: 'mm', showIf: standing },
    { key: 'slotPlay', group: 'holder', type: 'number', min: 0, max: 1, step: 0.05, default: 0.3, unit: 'mm', fit: true, showIf: (p) => standing(p) && p.standPrint === 'separate' },
    { key: 'struts', group: 'holder', type: 'number', min: 0, max: 6, step: 1, default: 0, showIf: standing },
    { key: 'strutHeight', group: 'holder', type: 'number', min: 5, max: 200, sliderMax: 100, step: 1, default: 30, unit: 'mm', showIf: strutted },
    { key: 'strutDepth', group: 'holder', type: 'number', min: 5, max: 100, sliderMax: 60, step: 1, default: 18, unit: 'mm', showIf: strutted },
    { key: 'lightSeat', group: 'holder', type: 'select', options: ['lean', 'flat'], default: 'lean', showIf: lit },
    { key: 'lightDiameter', group: 'holder', type: 'number', min: 20, max: 150, sliderMax: 100, step: 0.5, default: 68, unit: 'mm', showIf: lit },
    { key: 'lightThickness', group: 'holder', type: 'number', min: 8, max: 80, sliderMax: 50, step: 0.5, default: 25, unit: 'mm', showIf: (p) => lit(p) && p.lightSeat === 'lean' },
    { key: 'lightTilt', group: 'holder', type: 'number', min: 0, max: 40, step: 1, default: 15, unit: '°', showIf: (p) => lit(p) && p.lightSeat === 'lean' },
    { key: 'lightDistance', group: 'holder', type: 'number', min: 15, max: 250, sliderMax: 120, step: 1, default: 45, unit: 'mm', showIf: lit },
    { key: 'mount', group: 'holder', type: 'select', options: ['none', 'e27', 'e14'], default: 'none', showIf: is('form', 'cylinder') },
    { key: 'mountVents', group: 'holder', type: 'bool', default: true, showIf: mounted },
    { key: 'mountCable', group: 'holder', type: 'bool', default: false, showIf: mounted },
  ],
};

const isHinge = is('type', 'hinge');
const isBolt = is('type', 'bolt');
const screwed = (p: Params) => (p.holes as number) > 0;

export const hinge: GeneratorMeta = {
  id: 'hinge',
  templates: HINGE_TEMPLATES,
  params: [
    { key: 'type', group: 'shape', type: 'select', options: ['hinge', 'bolt'], default: 'hinge' },
    { key: 'length', group: 'shape', type: 'number', min: 15, max: 300, sliderMax: 150, step: 1, default: 40, unit: 'mm' },
    { key: 'leafWidth', group: 'shape', type: 'number', min: 6, max: 150, sliderMax: 60, step: 1, default: 18, unit: 'mm', showIf: isHinge },
    { key: 'thickness', group: 'shape', type: 'number', min: 1.2, max: 15, sliderMax: 8, step: 0.1, default: 3, unit: 'mm', showIf: isHinge },
    { key: 'barrel', group: 'shape', type: 'number', min: 5, max: 30, sliderMax: 16, step: 0.5, default: 8, unit: 'mm', showIf: isHinge },
    { key: 'knuckles', group: 'shape', type: 'number', min: 2, max: 25, sliderMax: 11, step: 1, default: 5, showIf: isHinge },
    { key: 'boltWidth', group: 'shape', type: 'number', min: 8, max: 40, sliderMax: 25, step: 0.5, default: 12, unit: 'mm', showIf: isBolt },
    { key: 'boltHeight', group: 'shape', type: 'number', min: 3, max: 15, sliderMax: 10, step: 0.5, default: 5, unit: 'mm', showIf: isBolt },
    { key: 'throw', group: 'shape', type: 'number', min: 5, max: 80, sliderMax: 40, step: 1, default: 15, unit: 'mm', showIf: isBolt },
    { key: 'keeper', group: 'shape', type: 'bool', default: true, showIf: isBolt },
    { key: 'clearance', group: 'shape', type: 'number', min: 0.1, max: 1, step: 0.05, default: 0.35, unit: 'mm', fit: true },

    { key: 'holes', group: 'mount', type: 'number', min: 0, max: 6, step: 1, default: 2 },
    { key: 'holeDiameter', group: 'mount', type: 'number', min: 2, max: 8, step: 0.1, default: 3.5, unit: 'mm', showIf: screwed },
    { key: 'countersunk', group: 'mount', type: 'bool', default: true, showIf: screwed },
  ],
};

export const GENERATORS: Record<GeneratorId, GeneratorMeta> = { enclosure, adapter, organizer, gridfinity, hook, text, gear, qr, relief, cutter, lithophane, hinge };
export const GENERATOR_IDS = Object.keys(GENERATORS) as GeneratorId[];
