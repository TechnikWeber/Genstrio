import { strToU8, zipSync } from 'fflate';
import type { Shape3D } from 'replicad';

export interface WeldedMesh {
  vertices: Float32Array;
  triangles: Uint32Array;
}

/**
 * Tessellate a shape into an indexed mesh whose faces share vertices.
 * OpenCascade meshes every face on its own, so seams have duplicate vertices;
 * slicers read those as open edges unless they are merged.
 */
export function meshPart(shape: Shape3D, tolerance: number): WeldedMesh {
  const raw = shape.mesh({ tolerance, angularTolerance: 0.2 });
  const index = new Map<string, number>();
  const vertices: number[] = [];
  const remap = new Uint32Array(raw.vertices.length / 3);
  for (let i = 0; i < remap.length; i++) {
    const x = raw.vertices[3 * i];
    const y = raw.vertices[3 * i + 1];
    const z = raw.vertices[3 * i + 2];
    const key = `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
    let id = index.get(key);
    if (id === undefined) {
      id = vertices.length / 3;
      index.set(key, id);
      vertices.push(x, y, z);
    }
    remap[i] = id;
  }
  const triangles: number[] = [];
  for (let i = 0; i < raw.triangles.length; i += 3) {
    const a = remap[raw.triangles[i]];
    const b = remap[raw.triangles[i + 1]];
    const c = remap[raw.triangles[i + 2]];
    if (a !== b && b !== c && a !== c) triangles.push(a, b, c);
  }
  return { vertices: new Float32Array(vertices), triangles: new Uint32Array(triangles) };
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`;

const num = (n: number) => String(Math.round(n * 1e4) / 1e4);
const escapeXml = (s: string) => s.replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** One 3MF object per part, so slicers can arrange and configure them separately. */
export function write3mf(parts: { name: string; mesh: WeldedMesh }[]): Uint8Array {
  const out: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">',
    '<metadata name="Application">Genstrio</metadata>',
    '<resources>',
  ];
  parts.forEach(({ name, mesh }, i) => {
    out.push(`<object id="${i + 1}" type="model" name="${escapeXml(name)}"><mesh><vertices>`);
    const v = mesh.vertices;
    for (let k = 0; k < v.length; k += 3) out.push(`<vertex x="${num(v[k])}" y="${num(v[k + 1])}" z="${num(v[k + 2])}"/>`);
    out.push('</vertices><triangles>');
    const t = mesh.triangles;
    for (let k = 0; k < t.length; k += 3) out.push(`<triangle v1="${t[k]}" v2="${t[k + 1]}" v3="${t[k + 2]}"/>`);
    out.push('</triangles></mesh></object>');
  });
  out.push('</resources><build>');
  parts.forEach((_, i) => out.push(`<item objectid="${i + 1}"/>`));
  out.push('</build></model>');
  return zipSync({
    '[Content_Types].xml': strToU8(CONTENT_TYPES),
    '_rels/.rels': strToU8(RELS),
    '3D/3dmodel.model': strToU8(out.join('\n')),
  });
}
