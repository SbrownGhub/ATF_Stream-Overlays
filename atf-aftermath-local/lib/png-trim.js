/* =====================================================================
   Zero-dependency PNG trimming.
   Decodes a PNG, finds the box around every pixel that isn't (almost)
   fully transparent, and re-encodes just that box.

   Handles 8- and 16-bit RGBA, grey+alpha, RGB, grey, and 8-bit palette
   (with or without a transparency table). Colour-profile chunks are
   carried across so colours don't shift.

   Anything it doesn't understand — interlaced PNGs, 1/2/4-bit palettes,
   damaged files, non-PNGs — is returned untouched. It never fails a
   request; worst case, an image just isn't trimmed.
   ===================================================================== */
import zlib from 'node:zlib';

const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const KEEP = new Set(['gAMA', 'cHRM', 'sRGB', 'iCCP']);   // colour-accuracy chunks

const CRC = (() => {
  const t = new Uint32Array(256);
  for(let n = 0; n < 256; n++){
    let c = n;
    for(let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf){
  let c = 0xffffffff;
  for(let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data){
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/* -> { w, h, rgba, hasAlpha, keep } or null if unsupported */
export function decodeRGBA(buf){
  if(!Buffer.isBuffer(buf) || buf.length < 8 || !buf.subarray(0, 8).equals(SIG)) return null;
  let pos = 8, ihdr = null, plte = null, trns = null;
  const idat = [], keep = [];
  while(pos + 8 <= buf.length){
    const len  = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if(type === 'IHDR') ihdr = { w:data.readUInt32BE(0), h:data.readUInt32BE(4), depth:data[8], ctype:data[9], interlace:data[12] };
    else if(type === 'PLTE') plte = data;
    else if(type === 'tRNS') trns = data;
    else if(type === 'IDAT') idat.push(data);
    else if(KEEP.has(type)) keep.push({ type, data: Buffer.from(data) });
    else if(type === 'IEND') break;
  }
  if(!ihdr || ihdr.interlace !== 0) return null;
  const { w, h, depth, ctype } = ihdr;
  const channels = { 0:1, 2:3, 3:1, 4:2, 6:4 }[ctype];
  if(!channels || !w || !h) return null;
  if(depth !== 8 && depth !== 16) return null;
  if(ctype === 3 && (depth !== 8 || !plte)) return null;

  const bpp = channels * depth / 8;
  const stride = w * bpp;
  let raw;
  try{ raw = zlib.inflateSync(Buffer.concat(idat)); }catch(e){ return null; }
  if(raw.length < h * (stride + 1)) return null;

  const out = Buffer.alloc(w * h * 4);
  let prev = Buffer.alloc(stride), cur = Buffer.alloc(stride);
  const hi = depth === 16 ? 2 : 1;                 // 16-bit: keep the high byte

  for(let y = 0; y < h; y++){
    const base = y * (stride + 1), f = raw[base];
    if(f > 4) return null;
    for(let i = 0; i < stride; i++){
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let v = raw[base + 1 + i];
      if(f === 1) v += a;
      else if(f === 2) v += b;
      else if(f === 3) v += (a + b) >> 1;
      else if(f === 4){
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[i] = v & 0xff;
    }
    for(let x = 0; x < w; x++){
      const o = (y * w + x) * 4, p = x * bpp;
      if(ctype === 6){ out[o] = cur[p]; out[o+1] = cur[p+hi]; out[o+2] = cur[p+2*hi]; out[o+3] = cur[p+3*hi]; }
      else if(ctype === 2){ out[o] = cur[p]; out[o+1] = cur[p+hi]; out[o+2] = cur[p+2*hi]; out[o+3] = 255; }
      else if(ctype === 4){ out[o] = out[o+1] = out[o+2] = cur[p]; out[o+3] = cur[p+hi]; }
      else if(ctype === 0){ out[o] = out[o+1] = out[o+2] = cur[p]; out[o+3] = 255; }
      else {
        const idx = cur[x];
        out[o] = plte[idx*3] ?? 0; out[o+1] = plte[idx*3+1] ?? 0; out[o+2] = plte[idx*3+2] ?? 0;
        out[o+3] = trns && idx < trns.length ? trns[idx] : 255;
      }
    }
    const t = prev; prev = cur; cur = t;
  }
  return { w, h, rgba: out, keep, hasAlpha: ctype === 6 || ctype === 4 || (ctype === 3 && !!trns) };
}

/* Alpha at or below THRESHOLD counts as empty, so faint halo pixels left
   by cut-out tools don't stop the trim. */
export const THRESHOLD = 8;

export function trimPNG(buf, threshold = THRESHOLD){
  const img = decodeRGBA(buf);
  if(!img || !img.hasAlpha) return { buf, trimmed:false };
  const { w, h, rgba } = img;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for(let y = 0; y < h; y++){
    const row = y * w * 4;
    for(let x = 0; x < w; x++){
      if(rgba[row + x * 4 + 3] > threshold){
        if(x < x0) x0 = x;
        if(x > x1) x1 = x;
        if(y < y0) y0 = y;
        y1 = y;
      }
    }
  }
  if(x1 < 0) return { buf, trimmed:false };                               // fully transparent
  if(x0 === 0 && y0 === 0 && x1 === w - 1 && y1 === h - 1) return { buf, trimmed:false };

  const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
  const lines = Buffer.alloc(ch * (cw * 4 + 1));
  for(let y = 0; y < ch; y++){
    const o = y * (cw * 4 + 1);
    lines[o] = 0;
    rgba.copy(lines, o + 1, ((y + y0) * w + x0) * 4, ((y + y0) * w + x0 + cw) * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(cw, 0); ihdr.writeUInt32BE(ch, 4); ihdr[8] = 8; ihdr[9] = 6;
  return {
    buf: Buffer.concat([
      SIG, chunk('IHDR', ihdr),
      ...img.keep.map(k => chunk(k.type, k.data)),
      chunk('IDAT', zlib.deflateSync(lines, { level:6 })),
      chunk('IEND', Buffer.alloc(0))
    ]),
    trimmed:true, box:[x0, y0, cw, ch], from:[w, h]
  };
}
