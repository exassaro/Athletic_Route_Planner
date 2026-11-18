# Phase 5b step 11: starting MapLibre after first paint

Measured on 2026-11-18 on the development laptop, not a target server. Lighthouse 13.0.1, default mobile profile (simulated slow 4G, 4× CPU slowdown), Playwright's Chromium 1255, headless, against `next start` on `http://localhost:3001` (the check build, API proxied). Three runs each; the planner `/` in its empty (setup) state. These are a same-method A/B for this step only. The official before-and-after numbers go through Caddy (`docs/reports/phase5b/before/README.md`, and step 13).

| Build | Performance (runs) | Median TBT | Median LCP | MapLibre chunk scripting |
| --- | --- | --- | --- | --- |
| Step 10: MapLibre starts on hydration | 66, 52, 67 → **66** | 3.20 s | 2.72 s | about 4.9 s |
| Step 11: MapLibre starts after `load`, in an idle moment (≤ 2 s) | 67, 66, 66 → **66** | 3.70 s | 2.77 s | about 4.9 s |
| Tried and reverted: also drop POIs, house numbers, one-way arrows, minor road names, buildings | 67, 66, 66 → **66** | 4.35 s | 2.65 s | 3.9 to 5.1 s |
| Tried, one run: step 11 with hardware GL (`--use-angle=d3d11 --enable-gpu`) | 67 | 4.30 s | 2.65 s | about 4.9 s |

Accessibility 100 in every run.

**What this shows.** Almost all main-thread work on the planner is MapLibre's own script (about 4.9 s of about 6.6 s under the 4× slowdown), including one task of about 2.3 s. Starting it later moves the work but does not remove it: Lighthouse counts blocking time until the page is quiet, and the map is part of the page, so TBT and the score do not move (the TBT differences are run-to-run noise). The cost does not come from the style's size (removing 5 of 71 layers changed nothing measurable) or from software WebGL in headless Chrome (hardware GL gave the same).

**Kept:** the later start. The sheet and its controls hydrate and respond before the map's work begins, and the map box shows the basemap's land colour in the meantime. **Reverted:** the layer drop (no gain, and minor road names help runners).

**Not done (would need a decision):** a lighter map library or a raster basemap; showing a static image until the first tap; measuring on the Redmi itself (Chrome remote debugging), where the GPU and CPU differ from the laptop's emulation.
