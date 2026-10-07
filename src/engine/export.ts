import { strToU8, zipSync } from 'fflate';
import type { Shape3D } from 'replicad';
import { weldedMesh } from '../generators/build/common';

export interface WeldedMesh {
  vertices: Float32Array;
  triangles: Uint32Array;
}

/** Tessellate a shape into an indexed mesh whose faces share vertices. */
export const meshPart = (shape: Shape3D, tolerance: number): WeldedMesh => weldedMesh(shape, tolerance);

/** Smooth normals for a mesh with shared vertices: the mean of the faces around each. */
export function vertexNormals({ vertices, triangles }: WeldedMesh): Float32Array {
  const normals = new Float32Array(vertices.length);
  for (let i = 0; i < triangles.length; i += 3) {
    const [a, b, c] = [3 * triangles[i], 3 * triangles[i + 1], 3 * triangles[i + 2]];
    const ux = vertices[b] - vertices[a];
    const uy = vertices[b + 1] - vertices[a + 1];
    const uz = vertices[b + 2] - vertices[a + 2];
    const vx = vertices[c] - vertices[a];
    const vy = vertices[c + 1] - vertices[a + 1];
    const vz = vertices[c + 2] - vertices[a + 2];
    const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    for (const corner of [a, b, c]) for (let k = 0; k < 3; k++) normals[corner + k] += n[k];
  }
  for (let i = 0; i < normals.length; i += 3) {
    const len = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
    for (let k = 0; k < 3; k++) normals[i + k] /= len;
  }
  return normals;
}

/** All meshes as one binary STL. */
export function writeStl(meshes: WeldedMesh[]): Uint8Array {
  const count = meshes.reduce((n, mesh) => n + mesh.triangles.length / 3, 0);
  const out = new Uint8Array(84 + 50 * count);
  out.set(strToU8('Genstrio'));
  const view = new DataView(out.buffer);
  view.setUint32(80, count, true);
  let at = 84;
  for (const { vertices, triangles } of meshes) {
    for (let i = 0; i < triangles.length; i += 3) {
      const [a, b, c] = [3 * triangles[i], 3 * triangles[i + 1], 3 * triangles[i + 2]];
      const ux = vertices[b] - vertices[a];
      const uy = vertices[b + 1] - vertices[a + 1];
      const uz = vertices[b + 2] - vertices[a + 2];
      const vx = vertices[c] - vertices[a];
      const vy = vertices[c + 1] - vertices[a + 1];
      const vz = vertices[c + 2] - vertices[a + 2];
      const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
      const len = Math.hypot(n[0], n[1], n[2]) || 1;
      for (let k = 0; k < 3; k++) view.setFloat32(at + 4 * k, n[k] / len, true);
      for (const [j, corner] of [a, b, c].entries()) for (let k = 0; k < 3; k++) view.setFloat32(at + 12 + 12 * j + 4 * k, vertices[corner + k], true);
      at += 50;
    }
  }
  return out;
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
