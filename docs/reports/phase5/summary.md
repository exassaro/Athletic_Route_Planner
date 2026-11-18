# Phase 5 status: the web front end and map

The planner in `web/`:
- Next.js 16.4 (App Router), TypeScript 5.9 and MapLibre GL JS 6.19, on a self-hosted Kerala basemap.
- It talks only to the Phase 4 API, with types generated from its OpenAPI schema (blueprint Phase 5 amendments 1 to 15).

Measured on the development laptop on 2026-11-18, against the live stack and the pinned extract (2026-11-15), not on a target server.

**The solver changed once, by decision:** the climb over bridges (amendment 13, P3).
- All 110 fixtures were solved again and compared with the stored routes ([bridge_climb_compare.json](bridge_climb_compare.json)). Routes, outcomes, conflicts, scores and flags are identical; only gain and loss move.
- Solver integration tests: 72 of 72 pass.

## Acceptance

| Criterion (section 15, updated) | Measured | Pass |
| --- | --- | --- |
| A01 journey end to end: search Athanikkal, 25 km, towards Kozhikode, six stops; 25.0 km, stops in order; then 20 km, a fix button, undo, save, share, GPX, share page logged out | Playwright, phone viewport (Pixel 7), live stack: passes. Also passes through Caddy on the LAN address | yes |
| S02 journey (10 km loop from Mananchira) | passes | yes |
| G01 journey (loop that cannot reach Feroke): message with numbers, map not blank, one-tap fixes | passes | yes |
| Every number on screen matches the API response | Each number carries its raw API value (`data-value`). The test checks every visible one against the responses the page received, and checks its text is that value formatted. It runs on every screen of the three journeys | yes |
| Usable on a phone over the LAN | HTTPS through Caddy (`tls internal`) checked from this laptop: journeys pass on `https://10.141.255.68`, and the chain verifies against Caddy's root. **Not yet tried on a real phone**; steps in [phone.md](phone.md) | developer |
| Five runners complete the A01 journey without help | Script and form ready: [hallway/script.md](hallway/script.md), [hallway/feedback-form.md](hallway/feedback-form.md) | developer |
| Lighthouse accessibility ≥ 90 (amendment 10) | **100** | yes |

A01 built through the UI is the fixture's request:
- Photon gives the same OSM ids and coordinates as the fixtures for all seven A01 places.
- The OSM item endpoint (A6) builds identical checkpoints, boundaries and bridge way included (tested).
- So the UI shows the fixture's result: recommended 25.0 km ending at Francis Road; shortest 25.1 km past the target, or 24.1 km (928 m short).

The bridge stop's label is OSM's way name, "Chaliyam - Feroke Road": "Karuvanthuruthy bridge" is not in OSM under any name.

## Tests

| Suite | Count | Result |
| --- | --- | --- |
| Python unit and API (no engines) | 213 | pass |
| Live API integration (`tests/integration -k api`) | 7 | pass |
| Solver integration (`tests/integration -k "not api"`) | 72 | pass |
| Web unit and component (Vitest): every control's JSON Patch, the API client's waiting rules, formatting, picker grouping, schema checks | 29 | pass |
| Playwright journeys (A01, S02, G01) | 3 | pass, on `localhost:3000` and through Caddy on the LAN address |
| Playwright screens (phone and desktop) | 2 | pass; 34 screenshots |

CI (`.github/workflows/ci.yml`, not yet run on GitHub: nothing is pushed):
- the API schema is current and the generated types match it;
- Python unit tests;
- web typecheck, lint, tests and build.

## Lighthouse (planner, `/`)

Lighthouse 13.0.1, default mobile profile (Moto G Power emulation, 4× CPU slowdown, simulated slow 4G), Playwright's Chromium, against `next start` on this laptop. Report: [lighthouse/planner-mobile.report.html](lighthouse/planner-mobile.report.html).

| Category | Score |
| --- | --- |
| Performance | **63** |
| Accessibility | **100** |
| Best practices | 100 |
| SEO | 100 |

First contentful paint 0.9 s, largest contentful paint 2.7 s, total blocking time 5.3 s, cumulative layout shift 0, speed index 4.8 s. Almost all the blocking time is MapLibre on the main thread: parsing the 1 MB library, creating the WebGL context and building the style. Performance is reported, not gated (amendment 10). Section "Left out" has the obvious next steps.

## Bundle size (first load, `next start`, measured in the browser)

| Page | JavaScript over the wire | Unzipped | Files | CSS | Tiles on first view |
| --- | --- | --- | --- | --- | --- |
| Planner `/` | 486 KiB | 2,222 KiB | 14 | 14 KiB | 203 KiB |
| Share page `/s/{slug}` | 488 KiB | 2,244 KiB | 15 | 14 KiB | 190 KiB |
| Saved routes `/routes` | 176 KiB | 578 KiB | 10 | 14 KiB | 0 |

The largest pieces are the MapLibre library chunk (1,066 KiB unzipped) and its worker (538 KiB). The basemap is one 226 MB PMTiles file, read by range requests; a first view of Kozhikode fetches about 200 KiB of it.

## API changes made (all approved; the solver unchanged except P3)

| # | Change |
| --- | --- |
| A1 | CORS for the front end's origins (`ATHLETE_CORS_ORIGINS`) |
| A2 | GPX: the end of a loop or out-and-back is "<start> finish"; `?ele=false` leaves out `<ele>` |
| A3 | Typed diff (`DiffOut`), same JSON |
| A4 | Every fix and saving carries its JSON Patch. Dropping a stop is `test` + `remove`, so a stale tap gets 409 |
| A5 | Elevation response: a position for every profile sample and every whole km |
| A6 | `osm_ways` and `osm_boundaries` from the pinned extract (migration 0003, `load_osm_features.py`: 497,563 ways, 13,509 boundaries, about 3 min). `GET /v1/features/item` and `/v1/features/nearby`. `/v1/health` reports `osm_features` |
| A7 / P1 | Elevation response: `smoothed`, the solver's own series |
| A7 / P2 | `climb_approximate` (median DEM height under 20 m) on every candidate, the elevation response and the route GeoJSON |
| P3 (solver) | Climb bridges bridge edges before smoothing. `Candidate.bridges_m` is stored in `routes.bridges_m` (migration 0004) |
| Tooling | `export_openapi.py` (CI check), `measure_climb.py`, `compare_routes.py`; compose: `ATHLETE_CORS_ORIGINS` and a `proxy` service (Caddy, profile `web`) |

Elevation decisions and numbers: [elevation.md](elevation.md).

## Screens

Every screen at 390×844 (`phone-*`) and 1440×900 (`desktop-*`) in [screenshots/](screenshots/):
1. empty planner;
2. place picker (Kadalundi: village, boundary and station grouped);
3. A01 results;
4. stops list with distance marks;
5. route detail with the chart cursor on the map;
6. over_budget;
7. its savings;
8. after a fix (the diff);
9. saved, with the share link;
10. share page (logged out);
11. saved routes;
12. the S02 loop;
13. the G01 conflict;
14. loading, with the old route dimmed;
15. 429 busy, with backoff;
16. engines down;
17. 504 timeout, polling.

Screens 14 to 17 are **mocked**: the test intercepts the API's answer, because the live stack does not produce those states on demand. The 409 plan_solving wait is covered by the client's unit tests, not by a screenshot.

## Findings (not fixed: solver or data)

1. **G01's "Change to 22.2 km" fix is not enough.**
   - The solver sets it to twice the walking distance to Feroke.
   - The loop through Feroke then needs 26.2 km, so the result is `over_budget`, 4.0 km over, with a full route, a cut and "Drop Feroke".
   - The UI shows that correctly, and the test asserts it.
   - A fix value that fits would need a solver change.
2. **`make_optional` does nothing.** The solver never reads `Checkpoint.mandatory`, so the API gives that fix no patch, and the UI does not offer it.
3. **Message grammar.** The solver's loop message says "these 1 stops".
4. **Malayalam map labels.** MapLibre cannot shape Malayalam script, so OSM names stored only in Malayalam render with broken shaping. English names, the usual case in Kerala OSM, are fine.

## Fixed during the phase (found by the tests)

- The distance box re-sent an unchanged value when it lost focus. That undid a fix button tapped right after it.
- On a phone, "pick on the map" tapped through the sheet. The sheet now steps aside while picking.
- With no route (a conflict), the map kept the last route's km marks and did not move to the request. It now clears them and shows the start and stops as asked.
- Routes were fitted under the sheet; the fit now measures the sheet.
- A deviation of −18 m displayed as "−0.0 km"; it now shows "±0.0 km".
- Adding stops quickly could close the adder before the previous stop was added.

## Left out

- **Later phases:** chat (Phase 6), drag-to-edit (Phase 7), offline mode, login (Phase 8).
- **By decision (amendment 11):** deleting a saved route; "Remix this route" on the share page.
- **Not done:**
  - **A map on the saved-routes page.** It is a list; each route opens its share page, which has the map.
  - **Desktop "compare" with up to four cards side by side.** The cards stack, and every candidate is on the map.
  - **Performance work.** Options: lazy-load MapLibre after first paint, or a smaller style.
- **Not measured:**
  - **Memory** with the web server, Chromium and the whole stack running together. Everything ran on this laptop during the tests, with no failure, but it was not sampled.
  - A real phone (yours to do, [phone.md](phone.md)), Garmin and Strava import of the new GPX files, and the hallway test.
- **Not changed:** the KPI harness's relative-path crash (Phase 4 note).
