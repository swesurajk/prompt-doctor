/**
 * Generates the extension icons. No image dependency — node:zlib can deflate,
 * and a PNG is just a few chunks around a deflated bitmap.
 * Run with `npm run icons` after changing the artwork.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = join(dirname(dirname(fileURLToPath(import.meta.url))), 'public/icons');

const CRC = Int32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolour + alpha
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Rounded purple tile with a four-point sparkle, supersampled 3× for edges. */
function draw(size) {
  const S = 3;
  const buf = Buffer.alloc(size * size * 4);
  const r = size * 0.22; // corner radius
  const inSquare = (x, y) => {
    const dx = Math.max(r - x, 0, x - (size - r));
    const dy = Math.max(r - y, 0, y - (size - r));
    return dx * dx + dy * dy <= r * r;
  };
  // Superellipse with exponent 0.5 → a crisp 4-pointed star.
  const a = size * 0.42;
  const star = (x, y) => {
    const dx = Math.abs(x - size / 2) / a;
    const dy = Math.abs(y - size / 2) / a;
    return Math.sqrt(dx) + Math.sqrt(dy) <= 1;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bg = 0;
      let fg = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const px = x + (sx + 0.5) / S;
          const py = y + (sy + 0.5) / S;
          if (!inSquare(px, py)) continue;
          bg++;
          if (star(px, py)) fg++;
        }
      }
      const n = S * S;
      const alpha = bg / n;
      const t = y / size;
      // gradient #7c6cff → #4f46e5
      const base = [
        Math.round(124 + (79 - 124) * t),
        Math.round(108 + (70 - 108) * t),
        Math.round(255 + (229 - 255) * t),
      ];
      const k = fg / n;
      const i = (y * size + x) * 4;
      buf[i] = Math.round(base[0] * (1 - k) + 255 * k);
      buf[i + 1] = Math.round(base[1] * (1 - k) + 255 * k);
      buf[i + 2] = Math.round(base[2] * (1 - k) + 255 * k);
      buf[i + 3] = Math.round(alpha * 255);
    }
  }
  return buf;
}

mkdirSync(outDir, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  writeFileSync(join(outDir, `${size}.png`), png(size, draw(size)));
}
console.log(`icons → ${outDir}`);
