import { BOARDS } from './boards';
import { FITTINGS } from './fittings';
import { FONTS } from './fonts';
import { ADAPTER_TEMPLATES, ENCLOSURE_TEMPLATES, GRIDFINITY_TEMPLATES, HOOK_TEMPLATES, ORGANIZER_TEMPLATES, TEXT_TEMPLATES } from './templates';
import type { FieldDef, GeneratorId, GeneratorMeta, Params } from './types';

const hasPcb = (p: Params) => p.pcb === true;
const customPcb = (p: Params) => hasPcb(p) && p.pcbBoard === 'custom';
const hasLid = (p: Params) => p.lid === true;
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
  { key: 'type', group: 'openings', type: 'select', options: ['round', 'gland', 'rect', 'usbc', 'microusb', 'usba', 'usba2', 'usbb', 'hdmi', 'minihdmi', 'microhdmi', 'rj45', 'barrel', 'sd', 'speaker', 'fan'], default: 'round' },
  { key: 'face', group: 'openings', type: 'select', options: ['front', 'back', 'left', 'right', 'lid', 'floor'], default: 'front' },
  {
    key: 'preset', group: 'openings', type: 'select', default: 'custom', showIf: is('type', 'round'),
    options: ['custom', 'sma', 'bnc', 'led3', 'led5', 'audio35', 'toggle', 'pot', 'dcjack', 'button12', 'button16', 'button19', 'button22'],
  },
  { key: 'diameter', group: 'openings', type: 'number', min: 1, max: 200, sliderMax: 40, step: 0.1, default: 8, unit: 'mm', showIf: (o) => o.type === 'round' && o.preset === 'custom' },
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

    { key: 'lid', group: 'lid', type: 'bool', default: true },
    { key: 'lidFix', group: 'lid', type: 'select', options: ['screws', 'snap', 'twist', 'none'], default: 'screws', showIf: hasLid },
    { key: 'lidScrew', group: 'lid', type: 'select', options: SCREW_SIZES, default: 'M3', showIf: lidScrewed },
    { key: 'lidHole', group: 'lid', type: 'select', options: ['selftap', 'insert'], default: 'selftap', showIf: lidScrewed },
    { key: 'lidHead', group: 'lid', type: 'select', options: ['flat', 'countersunk', 'counterbore'], default: 'flat', showIf: lidScrewed },
    { key: 'snapCount', group: 'lid', type: 'number', min: 1, max: 4, step: 1, default: 1, showIf: lidSnaps },
    { key: 'snapWidth', group: 'lid', type: 'number', min: 3, max: 60, sliderMax: 30, step: 0.5, default: 10, unit: 'mm', showIf: lidSnaps },
    { key: 'snapHeight', group: 'lid', type: 'number', min: 0.2, max: 2, step: 0.05, default: 0.6, unit: 'mm', showIf: lidSnaps },
    { key: 'lidThickness', group: 'lid', type: 'number', min: 0.8, max: 10, sliderMax: 6, step: 0.1, default: 2, unit: 'mm', showIf: hasLid },
    { key: 'clearance', group: 'lid', type: 'number', min: 0, max: 1, step: 0.05, default: 0.2, unit: 'mm', showIf: hasLid },
    { key: 'hinge', group: 'lid', type: 'bool', default: false, showIf: hasLid },
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

const STANDARDS = ['custom', ...Object.keys(FITTINGS)];

/** The parameters of one adapter end. */
const end = (n: 1 | 2, d: number, fit: string, barbs: boolean): FieldDef[] => {
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

    { key: 'wall', group: 'body', type: 'number', min: 0.4, max: 50, sliderMax: 10, step: 0.1, default: 2, unit: 'mm' },
    { key: 'transition', group: 'body', type: 'number', min: 0, max: 500, sliderMax: 100, step: 1, default: 10, unit: 'mm' },
    { key: 'clearance', group: 'body', type: 'number', min: -1, max: 5, sliderMax: 1, step: 0.05, default: 0.3, unit: 'mm' },
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
    { key: 'maxPrint', group: 'grid', type: 'number', min: 80, max: 600, step: 1, default: 220, unit: 'mm', showIf: sized },
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
    { key: 'maxPrint', group: 'kind', type: 'number', min: 80, max: 600, step: 1, default: 220, unit: 'mm', showIf: plate },

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
    { key: 'type', group: 'shape', type: 'select', options: ['hook', 'cradle', 'bracket'], default: 'hook' },
    { key: 'width', group: 'shape', type: 'number', min: 4, max: 200, sliderMax: 60, step: 1, default: 20, unit: 'mm' },
    { key: 'thickness', group: 'shape', type: 'number', min: 2, max: 30, sliderMax: 12, step: 0.5, default: 5, unit: 'mm' },
    { key: 'reach', group: 'shape', type: 'number', min: 5, max: 400, sliderMax: 150, step: 1, default: 30, unit: 'mm', showIf: (p) => !is('type', 'cradle')(p) },
    { key: 'diameter', group: 'shape', type: 'number', min: 5, max: 300, sliderMax: 100, step: 0.5, default: 30, unit: 'mm', showIf: is('type', 'cradle') },
    { key: 'tipHeight', group: 'shape', type: 'number', min: 0, max: 150, sliderMax: 50, step: 1, default: 15, unit: 'mm' },
    { key: 'angle', group: 'shape', type: 'number', min: 0, max: 45, step: 1, default: 10, unit: '°', showIf: isHook },
    { key: 'bend', group: 'shape', type: 'number', min: 1, max: 60, sliderMax: 25, step: 0.5, default: 5, unit: 'mm', showIf: (p) => isHook(p) && (p.tipHeight as number) > 0 },
    { key: 'rib', group: 'shape', type: 'number', min: 0, max: 30, sliderMax: 12, step: 0.5, default: 4, unit: 'mm', showIf: isBracket },
    { key: 'shelfHoles', group: 'shape', type: 'number', min: 0, max: 4, step: 1, default: 2, showIf: isBracket },
    { key: 'count', group: 'shape', type: 'number', min: 1, max: 10, step: 1, default: 1, showIf: (p) => !isBracket(p) && onWall(p) },
    { key: 'spacing', group: 'shape', type: 'number', min: 10, max: 300, sliderMax: 120, step: 1, default: 50, unit: 'mm', showIf: (p) => !isBracket(p) && onWall(p) && (p.count as number) > 1 },

    { key: 'mount', group: 'mount', type: 'select', options: ['screws', 'tape', 'door', 'pegboard'], default: 'screws' },
    { key: 'plateHeight', group: 'mount', type: 'number', min: 10, max: 400, sliderMax: 150, step: 1, default: 60, unit: 'mm' },
    { key: 'plateThickness', group: 'mount', type: 'number', min: 2, max: 20, sliderMax: 10, step: 0.5, default: 4, unit: 'mm' },
    { key: 'screwCount', group: 'mount', type: 'number', min: 1, max: 6, step: 1, default: 2, showIf: is('mount', 'screws') },
    { key: 'screwDiameter', group: 'mount', type: 'number', min: 2, max: 8, step: 0.1, default: 4.5, unit: 'mm', showIf: (p) => p.mount === 'screws' || (isBracket(p) && (p.shelfHoles as number) > 0) },
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

export const GENERATORS: Record<GeneratorId, GeneratorMeta> = { enclosure, adapter, organizer, gridfinity, hook, text };
export const GENERATOR_IDS = Object.keys(GENERATORS) as GeneratorId[];
