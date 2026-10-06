// Parameter metadata shared by the UI (main thread) and the geometry worker.
// Keep this file free of replicad imports so the UI bundle stays small.

export type Value = number | boolean | string | Params[];
export interface Params {
  [key: string]: Value;
}

interface ParamBase {
  key: string;
  group: string;
  showIf?: (p: Params) => boolean;
}

export interface NumberParam extends ParamBase {
  type: 'number';
  min: number;
  max: number;
  step: number;
  default: number;
  unit?: string;
  /** Upper end of the slider when `max` is far beyond everyday values. */
  sliderMax?: number;
  /** A value the user rolls instead of setting: a button for a new random one replaces the slider. */
  dice?: boolean;
}

export interface BoolParam extends ParamBase {
  type: 'bool';
  default: boolean;
}

export interface SelectParam extends ParamBase {
  type: 'select';
  options: string[];
  default: string;
}

/** Free text that must match `pattern`, e.g. a list of ratios. */
export interface TextParam extends ParamBase {
  type: 'text';
  default: string;
  pattern: string;
}

export type FieldDef = NumberParam | BoolParam | SelectParam | TextParam;

/** A list the user can add items to; inside `item`, `showIf` receives the item. */
export interface ListParam extends ParamBase {
  type: 'list';
  item: FieldDef[];
  max: number;
  default: Params[];
}

export type ParamDef = FieldDef | ListParam;

export type GeneratorId = 'enclosure' | 'adapter' | 'organizer';

export interface GeneratorMeta {
  id: GeneratorId;
  params: ParamDef[];
  /** Named starting points: overrides on top of the defaults. */
  templates?: Record<string, Params>;
}

/** The complete parameters of a template. */
export function fromTemplate(meta: GeneratorMeta, name: string): Params {
  return sanitize(meta, { ...defaults(meta), ...meta.templates?.[name] });
}

export interface Note {
  level: 'info' | 'warn';
  key: string;
  vars?: Record<string, string | number>;
}

const fieldDefaults = (defs: FieldDef[]): Params => Object.fromEntries(defs.map((d) => [d.key, d.default]));

export function defaults(meta: GeneratorMeta): Params {
  const out: Params = {};
  for (const d of meta.params) out[d.key] = d.type === 'list' ? d.default.map((item) => ({ ...fieldDefaults(d.item), ...item })) : d.default;
  return out;
}

export const newItem = (def: ListParam): Params => fieldDefaults(def.item);

function sanitizeField(d: FieldDef, v: unknown): Value {
  if (d.type === 'number') {
    const n = typeof v === 'number' ? v : parseFloat(String(v));
    return Number.isFinite(n) ? Math.min(d.max, Math.max(d.min, n)) : d.default;
  }
  if (d.type === 'bool') return typeof v === 'boolean' ? v : d.default;
  if (d.type === 'text') return typeof v === 'string' && v.length <= 80 && new RegExp(d.pattern).test(v) ? v : d.default;
  return typeof v === 'string' && d.options.includes(v) ? v : d.default;
}

/** Coerce arbitrary input (URL, localStorage, UI) into valid parameter values. */
export function sanitize(meta: GeneratorMeta, input: Record<string, unknown>): Params {
  const out: Params = {};
  for (const d of meta.params) {
    const v = input[d.key];
    if (d.type !== 'list') out[d.key] = sanitizeField(d, v);
    else if (!Array.isArray(v)) out[d.key] = defaults({ id: meta.id, params: [d] })[d.key];
    else {
      out[d.key] = v
        .filter((item) => item && typeof item === 'object')
        .slice(0, d.max)
        .map((item) => Object.fromEntries(d.item.map((f) => [f.key, sanitizeField(f, (item as Record<string, unknown>)[f.key])])));
    }
  }
  return out;
}
