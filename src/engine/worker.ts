/// <reference lib="webworker" />
import opencascade from 'replicad-opencascadejs';
import wasmUrl from 'replicad-opencascadejs/wasm?url';
import { exportSTEP, makeCompound, setOC } from 'replicad';
import { BUILDERS, ParamError, type BuildResult, type Part } from '../generators/build';
import type { GeneratorId, Params } from '../generators/types';
import { meshPart, write3mf } from './export';
import type { ExportFormat, PartMesh, Request, Response } from './protocol';

const send = (msg: Response, transfer: Transferable[] = []) => self.postMessage(msg, transfer);

const ready = (opencascade as unknown as (o: object) => Promise<never>)({ locateFile: () => wasmUrl }).then((oc) => {
  setOC(oc);
  send({ type: 'ready' });
});

let latestBuild = 0;
let cache: { key: string; result: BuildResult } | null = null;

const keyOf = (generator: GeneratorId, params: Params) => generator + JSON.stringify(params);
const pause = () => new Promise((resolve) => setTimeout(resolve));

function meshParts(parts: Part[]): { meshes: PartMesh[]; transfer: Transferable[] } {
  const meshes = parts.map((part): PartMesh => {
    const mesh = part.shape.mesh({ tolerance: 0.1, angularTolerance: 0.3 });
    return {
      name: part.name,
      vertices: new Float32Array(mesh.vertices),
      normals: new Float32Array(mesh.normals),
      triangles: new Uint32Array(mesh.triangles),
      edges: new Float32Array(part.shape.meshEdges({ tolerance: 0.1, angularTolerance: 0.3 }).lines),
      instances: part.instances ?? [[0, 0, 0]],
    };
  });
  const transfer = meshes.flatMap((m) => [m.vertices.buffer, m.normals.buffer, m.triangles.buffer, m.edges.buffer]);
  return { meshes, transfer };
}

/** Run a generator, posting every intermediate stage so the UI can show the model grow. */
async function build(id: number, generator: GeneratorId, params: Params) {
  const started = performance.now();
  const steps = BUILDERS[generator](params);
  for (;;) {
    const step = steps.next();
    if (step.done) {
      cache = { key: keyOf(generator, params), result: step.value };
      const { meshes, transfer } = meshParts(step.value.parts);
      const { notes, frame } = step.value;
      send({ type: 'done', id, parts: meshes, notes, frame, ms: Math.round(performance.now() - started) }, transfer);
      return;
    }
    const { meshes, transfer } = meshParts(step.value.parts);
    send({ type: 'stage', id, label: step.value.label, parts: meshes }, transfer);
    // Let queued messages in; a newer request makes this one obsolete.
    await pause();
    if (id !== latestBuild) return;
  }
}

function finish(generator: GeneratorId, params: Params): BuildResult {
  const key = keyOf(generator, params);
  if (cache?.key === key) return cache.result;
  const steps = BUILDERS[generator](params);
  for (;;) {
    const step = steps.next();
    if (step.done) {
      cache = { key, result: step.value };
      return step.value;
    }
  }
}

async function exportFile(id: number, generator: GeneratorId, params: Params, format: ExportFormat) {
  const { parts } = finish(generator, params);
  let data: ArrayBuffer;
  let mime: string;
  if (format === 'step') {
    data = await exportSTEP(parts.map((p) => ({ shape: p.shape, name: p.name }))).arrayBuffer();
    mime = 'model/step';
  } else if (format === 'stl') {
    const all = parts.length === 1 ? parts[0].shape : makeCompound(parts.map((p) => p.shape));
    data = await all.blobSTL({ binary: true, tolerance: 0.02, angularTolerance: 0.2 }).arrayBuffer();
    mime = 'model/stl';
  } else {
    const zip = write3mf(parts.map((p) => ({ name: p.name, mesh: meshPart(p.shape, 0.02) })));
    data = zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer;
    mime = 'model/3mf';
  }
  send({ type: 'file', id, name: `genstrio-${generator}.${format}`, mime, data }, [data]);
}

self.onmessage = async (event: MessageEvent<Request>) => {
  const req = event.data;
  if (req.type === 'build') latestBuild = req.id;
  await ready;
  if (req.type === 'build' && req.id !== latestBuild) return;
  try {
    if (req.type === 'build') await build(req.id, req.generator, req.params);
    else await exportFile(req.id, req.generator, req.params, req.format);
  } catch (err) {
    const key = err instanceof ParamError ? err.key : undefined;
    send({ type: 'error', id: req.id, key, message: err instanceof Error ? err.message : String(err) });
  }
};
