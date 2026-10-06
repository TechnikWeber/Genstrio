import type { GeneratorId, GeneratorMeta, Params } from './types';

const hasPcb = (p: Params) => p.pcb === true;
const hasPort = (p: Params) => p.port !== 'none';
const hasVents = (p: Params) => p.vents !== 'none';

export const enclosure: GeneratorMeta = {
  id: 'enclosure',
  params: [
    { key: 'length', group: 'outer', type: 'number', min: 20, max: 400, step: 1, default: 120, unit: 'mm' },
    { key: 'width', group: 'outer', type: 'number', min: 20, max: 400, step: 1, default: 80, unit: 'mm' },
    { key: 'height', group: 'outer', type: 'number', min: 10, max: 200, step: 1, default: 35, unit: 'mm' },
    { key: 'wall', group: 'outer', type: 'number', min: 0.8, max: 6, step: 0.1, default: 2, unit: 'mm' },
    { key: 'cornerRadius', group: 'outer', type: 'number', min: 0, max: 30, step: 0.5, default: 4, unit: 'mm' },

    { key: 'pcb', group: 'pcb', type: 'bool', default: true },
    { key: 'pcbLength', group: 'pcb', type: 'number', min: 10, max: 380, step: 0.5, default: 100, unit: 'mm', showIf: hasPcb },
    { key: 'pcbWidth', group: 'pcb', type: 'number', min: 10, max: 380, step: 0.5, default: 60, unit: 'mm', showIf: hasPcb },
    { key: 'holeInset', group: 'pcb', type: 'number', min: 1.5, max: 20, step: 0.1, default: 3.5, unit: 'mm', showIf: hasPcb },
    { key: 'standoffHeight', group: 'pcb', type: 'number', min: 1, max: 30, step: 0.5, default: 5, unit: 'mm', showIf: hasPcb },
    { key: 'pcbOffsetX', group: 'pcb', type: 'number', min: -150, max: 150, step: 0.5, default: 0, unit: 'mm', showIf: hasPcb },
    { key: 'pcbOffsetY', group: 'pcb', type: 'number', min: -150, max: 150, step: 0.5, default: 0, unit: 'mm', showIf: hasPcb },

    { key: 'screw', group: 'lid', type: 'select', options: ['M2', 'M2.5', 'M3', 'M4'], default: 'M3' },
    { key: 'lidScrews', group: 'lid', type: 'bool', default: true },
    { key: 'clearance', group: 'lid', type: 'number', min: 0, max: 1, step: 0.05, default: 0.2, unit: 'mm' },

    { key: 'port', group: 'port', type: 'select', options: ['none', 'usbc', 'microusb', 'round'], default: 'usbc' },
    { key: 'portSide', group: 'port', type: 'select', options: ['front', 'back', 'left', 'right'], default: 'front', showIf: hasPort },
    { key: 'portOffset', group: 'port', type: 'number', min: -190, max: 190, step: 0.5, default: 0, unit: 'mm', showIf: hasPort },
    { key: 'portHeight', group: 'port', type: 'number', min: 1, max: 190, step: 0.1, default: 8.2, unit: 'mm', showIf: hasPort },
    { key: 'portDiameter', group: 'port', type: 'number', min: 2, max: 40, step: 0.5, default: 8, unit: 'mm', showIf: (p) => p.port === 'round' },

    { key: 'vents', group: 'vents', type: 'select', options: ['none', 'lid', 'sides', 'both'], default: 'lid' },
    { key: 'ventWidth', group: 'vents', type: 'number', min: 1, max: 6, step: 0.1, default: 2, unit: 'mm', showIf: hasVents },
  ],
};

const bent = (p: Params) => (p.angle as number) > 0;

export const adapter: GeneratorMeta = {
  id: 'adapter',
  params: [
    { key: 'd1', group: 'end1', type: 'number', min: 3, max: 300, step: 0.1, default: 32, unit: 'mm' },
    { key: 'fit1', group: 'end1', type: 'select', options: ['inside', 'over'], default: 'over' },
    { key: 'len1', group: 'end1', type: 'number', min: 3, max: 200, step: 1, default: 25, unit: 'mm' },
    { key: 'barbs1', group: 'end1', type: 'bool', default: false, showIf: (p) => p.fit1 === 'inside' },

    { key: 'd2', group: 'end2', type: 'number', min: 3, max: 300, step: 0.1, default: 40, unit: 'mm' },
    { key: 'fit2', group: 'end2', type: 'select', options: ['inside', 'over'], default: 'inside' },
    { key: 'len2', group: 'end2', type: 'number', min: 3, max: 200, step: 1, default: 25, unit: 'mm' },
    { key: 'barbs2', group: 'end2', type: 'bool', default: true, showIf: (p) => p.fit2 === 'inside' },

    { key: 'wall', group: 'body', type: 'number', min: 0.8, max: 10, step: 0.1, default: 2, unit: 'mm' },
    { key: 'transition', group: 'body', type: 'number', min: 0, max: 200, step: 1, default: 10, unit: 'mm' },
    { key: 'clearance', group: 'body', type: 'number', min: 0, max: 2, step: 0.05, default: 0.3, unit: 'mm' },
    { key: 'angle', group: 'body', type: 'number', min: 0, max: 90, step: 1, default: 0, unit: '°' },
    { key: 'bendRadius', group: 'body', type: 'number', min: 5, max: 300, step: 1, default: 40, unit: 'mm', showIf: bent },
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

    { key: 'wall', group: 'box', type: 'number', min: 0.4, max: 5, step: 0.1, default: 1.2, unit: 'mm' },
    { key: 'floor', group: 'box', type: 'number', min: 0.4, max: 5, step: 0.1, default: 1.2, unit: 'mm' },
    { key: 'cornerRadius', group: 'box', type: 'number', min: 0, max: 30, step: 0.5, default: 4, unit: 'mm' },
    { key: 'dividersX', group: 'box', type: 'number', min: 0, max: 8, step: 1, default: 0 },
    { key: 'dividersY', group: 'box', type: 'number', min: 0, max: 8, step: 1, default: 0 },
  ],
};

export const GENERATORS: Record<GeneratorId, GeneratorMeta> = { enclosure, adapter, organizer };
export const GENERATOR_IDS = Object.keys(GENERATORS) as GeneratorId[];
