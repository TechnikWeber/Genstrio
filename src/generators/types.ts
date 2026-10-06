// Parameter metadata shared by the UI (main thread) and the geometry worker.
// Keep this file free of replicad imports so the UI bundle stays small.

export type Value = number | boolean | string;
export type Params = Record<string, Value>;

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

export type ParamDef = NumberParam | BoolParam | SelectParam;

export type GeneratorId = 'enclosure' | 'adapter' | 'organizer';

export interface GeneratorMeta {
  id: GeneratorId;
  params: ParamDef[];
}

export interface Note {
  level: 'info' | 'warn';
  key: string;
  vars?: Record<string, string | number>;
}

export function defaults(meta: GeneratorMeta): Params {
  const out: Params = {};
  for (const d of meta.params) out[d.key] = d.default;
  return out;
}

/** Coerce arbitrary input (URL, localStorage, UI) into valid parameter values. */
export function sanitize(meta: GeneratorMeta, input: Record<string, unknown>): Params {
  const out: Params = {};
  for (const d of meta.params) {
    const v = input[d.key];
    if (d.type === 'number') {
      const n = typeof v === 'number' ? v : parseFloat(String(v));
      out[d.key] = Number.isFinite(n) ? Math.min(d.max, Math.max(d.min, n)) : d.default;
    } else if (d.type === 'bool') {
      out[d.key] = typeof v === 'boolean' ? v : d.default;
    } else {
      out[d.key] = typeof v === 'string' && d.options.includes(v) ? v : d.default;
    }
  }
  return out;
}
