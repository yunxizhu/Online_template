'use strict';
// 极简 PNG 解码 + 裁剪放大 + 重编码（诊断用；本项目没有 PIL）
const fs = require('fs');
const zlib = require('zlib');

function decodePNG(file) {
  const b = fs.readFileSync(file);
  let off = 8;
  let w = 0, h = 0, bit = 0, ct = 0, idat = [];
  while (off < b.length) {
    const len = b.readUInt32BE(off);
    const type = b.slice(off + 4, off + 8).toString('latin1');
    const data = b.slice(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bit = data[8]; ct = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (bit !== 8) throw new Error('only 8-bit');
  const ch = ct === 2 ? 3 : ct === 6 ? 4 : ct === 0 ? 1 : 0;
  if (!ch) throw new Error('unsupported colorType ' + ct);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const px = Buffer.alloc(h * stride);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[p++];
    const line = raw.slice(p, p + stride); p += stride;
    const cur = px.slice(y * stride, (y + 1) * stride);
    const prev = y > 0 ? px.slice((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0, bb = prev[i], cc = i >= ch ? prev[i - ch] : 0;
      let v = line[i];
      if (f === 1) v += a; else if (f === 2) v += bb; else if (f === 3) v += (a + bb) >> 1;
      else if (f === 4) {
        const pp = a + bb - cc, pa = Math.abs(pp - a), pb = Math.abs(pp - bb), pc = Math.abs(pp - cc);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? bb : cc;
      }
      cur[i] = v & 255;
    }
  }
  return { w, h, ch, px };
}

function encodePNG(w, h, rgb) {
  const stride = w * 3;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const crcTable = [];
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
  const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** 从 src 里取 (x0,y0,w,h)，按 zoom 最近邻放大 */
function cropZoom(src, x0, y0, w, h, zoom) {
  const W = w * zoom, H = h * zoom;
  const out = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) {
    const sy = y0 + ((y / zoom) | 0);
    for (let x = 0; x < W; x++) {
      const sx = x0 + ((x / zoom) | 0);
      const si = (sy * src.w + sx) * src.ch;
      const di = (y * W + x) * 3;
      out[di] = src.px[si]; out[di + 1] = src.px[si + 1]; out[di + 2] = src.px[si + 2];
    }
  }
  return { w: W, h: H, rgb: out };
}

module.exports = { decodePNG, encodePNG, cropZoom };

if (require.main === module) {
  const [, , file, x, y, w, h, zoom, out] = process.argv;
  const src = decodePNG(file);
  const r = cropZoom(src, +x, +y, +w, +h, +zoom);
  fs.writeFileSync(out, encodePNG(r.w, r.h, r.rgb));
  console.log(`crop ${x},${y} ${w}x${h} x${zoom} → ${out}`);
}
