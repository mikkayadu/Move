#!/usr/bin/env node
/**
 * Generates the PWA icons.
 *
 * They are drawn in code rather than committed as binaries so the repository
 * stays reviewable, the icon can be re-tuned by editing numbers, and there is
 * no image toolchain to install. Node's zlib is enough to emit a valid PNG.
 *
 * The mark: three motion lines resolving into a bright dot - "you are moving,
 * and here is the moment to go".
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SIZES = [192, 512];
const OUT_DIR = resolve(import.meta.dirname, '..', 'public', 'icons');

const BACKGROUND = [13, 21, 38];
const LINE = [31, 127, 102];
const DOT = [53, 214, 160];

/** Supersampling factor. 3x3 per pixel is plenty for flat geometry. */
const SS = 3;

function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  for (const size of SIZES) {
    const png = encodePng(size, size, drawIcon(size));
    writeFileSync(resolve(OUT_DIR, `icon-${size}.png`), png);
    console.log(`wrote icons/icon-${size}.png`);
  }
}

/** Returns an RGBA buffer of width*height*4 bytes. */
function drawIcon(size) {
  const pixels = Buffer.alloc(size * size * 4);

  // Maskable icons get their outer ~10% cropped on some launchers, so every
  // part of the mark stays inside the middle 80%.
  const mid = size / 2;
  const cap = size * 0.046;
  const rowGap = size * 0.163;

  const lines = [
    { y: mid - rowGap, x1: size * 0.315, x2: size * 0.56 },
    { y: mid, x1: size * 0.225, x2: size * 0.5 },
    { y: mid + rowGap, x1: size * 0.275, x2: size * 0.53 },
  ];
  const dot = { x: size * 0.665, y: mid, r: size * 0.108 };

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let lineHits = 0;
      let dotHits = 0;

      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;

          if (Math.hypot(px - dot.x, py - dot.y) <= dot.r) {
            dotHits += 1;
          } else if (lines.some((line) => distanceToSegment(px, py, line) <= cap)) {
            lineHits += 1;
          }
        }
      }

      const total = SS * SS;
      const colour = blend(
        blend(BACKGROUND, LINE, lineHits / total),
        DOT,
        dotHits / total,
      );

      const offset = (y * size + x) * 4;
      pixels[offset] = colour[0];
      pixels[offset + 1] = colour[1];
      pixels[offset + 2] = colour[2];
      pixels[offset + 3] = 255;
    }
  }

  return pixels;
}

/** Distance from a point to a horizontal segment, giving capsule ends. */
function distanceToSegment(px, py, { y, x1, x2 }) {
  const clampedX = Math.min(x2, Math.max(x1, px));
  return Math.hypot(px - clampedX, py - y);
}

function blend(base, over, alpha) {
  if (alpha <= 0) return base;
  if (alpha >= 1) return over;
  return base.map((channel, index) => Math.round(channel + (over[index] - channel) * alpha));
}

/* -------------------------------------------------------------------------
   Minimal PNG encoder: signature + IHDR + IDAT + IEND, truecolour with alpha.
   ------------------------------------------------------------------------- */
function encodePng(width, height, rgba) {
  // Each scanline is prefixed with filter type 0 (none).
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    const target = y * (width * 4 + 1);
    raw[target] = 0;
    rgba.copy(raw, target + 1, y * width * 4, (y + 1) * width * 4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: truecolour with alpha
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);

  return Buffer.concat([length, body, crc]);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

main();
