# Phase 5b summary: the GATHO mobile-first redesign

The Phase 5 planner is redesigned for the phone, under the name **GATHO**. No new features, no solver change. The one API change is A8 (GPX creator), which was approved. Measured on 2026-11-18 on the development laptop (Windows 11, i5 10th gen, 16 GB), not on a target server.

## What changed

| Area | Before (Phase 5) | After (Phase 5b) |
| --- | --- | --- |
| Name | "Athlete Router" | **GATHO** in the wordmark, titles, manifest, share page, OpenGraph and About; GPX `creator="GATHO"`, metadata name "<course> · GATHO" (A8). Python packages, repo and API paths unchanged |
| Look | Default system UI | "Playful retro, minimal": paper and ink, 1 px hairlines, 4 px radius, accent #0F6E56 (dark #3DBFA3), one amber for warnings. Pixel font (Silkscreen, self-hosted subset, tabular digits) only for the wordmark and stat numbers ≥ 24 px. Pixel icons (pixelarticons 2.4.2). Hard shadow only on the primary button and the selected card |
| Themes | Light only | Light and dark, toggle in the menu, default light, set before first paint; every contrast pair tested in both (`tokens.test.ts`). The basemap has quiet light and dark flavours of the same tiles |
| Layout | Map plus a long form | Full-screen map, bottom sheet with peek, half and full (side panel on desktop) |
| Setup | One permanent form | Five steps (Start, Distance, Shape, Towards, Stops), then "Plan my run". The runner sprite is the empty state; its 4-frame run cycle is the loading animation |
| Editing | Form fields | Chips (start, distance, shape, direction, stops, prefs) that open editors; a JSON Patch per edit, as before |
| Results | Candidate list | Peek bar with the three big numbers; swipeable route cards (road-class bar, badges, "Why this route?"); stops as a vertical timeline |
| Conflicts | Panel repeating the numbers | One headline ("Your stops need 21.7 km", then "1.7 km over your 20.0 km"), with the fixes as buttons |
| History | Version list | Undo message after each edit (no timeout); history in the menu |
| Top bar | None | Place search and a menu (saved routes, pace, road/path preferences, theme, about, OSM credit) |
| Map | Round pins, overlapping | The sneaker start pin (faces the route's first km, hops, mirrored when heading west), numbered stop discs grouped when they overlap ("1·2"), place diamonds, an end flag, a fit-route button. The second route is dashed in ink |
| Share page and saved routes | Plain | GATHO look, a still sneaker, the same numbers |
| Icons | Default | The sneaker at 512, maskable 512, 192, 180 and 32 |
| Loading | MapLibre at once | MapLibre starts after first paint (step 11; no measurable gain, see [perf-step11.md](perf-step11.md)) |

Every number on screen still carries `data-value`, its raw API value. `checkNumbersEverySnap` checks them against the API's responses at peek, half and full.

## Tests

- Web unit tests, typecheck, lint and build: passing (CI as before).
- Journeys A01, S02 and G01 (phone viewport) **through Caddy** (`https://10.141.255.68`) against the Phase 5b build: **3 passed** (1.6 min). The selectors changed; the intent did not. A01 also checks the GPX's `creator="GATHO"`.
- Screens: phone and desktop, **2 passed** (4.7 min), 74 images.

## Lighthouse, before and after

Same method both times: through Caddy on the LAN address, Lighthouse 13.0.1, default mobile profile (simulated slow 4G, 4× CPU slowdown), Playwright's Chromium 1255, headless. Three runs per page; median shown. Before: [before/README.md](before/README.md). After: [after/lighthouse/](after/lighthouse/).

| Page | | Performance | Accessibility | Best practices | SEO | FCP | LCP | TBT | CLS | Speed index | Main-thread work |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Planner `/` | before | 68 | 100 | 100 | 100 | 0.91 s | 2.02 s | 3.76 s | 0 | 3.82 s | 6.59 s |
| | **after** | **70** | **100** | 100 | 100 | 0.91 s | 1.94 s | 3.08 s | 0 | 2.40 s | 5.69 s |
| Share `/s/qwI4HRq1jxzS` | before | 67 | 100 | 100 | 100 | 0.91 s | 2.03 s | 4.75 s | 0 | 4.27 s | 8.57 s |
| | **after** | **69** | **100** | 100 | 100 | 0.91 s | 1.96 s | 3.17 s | 0 | 2.90 s | 6.85 s |

Each run after: planner 70 / 70 / 70 (TBT 3.39, 3.08, 2.99 s); share 69 / 69 / 69 (TBT 3.54, 3.17, 3.04 s).

- **Accessibility: 100 on both pages** (gate ≥ 95). Touch targets were measured at ≥ 44 px in every step.
- **Performance: +2 on both pages.** Total blocking time is down about 0.7 s on the planner and 1.6 s on the share page, and speed index about 1.4 s on both. MapLibre still accounts for nearly all the blocking time (about 4.9 s of scripting under the 4× slowdown, [perf-step11.md](perf-step11.md)). A score well above 70 would need the map to start later than first paint or a lighter map library; neither is in Phase 5b.
- In a single-run A/B on :3001, step 11 alone (lazy start) showed no gain. The difference here comes from the whole redesign, measured the same way as the baseline.

## The start pin's main-thread cost

**Lighthouse cannot include the pin.** A fresh planner opens on the setup steps, with no route and so no pin, and the planner cannot load a plan from a URL. The share page's pin is still, and it is included in the share runs above.

Measured separately instead. `e2e/pincost.spec.ts` (`npx playwright test --project=pincost`):
- Setup: A01's base route on the phone viewport, sheet at peek, map idle, CPU slowed 4× via CDP.
- Method: Chrome's `Performance.getMetrics` over 5 s windows.
- Three states: the pin hopping, the pin still (animation off), and the pin removed.
- Repetition: three rounds, run twice. Medians of the six windows:

| State | Main-thread task time per 5 s | Style recalculation per 5 s | Style recalcs | Layouts | Script |
| --- | --- | --- | --- | --- | --- |
| Pin hopping | **about 160 ms** (124 to 264) | **24 ms** (18 to 29) | 22 to 32 | 0 | 1 to 3 ms |
| Pin still | 34 ms (28 to 139) | 0 | 0 | 0 | 0 |
| Pin removed | 45 ms (30 to 56) | 0 | 0 | 0 | 0 |
| Hopping + `will-change` | 117 ms (113 to 124) | 17 ms (16 to 17) | 22 to 23 | 0 | 2 ms |

- **The still pin costs nothing measurable**, compared with no pin.
- **The hopping pin is measurable**: about 5 style recalculations a second and about 0.1 s of main-thread time per 5 s, under the 4× slowdown. That is about 2 % of the main thread while the map is idle, and about a quarter of that at full speed.
- It never causes layout. It animates only `transform` and `opacity` on an inner element, but Chrome still recalculates style for it on the main thread. `will-change` reduces this a little but does not remove it.
- It already pauses while the map moves and while a solve runs, and is off with reduced motion.

**This does not meet amendment 10 as written** ("adds no measurable main-thread time"). Not changed: the hop is specified behaviour. Options:
1. Hop a few times (for example 3 hops, about 3.3 s) when a route arrives or the start changes, then rest still. After that it costs nothing.
2. Hop on tap only.
3. Accept the cost and amend the criterion.

## Screenshots

Before and after: 34 images (17 screens) before; 74 images after, in [after/screenshots/](after/screenshots/):
- **Phone 390 × 844:** 25 screens in light and dark (49 images: the loading screen is light only, since it is mid-solve).
- **Desktop 1440 × 900:** the same 25 screens, light.

The 25 screens, by area:
- **Setup:** 01–06, the steps and the place picker.
- **A01 results:** 07–14, peek, half, the stops timeline, the route detail chart, stop options, the distance editor, the menu, search actions.
- **Edits:** 15 over budget, 16 a fix with the Undo message.
- **Saving and sharing:** 17 save, 18 the share page, 19 saved routes.
- **S02 and G01:** 20 S02 loop, 21 G01 conflict.
- **Mocked states:** 22–25, loading, 429 busy, engines down, 504 polling. The test intercepts the API's answer.

## Hallway test

Updated for the new UI: [hallway/script.md](hallway/script.md) and [hallway/feedback-form.md](hallway/feedback-form.md). The task is the same as in Phase 5 (Athanikkal, 25 km towards Kozhikode, six stops including the Karuvanthuruthy bridge), so the two rounds can be compared. **Not run yet:** results go in `hallway/results/`. Acceptance: 5 of 5 without help.

## Known limitations

- **Share page facing.** The share map faces the sneaker along the first geometry segment (east for A01). The planner faces it towards the first km mark (west for A01), and the share response has no km marks. A fix needs those marks in the share response, an API change, so it is listed and not made.
- **Performance** is about 70, held there by MapLibre (above).
- **The bridge is not searchable by name** (Photon). It is added from the map ("Pick a bridge or road on the map"). The hallway script notes how long this takes.
- **The pin's hop cost** (above): waiting for a decision.

## Rerun

```
cd web
$env:E2E_BASE="https://10.141.255.68"; $env:E2E_API="https://10.141.255.68"; $env:E2E_INSECURE="1"
npx playwright test --project=phone
$env:SHOTS_DIR="../docs/reports/phase5b/after/screenshots"; npx playwright test --project=screens
npx playwright test --project=pincost
$env:CHROME_PATH="$env:LOCALAPPDATA\ms-playwright\chromium-1255\chrome-win64\chrome.exe"
npx lighthouse@13.0.1 https://10.141.255.68/ --chrome-flags="--headless=new --ignore-certificate-errors" --output=json --output=html --output-path=<file>
```

These need the `same-origin` build served through Caddy, and the API's session limit raised (`--no-deps`; see CLAUDE.md). The limit was put back to 10 afterwards.
