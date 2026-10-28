// A minimal PNG reader for the kits' palette textures (8-bit RGB, RGBA, grey or indexed; no interlace).
import { inflateSync } from 'node:zlib';

export function readPng(buf) {
  let at = 8;
  let w = 0, h = 0, depth = 0, type = 0, plte = null, trns = null;
  const idat = [];
  while (at < buf.length) {
    const len = buf.readUInt32BE(at);
    const kind = buf.toString('ascii', at + 4, at + 8);
    const data = buf.subarray(at + 8, at + 8 + len);
    if (kind === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      depth = data[8];
      type = data[9];
      if (data[12]) throw new Error('Interlaced PNGs are not supported');
    } else if (kind === 'PLTE') plte = data;
    else if (kind === 'tRNS') trns = data;
    else if (kind === 'IDAT') idat.push(data);
    at += 12 + len;
  }
  if (depth !== 8) throw new Error(`Only 8-bit PNGs are supported (got ${depth})`);
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? px[y * stride + x - ch] : 0;
      const b = y ? px[(y - 1) * stride + x] : 0;
      const c = x >= ch && y ? px[(y - 1) * stride + x - ch] : 0;
      let v = row[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      px[y * stride + x] = v & 255;
    }
  }
  // → RGBA
  const out = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    let r, g, b, a = 255;
    if (type === 3) {
      const k = px[i];
      r = plte[k * 3]; g = plte[k * 3 + 1]; b = plte[k * 3 + 2];
      if (trns && k < trns.length) a = trns[k];
    } else if (type === 0 || type === 4) {
      r = g = b = px[i * ch];
      if (type === 4) a = px[i * ch + 1];
    } else {
      r = px[i * ch]; g = px[i * ch + 1]; b = px[i * ch + 2];
      if (type === 6) a = px[i * ch + 3];
    }
    out.set([r, g, b, a], i * 4);
  }
  return { width: w, height: h, data: out };
}
