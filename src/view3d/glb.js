// A small reader for binary glTF (.glb) files: meshes with positions, normals, texture coordinates or
// vertex colours and indices, placed by their node transforms. No Three.js in here, so the asset tool
// (tools/kit/) and the tests use it in Node, and the 3D view uses it to load the built models.

const COMPONENT = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

export function parseGlb(buffer) {
  const dv = new DataView(buffer);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('Not a .glb file');
  let at = 12;
  let json = null;
  let bin = null;
  while (at < dv.byteLength) {
    const len = dv.getUint32(at, true);
    const type = dv.getUint32(at + 4, true);
    const start = at + 8;
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, start, len)));
    else if (type === 0x004e4942) bin = buffer.slice(start, start + len);
    at = start + len;
  }
  const read = (i) => {
    const acc = json.accessors[i];
    const view = json.bufferViews[acc.bufferView];
    const T = COMPONENT[acc.componentType];
    const n = acc.count * SIZE[acc.type];
    const off = (view.byteOffset || 0) + (acc.byteOffset || 0);
    const stride = view.byteStride || 0;
    const per = SIZE[acc.type];
    if (!stride || stride === per * T.BYTES_PER_ELEMENT) {
      const raw = new T(bin.slice(off, off + n * T.BYTES_PER_ELEMENT));
      return acc.normalized && T !== Float32Array ? Float32Array.from(raw, (v) => v / (T === Uint8Array ? 255 : 65535)) : raw;
    }
    const out = new Float32Array(n);
    const d = new DataView(bin);
    for (let k = 0; k < acc.count; k++) for (let c = 0; c < per; c++) out[k * per + c] = d.getFloat32(off + k * stride + c * 4, true);
    return out;
  };
  const prims = [];
  const visit = (ni, parent) => {
    const node = json.nodes[ni];
    const m = mul(parent, local(node));
    if (node.mesh != null) {
      for (const p of json.meshes[node.mesh].primitives) {
        const a = p.attributes;
        prims.push({
          matrix: m,
          material: p.material != null ? json.materials?.[p.material]?.name : null,
          position: read(a.POSITION),
          normal: a.NORMAL != null ? read(a.NORMAL) : null,
          uv: a.TEXCOORD_0 != null ? read(a.TEXCOORD_0) : null,
          color: a.COLOR_0 != null ? read(a.COLOR_0) : null,
          colorSize: a.COLOR_0 != null ? SIZE[json.accessors[a.COLOR_0].type] : 0,
          index: p.indices != null ? read(p.indices) : null,
        });
      }
    }
    for (const c of node.children || []) visit(c, m);
  };
  const scene = json.scenes?.[json.scene ?? 0];
  for (const n of scene ? scene.nodes : json.nodes.map((_, i) => i)) visit(n, IDENTITY);
  return prims;
}

// Flatten primitives into world-space triangles: { position, normal, uv, color } arrays, non-indexed.
export function flatten(prims) {
  const pos = [];
  const nor = [];
  const uv = [];
  const col = [];
  for (const p of prims) {
    const idx = p.index || Array.from({ length: p.position.length / 3 }, (_, i) => i);
    const nm = normalMatrix(p.matrix);
    for (const i of idx) {
      const [x, y, z] = apply(p.matrix, p.position[i * 3], p.position[i * 3 + 1], p.position[i * 3 + 2], 1);
      pos.push(x, y, z);
      if (p.normal) {
        const n = apply(nm, p.normal[i * 3], p.normal[i * 3 + 1], p.normal[i * 3 + 2], 0);
        const l = Math.hypot(...n) || 1;
        nor.push(n[0] / l, n[1] / l, n[2] / l);
      } else nor.push(0, 1, 0);
      uv.push(p.uv ? p.uv[i * 2] : 0, p.uv ? p.uv[i * 2 + 1] : 0);
      if (p.color) col.push(p.color[i * p.colorSize], p.color[i * p.colorSize + 1], p.color[i * p.colorSize + 2]);
      else col.push(1, 1, 1);
    }
  }
  return { position: new Float32Array(pos), normal: new Float32Array(nor), uv: new Float32Array(uv), color: new Float32Array(col) };
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

// Column-major 4×4 (as glTF stores them).
function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}

function local(node) {
  if (node.matrix) return node.matrix;
  const [tx, ty, tz] = node.translation || [0, 0, 0];
  const [qx, qy, qz, qw] = node.rotation || [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale || [1, 1, 1];
  const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
  const xx = qx * x2, xy = qx * y2, xz = qx * z2, yy = qy * y2, yz = qy * z2, zz = qz * z2, wx = qw * x2, wy = qw * y2, wz = qw * z2;
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

export function apply(m, x, y, z, w) {
  return [m[0] * x + m[4] * y + m[8] * z + m[12] * w, m[1] * x + m[5] * y + m[9] * z + m[13] * w, m[2] * x + m[6] * y + m[10] * z + m[14] * w];
}

// Good enough for rotations and uniform scales (all the kits use).
function normalMatrix(m) {
  return [m[0], m[1], m[2], 0, m[4], m[5], m[6], 0, m[8], m[9], m[10], 0, 0, 0, 0, 1];
}

// Write triangles { position, normal, color } (Float32Arrays, non-indexed) as a .glb, with a shared
// vertex for each repeated (position, normal, colour) so the file stays small.
export function writeGlb({ position, normal, color }) {
  const map = new Map();
  const P = [];
  const N = [];
  const C = [];
  const I = [];
  const q = (v) => Math.round(v * 1e4);
  for (let i = 0; i < position.length / 3; i++) {
    const key = [position[i * 3], position[i * 3 + 1], position[i * 3 + 2], normal[i * 3], normal[i * 3 + 1], normal[i * 3 + 2], color[i * 3], color[i * 3 + 1], color[i * 3 + 2]].map(q).join(',');
    let k = map.get(key);
    if (k == null) {
      k = P.length / 3;
      map.set(key, k);
      P.push(position[i * 3], position[i * 3 + 1], position[i * 3 + 2]);
      N.push(normal[i * 3], normal[i * 3 + 1], normal[i * 3 + 2]);
      C.push(...[0, 1, 2].map((c) => Math.max(0, Math.min(255, Math.round(color[i * 3 + c] * 255)))), 255);
    }
    I.push(k);
  }
  const count = P.length / 3;
  const pos = new Float32Array(P);
  const nor = new Float32Array(N);
  const col = new Uint8Array(C);
  const idx = count < 65536 ? new Uint16Array(I) : new Uint32Array(I);
  const pad = (n) => (n + 3) & ~3;
  const parts = [pos, nor, col, idx];
  const offsets = [];
  let len = 0;
  for (const p of parts) {
    offsets.push(len);
    len = pad(len + p.byteLength);
  }
  const bin = new Uint8Array(len);
  parts.forEach((p, i) => bin.set(new Uint8Array(p.buffer, p.byteOffset, p.byteLength), offsets[i]));
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < count; i++) for (let c = 0; c < 3; c++) {
    min[c] = Math.min(min[c], pos[i * 3 + c]);
    max[c] = Math.max(max[c], pos[i * 3 + c]);
  }
  const json = {
    asset: { version: '2.0', generator: 'Pocket Metropolis kit tool' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, COLOR_0: 2 }, indices: 3 }] }],
    buffers: [{ byteLength: len }],
    bufferViews: parts.map((p, i) => ({ buffer: 0, byteOffset: offsets[i], byteLength: p.byteLength, ...(i < 3 ? { target: 34962 } : { target: 34963 }) })),
    accessors: [
      { bufferView: 0, componentType: 5126, count, type: 'VEC3', min, max },
      { bufferView: 1, componentType: 5126, count, type: 'VEC3' },
      { bufferView: 2, componentType: 5121, normalized: true, count, type: 'VEC4' },
      { bufferView: 3, componentType: count < 65536 ? 5123 : 5125, count: I.length, type: 'SCALAR' },
    ],
  };
  let text = new TextEncoder().encode(JSON.stringify(json));
  const jlen = pad(text.length);
  const jbuf = new Uint8Array(jlen).fill(0x20);
  jbuf.set(text);
  text = jbuf;
  const total = 12 + 8 + jlen + 8 + len;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jlen, true);
  dv.setUint32(16, 0x4e4f534a, true);
  out.set(text, 20);
  dv.setUint32(20 + jlen, len, true);
  dv.setUint32(24 + jlen, 0x004e4942, true);
  out.set(bin, 28 + jlen);
  return { bytes: out, vertices: count, triangles: I.length / 3 };
}
