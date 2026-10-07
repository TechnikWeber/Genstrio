/// <reference lib="webworker" />
import opencascade from 'replicad-opencascadejs';
import wasmUrl from 'replicad-opencascadejs/wasm?url';
import { exportSTEP, loadFont, makeCompound, setOC } from 'replicad';
import { BUILDERS, loadedFonts, ParamError, type BuildResult, type MeshPart, type Part } from '../generators/build';
import type { GeneratorId, Params } from '../generators/types';
import { meshPart, vertexNormals, write3mf, writeStl } from './export';
import type { ExportFormat, PartMesh, Request, Response } from './protocol';

const send = (msg: Response, transfer: Transferable[] = []) => self.postMessage(msg, transfer);

const ready = (opencascade as unknown as (o: object) => Promise<never>)({ locateFile: () => wasmUrl }).then((oc) => {
  setOC(oc);
  send({ type: 'ready' });
});

const fontUrls = import.meta.glob<string>('../fonts/*.woff', { query: '?url', import: 'default', eager: true });

/** Whatever sets text needs its font before it can build. */
async function prepare(generator: GeneratorId, params: Params) {
  let font = '';
  if (generator === 'text' || (generator === 'qr' && String(params.label).trim())) font = String(params.font);
  else if (generator === 'enclosure' && String(params.lidText).trim()) font = String(params.lidTextFont);
  const url = fontUrls[`../fonts/${font}.woff`];
  if (!url || loadedFonts.has(font)) return;
  await loadFont(new URL(url, import.meta.url).href, font);
  loadedFonts.add(font);
}

let latestBuild = 0;
let cache: { key: string; result: BuildResult } | null = null;

const keyOf = (generator: GeneratorId, params: Params) => generator + JSON.stringify(params);
const pause = () => new Promise((resolve) => setTimeout(resolve));

function meshParts(parts: Part[], ready: MeshPart[] = []): { meshes: PartMesh[]; transfer: Transferable[] } {
  // Parts that are meshes already go out as copies: the originals stay for the export.
  const copies = ready.map(({ name, mesh }): PartMesh => ({
    name,
    vertices: mesh.vertices.slice(),
    normals: vertexNormals(mesh),
    triangles: mesh.triangles.slice(),
    edges: new Float32Array(0),
    shade: mesh.shade?.slice(),
    instances: [[0, 0, 0]],
  }));
  const meshes = parts.map((part): PartMesh => {
    const mesh = part.shape.mesh({ tolerance: 0.1, angularTolerance: 0.3 });
    return {
      name: part.name,
      vertices: new Float32Array(mesh.vertices),
      normals: new Float32Array(mesh.normals),
      triangles: new Uint32Array(mesh.triangles),
      edges: new Float32Array(part.shape.meshEdges({ tolerance: 0.1, angularTolerance: 0.3 }).lines),
      instances: part.instances ?? [[0, 0, 0]],
      assembled: part.assembled,
    };
  });
  meshes.push(...copies);
  const transfer = meshes.flatMap((m) => [m.vertices.buffer, m.normals.buffer, m.triangles.buffer, m.edges.buffer, ...(m.shade ? [m.shade.buffer] : [])]);
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
      const { meshes, transfer } = meshParts(step.value.parts, step.value.meshes);
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

async function exportFile(id: number, generator: GeneratorId, params: Params, format: ExportFormat, only?: string) {
  const result = finish(generator, params);
  const named = <T extends { name: string }>(all: T[]) => (all.some((part) => part.name === only) ? all.filter((part) => part.name === only) : all);
  const parts = named(result.parts);
  const ready = named(result.meshes ?? []);
  const chosen = [...result.parts, ...(result.meshes ?? [])].some((part) => part.name === only);
  let data: ArrayBuffer;
  let mime: string;
  if (format === 'step') {
    // Triangles are not CAD geometry.
    if (!parts.length) throw new ParamError('err.noStep');
    data = await exportSTEP(parts.map((p) => ({ shape: p.shape, name: p.name }))).arrayBuffer();
    mime = 'model/step';
  } else if (format === 'stl' && !ready.length) {
    const solid = parts.length === 1 ? parts[0].shape : makeCompound(parts.map((p) => p.shape));
    data = await solid.blobSTL({ binary: true, tolerance: 0.02, angularTolerance: 0.2 }).arrayBuffer();
    mime = 'model/stl';
  } else {
    const meshes = [...parts.map((p) => ({ name: p.name, mesh: meshPart(p.shape, 0.02) })), ...ready];
    const file = format === 'stl' ? writeStl(meshes.map((m) => m.mesh)) : write3mf(meshes);
    data = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
    mime = format === 'stl' ? 'model/stl' : 'model/3mf';
  }
  send({ type: 'file', id, name: `genstrio-${generator}${chosen ? `-${only}` : ''}.${format}`, mime, data }, [data]);
}

self.onmessage = async (event: MessageEvent<Request>) => {
  const req = event.data;
  if (req.type === 'build') latestBuild = req.id;
  await ready;
  if (req.type === 'build' && req.id !== latestBuild) return;
  try {
    await prepare(req.generator, req.params);
    if (req.type === 'build' && req.id !== latestBuild) return;
    if (req.type === 'build') await build(req.id, req.generator, req.params);
    else await exportFile(req.id, req.generator, req.params, req.format, req.only);
  } catch (err) {
    const key = err instanceof ParamError ? err.key : undefined;
    send({ type: 'error', id: req.id, key, message: err instanceof Error ? err.message : String(err) });
  }
};
