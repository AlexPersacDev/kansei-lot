// Generates the PWA icons as PNGs with no dependencies: `node scripts/make-icons.mjs`
// Design: dark tile, red rounded badge, two white tyre marks sweeping in a drift arc.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = (buf) => { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const S = 4; // supersampling
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
        const c = pixel((x + (sx + 0.5) / S) / size, (y + (sy + 0.5) / S) / size);
        r += c[0] * c[3]; g += c[1] * c[3]; b += c[2] * c[3]; a += c[3];
      }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = a ? r / a : 0; raw[o + 1] = a ? g / a : 0; raw[o + 2] = a ? b / a : 0; raw[o + 3] = (a / (S * S)) * 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const BG = [27, 29, 33, 1], RED = [200, 40, 30, 1], WHITE = [240, 238, 230, 1];
const roundRect = (u, v, x0, y0, x1, y1, r) => {
  const cx = Math.max(x0 + r, Math.min(x1 - r, u)), cy = Math.max(y0 + r, Math.min(y1 - r, v));
  return Math.hypot(u - cx, v - cy) <= r;
};
/** inset = fraction kept clear around the art (maskable icons need a safe zone). */
function design(inset, fullBleed) {
  return (u, v) => {
    // map into the art box
    const s = 1 - 2 * inset;
    const x = (u - inset) / s, y = (v - inset) / s;
    const base = fullBleed ? BG : (roundRect(u, v, 0, 0, 1, 1, 0.22) ? BG : [0, 0, 0, 0]);
    if (x < 0 || x > 1 || y < 0 || y > 1) return base;
    if (!roundRect(x, y, 0.1, 0.1, 0.9, 0.9, 0.18)) return base;
    // two tyre marks: arcs around a centre below-left, like a car sweeping round a pivot
    const cx = 0.16, cy = 1.02;
    const d = Math.hypot(x - cx, y - cy);
    const ang = Math.atan2(cy - y, x - cx);
    const onArc = ang > 0.35 && ang < 1.45;
    const fade = Math.min(1, (ang - 0.35) / 0.5);
    for (const R of [0.6, 0.77]) {
      if (onArc && Math.abs(d - R) < 0.045 * (0.5 + 0.5 * fade)) return WHITE;
    }
    return RED;
  };
}

mkdirSync('public/icons', { recursive: true });
writeFileSync('public/icons/icon-192.png', png(192, design(0, false)));
writeFileSync('public/icons/icon-512.png', png(512, design(0, false)));
writeFileSync('public/icons/maskable-512.png', png(512, design(0.1, true)));
writeFileSync('public/icons/apple-touch-icon.png', png(180, design(0.02, true)));
writeFileSync('public/favicon.png', png(64, design(0, false)));
console.log('icons written');
