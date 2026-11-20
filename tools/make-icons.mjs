// Generates PWA/app icons as PNG files without any dependencies.
// Draws a BigBasket-inspired shopping-basket logo on a brand-green tile.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(OUT, { recursive: true });

// ---------- minimal PNG encoder (RGBA, no filtering beyond per-row filter 0) ----------
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();
const crc32 = buf => {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
  return out;
}
function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy ? rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
      : Buffer.from(rgba.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// ---------- brand palette ----------
const GREEN_TOP = [132, 194, 37];    // #84c225 (BigBasket CTA green)
const GREEN_BOT = [72, 140, 20];     // darker green for the gradient
const WHITE = [255, 255, 255];
const LIME = [166, 206, 57];         // #a6ce39 accent

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

// signed distance helpers on unit canvas (0..1 coordinates)
function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const dx = Math.abs(px - cx) - (hw - r), dy = Math.abs(py - cy) - (hh - r);
  const ax = Math.max(dx, 0), ay = Math.max(dy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(dx, dy), 0) - r;
}
function sdSegment(px, py, ax, ay, bx, by) {
  const pax = px - ax, pay = py - ay, bax = bx - ax, bay = by - ay;
  const h = clamp((pax * bax + pay * bay) / (bax * bax + bay * bay), 0, 1);
  return Math.hypot(pax - bax * h, pay - bay * h);
}
// inside a trapezoid (top wider) between yTop..yBottom
function inTrapezoid(px, py, yTop, yBot, halfTop, halfBot) {
  if (py < yTop || py > yBot) return false;
  const t = (py - yTop) / (yBot - yTop);
  const half = halfTop + (halfBot - halfTop) * t;
  return Math.abs(px) <= half;
}

/** Draw the logo; S is supersampled canvas size, returns function (px,py)->[r,g,b,a] */
function logoPixel(u, v) {
  // gradient background tile
  const bg = mix(GREEN_TOP, GREEN_BOT, clamp((u + v) / 2, 0, 1));
  let paint = null;
  const set = (color, alpha) => { paint = paint === null ? [color, alpha] : [mix(paint[0], color, alpha), 1]; };

  // white rounded-square "card" (for standard icon) is applied by caller; here draw glyph
  // handle: arc above the basket
  const hx = 0.5, hy = 0.40;
  const dx = u - hx, dy = hy - v;
  const dist = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx); // 0 at +x, PI/2 up
  if (dist >= 0.155 && dist <= 0.20 && angle >= 0.18 && angle <= Math.PI - 0.18) set(WHITE, 1);

  // basket body: trapezoid from y .40 to .72
  const inBody = inTrapezoid(u - 0.5, v, 0.40, 0.735, 0.30, 0.20);
  if (inBody) set(WHITE, 1);

  // green stripes over the body (vertical slots)
  const stripes = [-0.18, -0.06, 0.06, 0.18];
  for (const off of stripes) {
    if (inBody && Math.abs(u - 0.5 - off) < 0.022) set(bg, 1);
  }
  // top rim bar of the basket
  if (inTrapezoid(u - 0.5, v, 0.385, 0.415, 0.315, 0.305)) set(WHITE, 1);

  // small accent dot (leaf) top-right
  const leaf = Math.hypot((u - 0.80) / 0.07, (v - 0.245) / 0.05);
  if (leaf <= 1) set(LIME, 1);

  if (paint) return [...paint[0], Math.round(paint[1] * 255)];
  return [...bg, 255];
}

function renderIcon(size, { rounded = true, scale = 0.86 } = {}) {
  const ss = 4; // supersample factor
  const S = size * ss;
  const img = new Float64Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const u = (x * ss + sx + 0.5) / S, v = (y * ss + sy + 0.5) / S;
          // map unit canvas into scaled, centered square
          const cu = (u - 0.5) / scale + 0.5, cv = (v - 0.5) / scale + 0.5;
          let color;
          if (cu < 0 || cu > 1 || cv < 0 || cv > 1) color = [0, 0, 0, 0];
          else {
            const [cr, cg, cb] = logoPixel(cu, cv);
            let alpha = 255;
            if (rounded) {
              const d = sdRoundRect(cu, cv, 0.5, 0.5, 0.5, 0.5, 0.18);
              alpha = Math.round(clamp(0.5 - d, 0, 1) * 255);
            }
            color = [cr, cg, cb, alpha];
          }
          r += color[0]; g += color[1]; b += color[2]; a += color[3];
        }
      }
      const n = ss * ss, i = (y * size + x) * 4;
      img[i] = r / n; img[i + 1] = g / n; img[i + 2] = b / n; img[i + 3] = a / n;
    }
  }
  const out = Buffer.alloc(size * size * 4);
  for (let i = 0; i < img.length; i += 4) {
    out[i] = Math.round(img[i]); out[i + 1] = Math.round(img[i + 1]);
    out[i + 2] = Math.round(img[i + 2]); out[i + 3] = Math.round(img[i + 3]);
  }
  return encodePng(size, size, out);
}

// opaque variant for iOS / maskable (no transparent corners)
function renderOpaque(size) {
  const png = renderIcon(size, { rounded: false, scale: 1 });
  return png;
}

writeFileSync(join(OUT, 'icon-192.png'), renderIcon(192));
writeFileSync(join(OUT, 'icon-512.png'), renderIcon(512));
writeFileSync(join(OUT, 'maskable-512.png'), renderIcon(512, { rounded: false, scale: 0.78 }));
writeFileSync(join(OUT, 'apple-touch-icon.png'), renderOpaque(180));
console.log('icons written to', OUT);
