// GATHO app icons from the approved sneaker sprite (web/brand/sprites.json; blueprint Phase 5b amendment 7).
// Whole-pixel scales only, so the pixels stay square; the depth layer is every non-outline pixel offset by 30 % of a
// pixel, black at 20 %; the accent line sits under the sole. Writes public/icons/ (gitignored). Runs before dev and
// build, like copy-maplibre-worker.mjs.
import { crc32, deflateSync } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const { sneaker } = JSON.parse(readFileSync(join(root, "brand", "sprites.json"), "utf8"));
const PAPER = "#F5F0E6";
const ACCENT = "#0F6E56";
const W = sneaker.rows[0].length;
const H = sneaker.rows.length;

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** Icon: size px square; sneaker at a whole-number scale, centred with the accent line under it. */
function render(size, scale, gap, bar) {
  const px = new Uint8Array(size * size * 3);
  const paper = rgb(PAPER);
  for (let i = 0; i < size * size; i++) px.set(paper, i * 3);
  const blockH = H * scale + gap + bar;
  const ox = Math.floor((size - W * scale) / 2);
  const oy = Math.floor((size - blockH) / 2);
  const fill = (x0, y0, w, h, c, a = 1) => {
    for (let y = Math.max(0, y0); y < Math.min(size, y0 + h); y++)
      for (let x = Math.max(0, x0); x < Math.min(size, x0 + w); x++) {
        const i = (y * size + x) * 3;
        for (let k = 0; k < 3; k++) px[i + k] = Math.round(px[i + k] * (1 - a) + c[k] * a);
      }
  };
  const off = Math.max(1, Math.round(0.3 * scale));
  for (const [layer, depth] of [[0, true], [1, false]]) {
    void layer;
    sneaker.rows.forEach((row, r) => [...row].forEach((ch, c) => {
      if (ch === ".") return;
      if (depth) { if (ch !== "O") fill(ox + c * scale + off, oy + r * scale + off, scale, scale, [0, 0, 0], sneaker.depthOpacity); }
      else fill(ox + c * scale, oy + r * scale, scale, scale, rgb(sneaker.palette[ch]));
    }));
  }
  if (bar) fill(ox, oy + H * scale + gap, W * scale, bar, rgb(ACCENT));
  return png(size, size, px);
}

function png(w, h, px) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(px.buffer, y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

/** Vector favicon: the same pixels as rects, crisp at any size. */
function svg() {
  const paths = {};
  let depth = "";
  sneaker.rows.forEach((row, r) => [...row].forEach((ch, c) => {
    if (ch === ".") return;
    paths[ch] = (paths[ch] ?? "") + `M${c} ${r + 7}h1v1h-1z`;
    if (ch !== "O") depth += `M${c + 0.3} ${r + 7.3}h1v1h-1z`;
  }));
  const body = Object.entries(paths).map(([ch, d]) => `<path fill="${sneaker.palette[ch]}" d="${d}"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" shape-rendering="crispEdges">` +
    `<rect width="32" height="32" fill="${PAPER}"/><path fill="#000" fill-opacity="${sneaker.depthOpacity}" d="${depth}"/>${body}</svg>\n`;
}

const out = join(root, "public", "icons");
mkdirSync(out, { recursive: true });
const icons = [
  ["icon-512.png", render(512, 11, 16, 12)],
  ["maskable-512.png", render(512, 9, 12, 10)],   // inside the 80 % safe circle
  ["icon-192.png", render(192, 5, 6, 5)],
  ["apple-touch-icon.png", render(180, 5, 6, 5)],
  ["favicon-32.png", render(32, 1, 2, 2)],
];
for (const [name, data] of icons) writeFileSync(join(out, name), data);
writeFileSync(join(out, "icon.svg"), svg());
console.log(`GATHO icons -> public/icons/ (${icons.map(([n]) => n).join(", ")}, icon.svg)`);
