// Renders the app icon (public/icons/icon.svg) to the PNG sizes the web manifest and iOS need, with Chromium.
// Usage: node scripts/make-icons.mjs   (writes public/icons/*.png; committed)
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";

const svg = readFileSync(new URL("../public/icons/icon.svg", import.meta.url), "utf8");
const b = await chromium.launch();
const page = await b.newPage();
for (const [name, size, pad] of [["icon-192.png", 192, 0], ["icon-512.png", 512, 0], ["maskable-512.png", 512, 0.12],
  ["apple-touch-icon.png", 180, 0]]) {
  await page.setViewportSize({ width: size, height: size });
  const inner = Math.round(size * (1 - 2 * pad));
  await page.setContent(`<html><body style="margin:0;background:#0f6b4f;display:grid;place-items:center;width:${size}px;height:${size}px">
    <div style="width:${inner}px;height:${inner}px">${svg.replace("<svg ", `<svg width="${inner}" height="${inner}" `)}</div></body></html>`);
  await page.screenshot({ path: new URL(`../public/icons/${name}`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1") });
  console.log(name);
}
await b.close();
