#!/usr/bin/env node
/**
 * First-load JavaScript of the pages in bundle-budget.json, measured from a finished `next build`.
 *
 * First load = the root main files every page loads (build-manifest.json `rootMainFiles`) plus the entry chunks of
 * the page's own segments (layout and page) from its client reference manifest. Chunks loaded later with import()
 * are not counted: that is the point (the QR code, Follow, the elevation chart). Sizes are gzip level 9 of each
 * file, summed, which is close to what the browser downloads.
 *
 *   node scripts/bundle-size.mjs              # measure, compare with bundle-budget.json, exit 1 if over
 *   node scripts/bundle-size.mjs --json       # print the measurement as JSON only
 *   NEXT_DIST_DIR=.next-check node scripts/bundle-size.mjs
 *
 * The budget is the measured baseline plus a small margin. Raise it on purpose, in its own commit, with the
 * reason in `note`.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import vm from "node:vm";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const dist = join(root, process.env.NEXT_DIST_DIR || ".next");
const budget = JSON.parse(readFileSync(join(root, "bundle-budget.json"), "utf8"));

/** The page's client reference manifest, run in a sandbox (it assigns globalThis.__RSC_MANIFEST). */
function entryFiles(route) {
  const dir = route === "/" ? "" : route.replace(/^\//, "");
  const file = join(dist, "server", "app", dir, "page_client-reference-manifest.js");
  if (!existsSync(file)) throw new Error(`no client reference manifest for ${route} (${file}): build first`);
  const sandbox = { self: {}, globalThis: {} };
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(readFileSync(file, "utf8"), sandbox);
  const key = route === "/" ? "/page" : `${route}/page`;
  const m = sandbox.__RSC_MANIFEST?.[key];
  if (!m) throw new Error(`manifest for ${route} has no ${key}`);
  return Object.values(m.entryJSFiles).flat();
}

function measure(route, rootMain) {
  const files = [...new Set([...rootMain, ...entryFiles(route)])];
  let raw = 0;
  let gz = 0;
  for (const f of files) {
    const body = readFileSync(join(dist, f));
    raw += body.length;
    gz += gzipSync(body, { level: 9 }).length;
  }
  return { route, files: files.length, raw, gzip: gz };
}

const manifest = JSON.parse(readFileSync(join(dist, "build-manifest.json"), "utf8"));
const rootMain = manifest.rootMainFiles;
const results = Object.keys(budget.routes).map((r) => measure(r, rootMain));

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(results, null, 2));
  process.exit(0);
}

const kb = (n) => `${(n / 1024).toFixed(1)} kB`;
let over = false;
console.log(`First-load JS (gzip) from ${dist}`);
for (const r of results) {
  const limit = budget.routes[r.route].max_gzip;
  const ok = r.gzip <= limit;
  over ||= !ok;
  console.log(`  ${ok ? "ok  " : "OVER"}  ${r.route.padEnd(8)} ${kb(r.gzip).padStart(9)} gzip (${kb(r.raw)} raw, ` +
    `${r.files} files), budget ${kb(limit)}`);
}
if (over) {
  console.error("\nFirst-load JS is over budget (web/bundle-budget.json). Load the new code with import(), " +
    "or raise the budget on purpose with a note.");
  process.exit(1);
}
