// MapLibre 6 finds its web worker next to its own module (import.meta.url). Bundled by Next.js, that file has
// moved, so the worker is copied to public/maplibre/ (gitignored) and named with setWorkerUrl. Runs before dev,
// build and test, so the worker always matches the installed maplibre-gl. Its source map goes with it: browsers
// with DevTools open ask for it.
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const pkgDir = dirname(require.resolve("maplibre-gl/package.json"));
const { version } = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
const out = join(here, "..", "public", "maplibre");
mkdirSync(out, { recursive: true });
for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-worker.mjs.map"]) copyFileSync(join(pkgDir, "dist", file), join(out, file));
console.log(`maplibre-gl ${version} worker -> public/maplibre/`);
