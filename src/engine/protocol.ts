import type { GeneratorId, Note, Params } from '../generators/types';

export type ExportFormat = 'stl' | 'step' | '3mf';

export interface PartMesh {
  name: string;
  vertices: Float32Array;
  normals: Float32Array;
  triangles: Uint32Array;
  edges: Float32Array;
  /** Brightness (0–1) per vertex, for a part that carries a picture. */
  shade?: Float32Array;
  /** x, y, z and optionally a turn about Z in degrees. */
  instances: ([number, number, number] | [number, number, number, number])[];
  assembled?: { flip: boolean; offset: [number, number, number] };
}

export type Request =
  | { type: 'build'; id: number; generator: GeneratorId; params: Params }
  | { type: 'export'; id: number; generator: GeneratorId; params: Params; format: ExportFormat; only?: string };

export type Response =
  | { type: 'ready' }
  | { type: 'stage'; id: number; label: string; parts: PartMesh[] }
  | { type: 'done'; id: number; parts: PartMesh[]; notes: Note[]; frame?: [number, number]; ms: number }
  | { type: 'file'; id: number; name: string; mime: string; data: ArrayBuffer }
  | { type: 'error'; id: number; key?: string; message: string };
