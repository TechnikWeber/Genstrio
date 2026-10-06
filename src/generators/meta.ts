import type { FieldDef, GeneratorId, GeneratorMeta, Params } from './types';

const hasPcb = (p: Params) => p.pcb === true;
const isBox = (p: Params) => p.shape === 'box';
const lidScrewed = (p: Params) => p.lidFix === 'screws';
const lidSnaps = (p: Params) => p.lidFix === 'snap';
const onPlate = (o: Params) => o.face === 'lid' || o.face === 'floor';
const is = (key: string, ...values: string[]) => (p: Params) => values.includes(p[key] as string);

export const SCREW_SIZES = ['M2', 'M2.5', 'M3', 'M4', 'M5'];
export const VENT_PATTERNS = ['none', 'slots', 'holes', 'hex', 'triangles', 'grid'];

const opening: FieldDef[] = [
  { key: 'type', group: 'openings', type: 'select', options: ['round', 'gland', 'usbc', 'microusb', 'usba', 'hdmi', 'rj45', 'rect', 'speaker', 'fan'], default: 'round' },
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
  { key: 'speakerStyle', group: 'openings', type: 'select', options: ['grille', 'open'], default: 'grille', showIf: is('type', 'speaker') },
  { key: 'ring', group: 'openings', type: 'bool', default: true, showIf: (o) => o.type === 'speaker' && onPlate(o) },
  { key: 'fan', group: 'openings', type: 'select', options: ['25', '30', '40', '50', '60', '80'], default: '40', showIf: is('type', 'fan') },
  { key: 'offset', group: 'openings', type: 'number', min: -250, max: 250, sliderMax: 100, step: 0.5, default: 0, unit: 'mm' },
  { key: 'height', group: 'openings', type: 'number', min: 0, max: 300, sliderMax: 60, step: 0.1, default: 10, unit: 'mm', showIf: (o) => !onPlate(o) },
  { key: 'offsetY', group: 'openings', type: 'number', min: -250, max: 250, sliderMax: 100, step: 0.5, default: 0, unit: 'mm', showIf: onPlate },
];

const vent = (target: 'lid' | 'body', extra: FieldDef[] = []): FieldDef[] => {
  const k = `${target}Vent`;
  const on = (p: Params) => p[k] !== 'none';
  return [
    { key: k, group: k, type: 'select', options: VENT_PATTERNS, default: target === 'lid' ? 'slots' : 'none' },
    ...extra.map((d) => ({ ...d, group: k, showIf: on })),
    { key: `${k}Size`, group: k, type: 'number', min: 1, max: 30, sliderMax: 12, step: 0.1, default: 2, unit: 'mm', showIf: on },
    { key: `${k}Gap`, group: k, type: 'number', min: 0.8, max: 30, sliderMax: 12, step: 0.1, default: 2.4, unit: 'mm', showIf: on },
    { key: `${k}Length`, group: k, type: 'number', min: 2, max: 300, sliderMax: 100, step: 1, default: target === 'lid' ? 40 : 15, unit: 'mm', showIf: (p) => p[k] === 'slots' },
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
    { key: 'pcbLength', group: 'pcb', type: 'number', min: 10, max: 480, sliderMax: 280, step: 0.5, default: 100, unit: 'mm', showIf: hasPcb },
    { key: 'pcbWidth', group: 'pcb', type: 'number', min: 10, max: 480, sliderMax: 280, step: 0.5, default: 60, unit: 'mm', showIf: hasPcb },
    { key: 'holeInset', group: 'pcb', type: 'number', min: 1.5, max: 50, sliderMax: 20, step: 0.1, default: 3.5, unit: 'mm', showIf: hasPcb },
    { key: 'standoffHeight', group: 'pcb', type: 'number', min: 1, max: 60, sliderMax: 30, step: 0.5, default: 5, unit: 'mm', showIf: hasPcb },
    { key: 'pcbOffsetX', group: 'pcb', type: 'number', min: -200, max: 200, sliderMax: 100, step: 0.5, default: 0, unit: 'mm', showIf: hasPcb },
    { key: 'pcbOffsetY', group: 'pcb', type: 'number', min: -200, max: 200, sliderMax: 100, step: 0.5, default: 0, unit: 'mm', showIf: hasPcb },
    { key: 'pcbScrew', group: 'pcb', type: 'select', options: SCREW_SIZES, default: 'M3', showIf: hasPcb },
    { key: 'pcbHole', group: 'pcb', type: 'select', options: ['selftap', 'insert'], default: 'selftap', showIf: hasPcb },

    { key: 'lidFix', group: 'lid', type: 'select', options: ['screws', 'snap', 'none'], default: 'screws' },
    { key: 'lidScrew', group: 'lid', type: 'select', options: SCREW_SIZES, default: 'M3', showIf: lidScrewed },
    { key: 'lidHole', group: 'lid', type: 'select', options: ['selftap', 'insert'], default: 'selftap', showIf: lidScrewed },
    { key: 'lidHead', group: 'lid', type: 'select', options: ['flat', 'countersunk', 'counterbore'], default: 'flat', showIf: lidScrewed },
    { key: 'snapCount', group: 'lid', type: 'number', min: 1, max: 4, step: 1, default: 1, showIf: lidSnaps },
    { key: 'snapWidth', group: 'lid', type: 'number', min: 3, max: 60, sliderMax: 30, step: 0.5, default: 10, unit: 'mm', showIf: lidSnaps },
    { key: 'snapHeight', group: 'lid', type: 'number', min: 0.2, max: 2, step: 0.05, default: 0.6, unit: 'mm', showIf: lidSnaps },
    { key: 'lidThickness', group: 'lid', type: 'number', min: 0.8, max: 10, sliderMax: 6, step: 0.1, default: 2, unit: 'mm' },
    { key: 'clearance', group: 'lid', type: 'number', min: 0, max: 1, step: 0.05, default: 0.2, unit: 'mm' },

    {
      key: 'openings', group: 'openings', type: 'list', item: opening, max: 16,
      default: [{ type: 'usbc', face: 'front', height: 8.2 }],
    },

    ...vent('lid'),
    ...vent('body', [{ key: 'bodyVentWalls', group: '', type: 'select', options: ['sides', 'frontback', 'all', 'floor'], default: 'sides' }]),

    { key: 'ears', group: 'mount', type: 'select', options: ['none', 'two', 'four'], default: 'none' },
    { key: 'earHole', group: 'mount', type: 'number', min: 2, max: 10, step: 0.1, default: 4.5, unit: 'mm', showIf: (p) => p.ears !== 'none' },
  ],
};

const bent = (p: Params) => (p.angle as number) > 0;

export const adapter: GeneratorMeta = {
  id: 'adapter',
  params: [
    { key: 'd1', group: 'end1', type: 'number', min: 1, max: 1000, sliderMax: 200, step: 0.1, default: 32, unit: 'mm' },
    { key: 'fit1', group: 'end1', type: 'select', options: ['inside', 'over'], default: 'over' },
    { key: 'len1', group: 'end1', type: 'number', min: 1, max: 500, sliderMax: 100, step: 1, default: 25, unit: 'mm' },
    { key: 'barbs1', group: 'end1', type: 'bool', default: false, showIf: (p) => p.fit1 === 'inside' },

    { key: 'd2', group: 'end2', type: 'number', min: 1, max: 1000, sliderMax: 200, step: 0.1, default: 40, unit: 'mm' },
    { key: 'fit2', group: 'end2', type: 'select', options: ['inside', 'over'], default: 'inside' },
    { key: 'len2', group: 'end2', type: 'number', min: 1, max: 500, sliderMax: 100, step: 1, default: 25, unit: 'mm' },
    { key: 'barbs2', group: 'end2', type: 'bool', default: true, showIf: (p) => p.fit2 === 'inside' },

    { key: 'wall', group: 'body', type: 'number', min: 0.4, max: 50, sliderMax: 10, step: 0.1, default: 2, unit: 'mm' },
    { key: 'transition', group: 'body', type: 'number', min: 0, max: 500, sliderMax: 100, step: 1, default: 10, unit: 'mm' },
    { key: 'clearance', group: 'body', type: 'number', min: -1, max: 5, sliderMax: 1, step: 0.05, default: 0.3, unit: 'mm' },
    { key: 'chamfer', group: 'body', type: 'number', min: 0, max: 5, sliderMax: 2, step: 0.1, default: 0.6, unit: 'mm' },
    { key: 'angle', group: 'body', type: 'number', min: 0, max: 180, step: 1, default: 0, unit: '°' },
    { key: 'bendRadius', group: 'body', type: 'number', min: 1, max: 1000, sliderMax: 200, step: 1, default: 40, unit: 'mm', showIf: bent },
  ],
};

const manual = (p: Params) => p.layout === 'manual';

export const organizer: GeneratorMeta = {
  id: 'organizer',
  params: [
    { key: 'drawerWidth', group: 'drawer', type: 'number', min: 30, max: 1200, step: 1, default: 287, unit: 'mm' },
    { key: 'drawerDepth', group: 'drawer', type: 'number', min: 30, max: 1200, step: 1, default: 410, unit: 'mm' },
    { key: 'height', group: 'drawer', type: 'number', min: 5, max: 250, step: 1, default: 40, unit: 'mm' },

    { key: 'layout', group: 'grid', type: 'select', options: ['auto', 'manual'], default: 'auto' },
    { key: 'targetSize', group: 'grid', type: 'number', min: 20, max: 400, step: 1, default: 100, unit: 'mm', showIf: (p) => !manual(p) },
    { key: 'maxPrint', group: 'grid', type: 'number', min: 80, max: 600, step: 1, default: 220, unit: 'mm', showIf: (p) => !manual(p) },
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

export const GENERATORS: Record<GeneratorId, GeneratorMeta> = { enclosure, adapter, organizer };
export const GENERATOR_IDS = Object.keys(GENERATORS) as GeneratorId[];
