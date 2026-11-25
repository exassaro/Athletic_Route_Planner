# Athlete Router

A running route planner: distance-budgeted, direction-aware routes with mandatory checkpoints. `docs/blueprint.md` is the source of truth for architecture and algorithm decisions. Read it before making design choices.

## Working rules

- **Blueprint first.** If you disagree with something in the blueprint, say why and wait. Do not quietly do something else.
- **Phase by phase**, following blueprint section 15. **Step 9** (2026-11-25, cross-device link, launch hardening, CI/CD; blueprint Step 9 amendments 1 to 9) is built: `docs/reports/step9/summary.md`; open: deploying it (RUNBOOK, "Step 9 update"), branch protection (`docs/ci-cd.md`), a phone scanning the QR code. Before it: **Phase 5d**, route fidelity and Follow mode (blueprint Phase 5d amendments 1 to 15), with Phase 5e amendments 1 to 6 (planning and a run survive a refresh). Built: `docs/reports/phase5d/summary.md`. Open: the rest of the Phase 5e brief (cut off after "Fail the build"; faster reload and the bundle budget in CI are not built), and the device tests listed in that summary. Phase 5c (managing saved routes) is built: `docs/reports/phase5c/summary.md`. Phase 5b (the GATHO redesign and its fix round) is built: `docs/reports/phase5b/summary.md`, `fix-summary.md`. Open: the hallway test (`docs/reports/phase5b/hallway/script.md`), and the shared per-IP limits behind Caddy (a separate change). Phase 5 (the web front end) is built: `docs/reports/phase5/summary.md`. Phase 4 (the API in `api/`) is built: `docs/reports/phase4/summary.md`. No LLM chat (Phase 6), no drag-to-edit (Phase 7). **The solver's behaviour must not change**, and a front-end need that requires an API change is listed and approved first (A8, the GPX creator name, is approved).

## Step 9 amendments (2026-11-25, full text at the top of docs/blueprint.md; they win over earlier ones)

1. **Several tokens per client:** migration 0006 `client_tokens`; a token is valid in `clients.token_hash` or there.
2. **A16 `POST /v1/session/link`** (token): one-time code, 192 bits, 5 min, Redis only as its sha256; 10/h per client. **A17 `POST /v1/session/claim`** (no token): GETDEL, new token for the same client; 10/min per IP; one 404 `link_invalid`.
3. **`/link#<code>`**: the code only in the fragment, cleared with replaceState; warn a browser with its own saved routes; never delete; old token kept as `athlete.token.previous`.
4. **A18 health:** detail only with `X-Health-Key` = `ATHLETE_HEALTH_KEY` (empty = never); others get `status`, `features`, `map` (sha256 ids, 16 hex). `ATHLETE_DOCS=false` in production.
5. **Sessions:** 60/h per IP, 120/min in all; the web makes one per browser (Web Lock `gatho:session`).
6. **Busy states:** solver_busy countdown + Cancel, 3 retries; rate_limited no retry; 503 and 504 in plain words (504 polls first).
7. Caddy's access log deletes `X-Client-Token`, `X-Health-Key`. 8. **First-load JS budget** (`web/bundle-budget.json`, `npm run check:bundle`); one-screen code loads with `import()`.
- **A push to `main` deploys Vercel**: update the VM first when the web needs a new API. `docs/ci-cd.md`: CI jobs, branch protection, Vercel, the optional manual `deploy-server.yml` (off until its secrets exist).

## Production (Phase 8a, 2026-11-24): one VM, split origin

Front end on Vercel (https://gatho.shahinsha.xyz); the VM serves the API and `/basemap/` at https://api.gatho.shahinsha.xyz. Runbook: `deploy/RUNBOOK.md`; costs: `deploy/COSTS.md`.

- **VM:** AWS EC2 m7i-flex.large, ap-southeast-2 (Sydney), 2 vCPU, 7.6 GiB RAM + 4 GiB swap (swappiness 10), 36 GB free disk, Ubuntu 24.04, user `ubuntu`, Elastic IP 54.252.91.95. AWS free plan ($120 credit, ends 2027-05-24, never "Upgrade"). Stop it when idle.
- **`deploy/docker-compose.prod.yml` is standalone** (an override cannot remove the dev ports), project `athlete-prod`, containers `athlete-prod-*`, API image `athlete-api:prod` (`:rollback` = the previous one). Only Caddy publishes 80/443. Always with `--env-file deploy/.env.prod` (`source deploy/lib.sh` gives `dc`). Never run it on the laptop beside the dev stack.
- **First-run order** (`deploy/first_run.sh`, resumable): extract (`--from-backup`), basemap, Photon index -> images -> postgres, redis -> migrations -> `load_osm_features.py` (one-off container, `--memory 2g`: it peaks at 1,337 MiB, above the api's 1 GiB) -> Valhalla build (Photon and GraphHopper stopped) -> `configure_valhalla.py` (run in the API image: the files are root's) + restart -> GraphHopper import -> Photon -> API -> Caddy -> `health.sh`. Photon `depends_on` healthy Valhalla and GraphHopper, so a bare `up -d` cannot start it beside the tile build.
- **The basemap archive cannot be fetched any more** (Protomaps build 20261115: 404 on 2026-11-24): copy `data/basemap/kerala-20261115.pmtiles` to the VM; `fetch_basemap.py` checks it and needs the pmtiles CLI (Linux one now pinned too) only to extract.
- **Caddyfile.prod** = web/README.md "Split origin": `/basemap/*` with Allow-Origin the front end, preflight 204 (`Range`), exposes ETag/Content-Range/Accept-Ranges/Content-Length, `no-store` on `.pmtiles`, fonts and sprites 30 days immutable; compression for JSON only; 1 MB bodies; access log rotated (50 MiB × 10, 30 days). The API's CORS stays FastAPI's (`ATHLETE_CORS_ORIGINS`). `ATHLETE_TRUST_FORWARDED_FOR=true` and `FORWARDED_ALLOW_IPS=*` (only Caddy reaches the API).
- **Memory limits (MiB)**, measured use from the laptop: graphhopper 4096 (2113), photon 2560 (523; was 3072 in dev), valhalla 2048 (541 serving; build peak not measured), api 1024 (125), postgres 512 (133), redis 320 (5), caddy 256. Sum 10,816 = 10.6 GiB: above RAM, below RAM + swap; working set about 3.5 GiB.
- **The API image needs `libexpat1`** (osmium's modules link it; python:3.12-slim lacks it, so `import osmium` failed on the VM). Check a new native dependency with `ldd` over every `.so` in `/app/.venv`, inside the image.
- **Caddy's mounts go stale** when `web/public/basemap` or `Caddyfile.prod` is replaced on the host (a 404 map after first_run): `deploy/lib.sh` `refresh_caddy [force]` recreates it and checks `/srv/basemap/kerala.pmtiles`; first_run, update and health use it. Test it in Git Bash with `MSYS_NO_PATHCONV=1` (else `docker exec` paths are rewritten), and note Docker Desktop shares mounts by path, so the stale case only shows on Linux.
- **Health key:** `gen_secrets.sh` writes `ATHLETE_HEALTH_KEY` (`--add-health-key` for an old file); `health.sh` and `smoke.sh` read it from `.env.prod` or the environment.
- Backups: `pg_dump -Fc` without the OSM tables' rows (restore.sh reloads them), `/home/ubuntu/backups`, 7 kept, cron 18:30 UTC.
- `deploy/test_caddy.sh` checks the Caddyfile locally (fake basemap, Python stand-in API) on **127.0.0.1:18080**: something else on this laptop listens on `[::1]:8080`, so `localhost:8080` reaches it. Output: docs/reports/phase8a/caddy_local_test.txt. Deploy files are `eol=lf`.

```
bash deploy/bootstrap_vm.sh   # on the VM, once; then log in again
bash deploy/gen_secrets.sh    # deploy/.env.prod (600, gitignored)
bash deploy/first_run.sh      # in tmux
bash deploy/health.sh         # anywhere; PUBLIC_URL=... SKIP_API=1 for the basemap rules only
bash deploy/smoke.sh          # session, A01 plan, save, GPX, share API and page, delete (KEEP=1 keeps it)
bash deploy/update.sh | backup.sh | restore.sh <dump>
bash deploy/test_caddy.sh     # laptop, Docker running
uvx --from shellcheck-py shellcheck -x deploy/*.sh
```

## Phase 5e amendments (2026-11-22 and 2026-11-23, full text at the top of docs/blueprint.md; they win over earlier ones)

1. **The address holds a computed plan:** `/?plan=<id>&v=<n>&r=<candidate>[&edit=<saved_id>]`, replaceState. On load that version is read and shown as a fresh result. **A restore never solves.**
2. **sessionStorage `gatho:draft:v1`** keeps the setup, the sheet, the open editor, the map's view and the plan's pointer, for this tab. **No geometry, no GPS position, no token**: stops keep their OSM ids and are built again by the API. A "My location" start is not kept. 300 ms debounce, flushed on pagehide; 12 h; anything unreadable is a clean start.
3. **"Plan a new run"** (menu) and "New run" (sheet) clear it, with Undo for 10 s. No beforeunload prompts.
4. `overscroll-behavior-y: contain` on html. 5. The elevation chart loads with the first route (LazyRouteDetail).
6. **A run survives a refresh in its tab:** sessionStorage `gatho:run:v1` = metres done, start time, pauses (+ schema, route id, a stopped mark). **No coordinates, no time of the last fix, no gaps.** The tracker assumes the earliest time those metres could be reached. "Carry on" asks for the location again. Cleared by Done and "Plan a new run".
- The setup is remounted only when a stored step or draft comes back: a remount on every load made Lighthouse's largest paint wait for every script (planner 55 instead of 69; a `restore` test guards it).

## Phase 5d amendments (2026-11-22, full text at the top of docs/blueprint.md; they win over earlier ones)

1. **Google Maps is an overview, the GPX is the exact route.** `travelmode=walking`; **3 waypoints on a mobile browser, 9 elsewhere** (`waypointLimit(thisDevice())`, narrow = under 900 px).
2. **A14** `GET /v1/routes/{id}/overview-points?max=N` and `/v1/share/{slug}/overview-points`: greedy waypoints against Valhalla's path, `overlap_pct` **leg by leg**; cached by route, N, Valhalla build; 503 → even km marks. Above 95 % the sheet says "over 95%".
3. "Open in...": "Get GPX (exact route)" first, Google Maps (overview) with "Estimated overlap: n% (tested with our router, not Google)", My Maps steps (a computer only), Garmin and Strava notes.
4. **`/follow?saved=|route=|share=`**, same tab, from the route card, saved card and share page. A visitor never gets a session. Foreground only, HTTPS.
5. In Follow only, the UI may compute the position along the route (snapped, metres interpolated from the API's), the straight line back and its bearing. Never sent or logged.
6. **A15** `GET /v1/routes/{id}/follow` and `/v1/share/{slug}/follow`: vertices, metres at each, cues (35° within 20 m, at a junction within 15 m, merged under 50 m); always 200.
7. **Location never leaves the device.** No request may depend on a position: the corridor's tiles load before the run and are served from memory; the Follow style has no glyphs URL. The `follow` tests record every request during a run and fail on any.
8. Progress = snapped distance, forward-only window (5 m/s × T + 100 m after a gap). 9. Off route: > 40 m for 10 s and two fixes under 30 m; 200 ms buzz.
10. Screen lock: "Finding you...", one fresh fix (maximumAge 0, 15 s), the gap line, gaps in the summary. 11. Back during a run asks "Stop this run?".
12. HUD: km done, left, time, pace in pixel numerals with `data-value`, "along the route". 13. **Voice cues:** off by default, English, only an on-device voice (`localService`), never the browser's default unless it is one.
14. The sneaker stays still in Follow; battery saver = near-black, no map animation. 15. Gates: Lighthouse through Caddy, a11y 100; Follow code not in the first load of `/`.

## Phase 5c amendments (2026-11-22, full text at the top of docs/blueprint.md; they win over earlier ones)

1. **Soft delete with Undo.** A deleted slug answers exactly as an unknown one (404, same body, same page, `no-store`). Routes and plan versions are never deleted. Purge by hand: `uv run python -m athlete_api.purge_deleted --days 30`.
2. **Edit = `/?edit=<saved_id>`**: the saved route's own plan version, shown as a fresh result. Then "Update <name>" (same slug, with Undo) or "Save as new". "No changes yet" compares request and geometry, never route ids (undo makes new ones).
3. **Rename** = in-app dialog + PATCH: trimmed, ≤ 80 characters, empty = null. Never `window.prompt`.
4. **Owner only:** another client's `saved_id` is 404, never 403.
5. **Migration 0005.** `updated_at` moves on rename and update, not delete or restore. **The downgrade deletes soft-deleted rows first** (never republish a deleted link).
6. **A10:** `PATCH`, `DELETE`, `POST .../restore` on `/v1/me/routes/{saved_id}`; the list hides deleted ones, newest update first.
7. **A11 `from_version`** on `PATCH /v1/plans/{id}`. Always send it when editing an opened version: without it the patch applies to the latest, a different request.
8. **A12 `as_new`** on save. Several saved routes may point at one route: never assume one row per (client, route).
9. **A13 `is_owner`:** the share page is server-rendered without a token; the browser asks again with the token it has and must never create a session for a visitor.
10. **"write" limit:** 60 a minute per client, none per IP. `limited()` refuses unknown bucket names.
11. Delete = the one warning colour, trash icon, divider, last. 12. Delete's Undo: 10 s, paused under pointer or focus, survives the move to `/routes`.

## Phase 5b amendments (2026-11-18, fix round 2026-11-22; full text at the top of docs/blueprint.md; they win over earlier ones)

1. Name **GATHO** in the UI, manifest, titles, share page, OpenGraph and about; Python packages, repo and API paths unchanged.
2. Playful retro, minimal: at most three retro elements per screen (wordmark, pixel numerals, markers, hard shadow); pixel icons are the icon style.
3. Pixel font (Silkscreen, self-hosted subset; replaced Pixelify Sans, whose "5" reads as "S") only for stat numbers ≥ 24 px; **never the wordmark** (drawn from grids, 26), body, labels, place names or Malayalam. Body: system font, 15 to 16 px.
4. Accent **#0F6E56** (dark #3DBFA3), one amber warning colour, second route dashed in ink.
5. **Light and dark themes, toggle in the menu, default light.**
6. Start pin = the supplied pixel **sneaker**, also the mascot and (as four column-shifted frames) the loading animation; the runner is withdrawn. Exact strings: `docs/reports/phase5b/sprites.md` (never edit by hand). Build-time static SVG, crispEdges; CSS-only hop on an inner element, by rule 13; none with reduced motion; paused while the map moves or a solve runs.
7. App icons show the GATHO O (27). The sneaker is the pin and mascot only.
8. Bottom sheet (peek, half, full), five-step setup, chips as editors, route cards, stops timeline, one-headline conflicts, Undo message.
9. The number check runs at every sheet state; A01, S02, G01 keep their intent.
10. Lighthouse accessibility ≥ 95; touch targets ≥ 44 px; performance measured before and after through Caddy (`https://<LAN IP>`), median of three runs. **The start pin has no main-thread cost at rest** (resting = pin removed).
11. A8 (GPX `creator="GATHO"`, metadata name "<course> · GATHO"; an API change) approved and built (step 10).
12. **PMTiles: never through the browser cache.** Chrome on Windows returns zero-filled bodies for cached Range responses after overlapping requests are aborted ("Wrong magic number"). pmtiles guards against it only when the UA says "Windows", which device emulation removes. Keep both halves: `basemapArchive` (fetch `no-store`) and the `no-store` header in `next.config.ts`. `no-cache` does not work. One retry, then "Reload map".
13. **Pin rule: 3 hops** when a route arrives, the start changes or a saved/shared route opens; 1 per tap; then rest. **No continuous loop anywhere** (the loading cycle exists only during a solve).
14. Km labels from zoom 12; markers reserve their space in label placement; place names step aside; the end flag flies away from the route.
15. Undo message is part of the sheet, above it; peek stats only at peek; the chip row fades.
16. Mascot = sneaker at 3 px a pixel. 17. Loading = 4 frames made by shifting whole columns, never redrawn.
18. **Directions in words** with a map-relative hint and a dial; API values unchanged. The only UI bearing is `bearingToPlace`, for that label; never send or store it.
19. **Pixel compass** under the menu: true north, tap = north-up, marks the direction being picked.
20. **"Open in..."** (replaced by Phase 5d amendments 1 to 3): Google Maps (3 waypoints on mobile, 9 elsewhere, from A14), Share GPX (Chromium refuses `.gpx`: download and say so), Download, help links for Garmin and Strava. No Garmin button, no Strava upload link (courses have no timestamps). Never promise what we can't do.
21. The share page is the saved-route view: the planner's sheet at peek, a "Map" button, a collapsible desktop panel.
22. A9 (share response `km_marks`, additive) approved and built.
23. `web/scripts/make-brand.mjs` draws every brand asset from `web/brand/logo.json`. 24. Logo colours are tokens.
25. Light wordmark always on `--surface` (3:1); the dot on the icon's tile is exempt. 26. The wordmark is never set in a font, ≥ 14 px, else the icon.
27. Icons 9 × 9 (maskable 11 × 11; Apple 180 full square). 28. OpenGraph image 1200 × 630; absolute links need `NEXT_PUBLIC_SITE_URL` at build.
- Phase 5b measurements go through Caddy on the LAN address, because the running `next start` is the same-origin LAN build. `SHOTS_DIR` sets where `e2e/screens.spec.ts` writes.

## Phase 5 amendments (2026-11-18, full text at the top of docs/blueprint.md; they win over earlier ones)

1. Next.js (App Router) + TypeScript + MapLibre GL JS. Share page server-rendered; planner client-side.
2. API types generated from OpenAPI (openapi-typescript + openapi-fetch); never hand-copy RouteRequest or SolveResult. CI fails on stale types.
3. Basemap: self-hosted PMTiles for Kerala, built with Planetiler from the pinned extract; fonts and sprites self-hosted; OSM attribution always visible.
4. The current RouteRequest is the single source of truth. Every control edits it and sends a JSON Patch to PATCH /v1/plans/{id}. **The UI never computes a route, a distance, a position along a route or an endpoint.**
5. Running time = foot length × the user's pace (browser storage, default 6:00 /km), labelled "at your pace". The engine's walking duration is hidden.
6. Mobile first: full-screen map with a bottom sheet; side panel on desktop.
7. API changes approved: A1 CORS, A2 GPX finish name + `?ele=false`, A3 typed diff, A4 fix patches, A5 positions along the route, A6 OSM features lookup (`osm_features` from the pin). A7 (smoothed profile, noisy-climb flag) waits for `docs/reports/phase5/elevation.md`; a change to the solver's gain/loss is a separate decision.
8. Place picker groups duplicates by name and county, in the UI.
9. Production is one origin behind Caddy (also HTTPS on the LAN); CORS is for development.
10. Lighthouse: accessibility ≥ 90 is a gate; performance is reported.
11. Left out: deleting saved routes (built in Phase 5c), "Remix this route".
12. Basemap = `pmtiles extract` of the Protomaps build of 2026-11-15 (the pin's day), not Planetiler.
13. Solver `climb` bridges bridge edges (straight line between their ends) before smoothing; `Candidate.bridges_m` carries the spans. Approved solver change (P3); routes unchanged.
14. Elevation endpoint returns the solver-smoothed profile (P1). 15. `climb_approximate` when the route's median DEM height < 20 m (P2).
- **Plan first.** Give a plan and wait for approval before writing code.
- **Small steps.** Each step ends in something the developer can run and check. Commit after each step.
- **No invented distances.** Never hardcode or estimate a distance. Every distance comes from the routing engine or from measuring geometry (`athlete_engine.geodesy`). The leg distances in the blueprint's section 8 worked example are made up: never use them as test expectations. Straight-line distance is allowed only for snap distances and pre-filters and must never be presented as a route distance.
- **Coordinates come from data.** Place coordinates are read from OSM (with their OSM ids) or supplied by the developer, not typed from memory.
- Reports state where numbers were measured (this laptop, not the target server).

## Phase 4 amendments (2026-11-18, full text at the top of docs/blueprint.md; they win over earlier ones)

1. **The API exposes the solver's models as they are**: RouteRequest, SolveResult, Candidate, Conflict, Flag. Blueprint sections 11 and 12 describe what is built.
2. **Stack**: FastAPI, Pydantic v2, SQLAlchemy 2 + Alembic, PostgreSQL 16 + PostGIS, Redis, in docker-compose, managed by uv.
3. **Solves run in a worker thread.** At most 2 at once (configurable). A request waits up to 10 s for a slot, then gets 429 with `Retry-After`. Each solve has a 15 s budget; over it, 504.
4. **Tables:** `plans`, `plan_versions` (request JSON, source form|chat|drag, outcome, conflict, both engine build ids), `routes` (LineStringZ, every Candidate stat and flag), `saved_routes` (share slugs). **Lengths stored are the solver's**; `ST_Length(geography)` only as a test cross-check.
5. **Cache in Redis for 24 h**, keyed on: the canonical request, the Valhalla build id, the GraphHopper build id and the solver source hash (11).
6. **PATCH applies an RFC 6902 patch to the RouteRequest.** It re-solves, stores a new version and returns a diff:
   - fields changed;
   - length delta and duration delta;
   - whether the end changed;
   - stops added or removed.

   Undo is `replace` at path `""` with an earlier request.
7. **Clients are anonymous tokens** from `POST /v1/session`, sent in `X-Client-Token`. Login comes in Phase 8. Rate limits apply per client and per IP.
8. **Geocoding goes through Photon only**, biased to a point and restricted to Kerala.
   - Ambiguous results (shared names, other districts) are all returned for a picker; the API never picks.
   - Photon down means 503. There is no other source of coordinates and no places cache.
9. **GPX 1.1 course**: a track with elevation, plus waypoints for the start, each checkpoint (where the route passes it) and the end. Validated against the XSD in tests.
10. **Explanations** come from templates, using only numbers already in the SolveResult (facts, conflict, candidate stats). The facts object is passed through unchanged. A saving of 0 m reads "dropping X does not shorten the run".

Implementation choices (accepted 2026-11-18):
11. `duration_s` is the engine's **walking** time, passed through and labelled as such. No pace estimate yet.
12. A 504 carries the plan id and a URL to poll. The solve keeps its slot until it finishes, then stores and caches its result. Partial routes would need a solver change.
13. The queue wait and the solve budget are separate: worst case about 25 s.
14. Results with `alternative_unavailable` are not cached. The cached value includes elevation, so a hit makes no engine call.
15. Elevation comes from one Valhalla `/height` call made by the API (Z = raw DEM; profile every 30 m). Gain and loss shown are always the solver's.
16. No `users` (`clients` instead), no `places`, no `route_stops` tables. Other clients' plans and routes return 404.
17. One uvicorn worker; the solve limit is per process.
18. "Same result" means the same outcome, candidates, conflict, facts and flags, ignoring `elapsed_ms`, `engine_calls` and `edge_ids` (not exposed).
19. Photon stays up during development (measured; see `docs/reports/phase4/memory.md`). Tests use a fake geocoder.
20. Phase 6 adds `/messages`; Phase 8 adds login.

Phase 4 facts:
- **`ST_Length` on a geography `LINESTRING Z` counts the Z changes** (PostGIS 3.4). The `routes.geom` Z is the DEM height, so a cross-check must use `ST_Length(ST_Force2D(geom::geometry)::geography)`. With that, A01 agrees with the solver to about 1e-8 m.
- Postgres is on host port 5433, because a native Windows PostgreSQL holds 5432.
- Photon returns no relevance score. Its `county` is a district or a taluk. OSM often holds the same place several times, so most names come back `ambiguous` and the picker shows.
- The Kerala bounding box for Photon is the pinned extract's own, from GraphHopper `/info`, with `state == "Kerala"` as the real filter.
- **Solves are about three times faster inside Docker than from the host**: point-to-point p50 515 ms in the API container, 1.80 s for the KPI harness on the host. Every engine call from the host crosses Docker Desktop's port forwarding. Compare latencies only when they were measured from the same place.
- Create and PATCH build their response from the objects they have just stored; the GET endpoints read the rows. Tests check that both agree.
- `tests/kpi/run_kpi.py` crashes on its final print when `--report` is relative. Pass an absolute path; the report is written either way.

## Phase 3 amendments (2026-11-17, full text at the top of docs/blueprint.md; they win over Phase 2)

1. **Generator: GraphHopper foot + custom model** ("recommended"). **Valhalla is the single yardstick**: road classes, checkpoint checks and the access check (map_snap coverage + OSM tags) go through Valhalla matching; lengths come from geometry.
2. **Road priority (preference, not a hard rule):** ordinary drivable roads (incl. service roads beside highways) > primary (mild penalty) > trunk/motorway (last) > footway/path/track/steps (only when nothing else connects, or `paths: "allow"`). One-way ignored. Trunk/motorway use → flag "uses a national highway; running there may be prohibited" (name from `ref`). `foot=no` is a hard exclusion; motorways stay unwalkable unless tagged `foot=yes`.
3. **Checkpoints are "pass near" by default.** The route passes within 1 km of the place point, measured as straight-line proximity to the Valhalla-matched route, with no spur (dead-end excursion > 100 m). Fallback: inside the place's OSM boundary, flagged. `must_reach` keeps the old `break` behaviour (50 m of the snapped point). Bridge and named-road checkpoints mean the route uses them (same as `must_use`).
4. **Ferries always excluded.** No opt-in, no ferry fixtures.
5. **Tolerance ±500 m** (replaces 2%). Distance-accuracy KPI unchanged.
6. **`over_budget` outcome** when the stops alone exceed D + 500 m: the full route (ends at the last stop), the overshoot in metres, a "cut at target" candidate, and the savings list. Disconnected and snap-too-far stay conflicts.
7. **Request fields `via`, `avoid`, `must_use`.** A `via` is shaping only: never dropped, not a listed stop. Edits hold the distance by moving the endpoint.
8. **Repetition limit applies beyond what `must_reach` stops force. Consistency check: 0.1% / 2 m plus 0.2 m per edge.**
9. **Alternatives: "recommended" (GraphHopper, rules above) and "shortest" (Valhalla pedestrian).** "Fewer main roads" is dropped.

After the rules spike (`docs/reports/phase3b/rules_spike.md`, accepted 2026-11-17):

10. **Model R5**: primary ×0.6, trunk/motorway ×0.1, paths ×0.1 (1.0 with `paths: "allow"`), on GraphHopper profile `foot_rules`.
11. **Pass-near = walking distance ≤ 1 km** (Valhalla matrix to sample points every 100 m on the route); straight-line only as a pre-filter.
12. **NH flag at ≥ 200 m of trunk/motorway in one stretch**; shorter = "crosses a national highway" note.
13. **Order on the Valhalla matrix.** 14. **One request per run** (GraphHopper relaxes `pass_through` at dead ends).
15. **Consistency check uses the engine's own radius** (GraphHopper 6,371,000 m) plus 0.2 m per edge.
16. **Boundary fallback** when a checkpoint carries its OSM boundary; otherwise least-added candidate with a spur, flagged.
17. **Junction** = through via at the junction; **bridge / named road / must_use** = route uses one of the item's OSM ways.

Acceptance test: Athanikkal towards Kozhikode, 25 km, passing near Kottakadavu, Kadalundi, Chaliyam, Karuvanthuruthy bridge, Beypore and Kallayi. It must follow that order, take no spur into Chaliyam's beach end, use no ferry, and repeat under 2% of its road. Report the measured length; if it is over 25 km, show `over_budget`. Names come from OSM or Photon. If one can't be found, stop and ask. Plus 10 fixtures outside Kozhikode (Kochi, Thiruvananthapuram, Thrissur, Kannur, Wayanad).

Phase 3c (2026-11-17, blueprint amendments 21 to 23):

21. **Loops now, solver only**: step 10 lengthening first, then loops and the loop KPIs. Phase 7 keeps the blind test, scenic, drag-to-edit, per-area circuity.
22. **Loop distance**: hard rule ±500 m; iterate until within min(500 m, 3% of D).
23. **Loops are generated by GraphHopper R5**; the 2 best-scored loops overlapping under 60% are returned; Valhalla only measures. GraphHopper down: Valhalla generates, flagged.
24. **Loops with stops**: closed tour on the walking matrix; lengthen the longest leg; only if no detour there passes the loop rules, the other legs, longest first.

## Decisions from Phase 2 (also in docs/blueprint.md; amended above where they conflict)

1. **Ferries are hard-excluded** with `exclude_ferries: true`. Never rely on `use_ferry: 0`. (Phase 3 amendment 4 removed the opt-in.)
2. **Every distance shown and every cut uses ellipsoid geometry length.** The engine consistency check compares engine length with a spherical measurement of the same geometry: threshold 0.1%, floor 2 m.
3. ~~MVP alternatives "direct" and "fewer main roads"~~: replaced by Phase 3 amendment 9.
4. **Geocoding is Latin script only** for the MVP.
5. **`must_reach` checkpoints are `break` locations**; `through` is for shaping vias and pass-near points. `must_reach` compliance is measured against the snapped point.
6. **Engine warnings** (e.g. code 401, relaxed restrictions) are carried into results as flags.

Also agreed: conflict savings are routed and measured, not matrix sums; ordering by exact DP (no OR-Tools); cut snaps to a junction only within 0.5% of the target; every truncated candidate is re-routed as one engine request; via-point lengthening (section 8 step 10) comes after the point-to-point KPIs, before loops.

## Pinned graph

`engine/osm_pin.json` names the extract every fixture was measured on (Kerala, 2026-11-15). The upstream file changes daily. Expected values in fixtures come from running the engine on this pin, and the KPI harness refuses to run if `data/manifest.json` has a different timestamp. Backup: GitHub release `osm-kerala-2026-11-15` (restore with `fetch_extract.py --from-backup`).

## Developer and machine

Solo developer, comfortable with Python and Next.js. Windows 11, Intel i5 10th gen, 16 GB RAM (Windows reports 16,221 MiB), Docker Desktop (WSL2 VM: 7.7 GiB + 2 GiB swap, measured 2026-11-18). With every service and Photon up, the VM uses about 3.7 GiB. Free memory on Windows itself is the tight part (1.2 to 2.2 GiB free). Do not run the Valhalla tile build and Photon at the same time. Test region: Kozhikode, Kerala.

## Stack

- Routing engines: Valhalla in Docker (`ghcr.io/valhalla/valhalla-scripted`), pedestrian costing, elevation tiles (the yardstick, "shortest"); GraphHopper 11.1 (the "recommended" generator).
- Data: Kerala OSM extract from download.openstreetmap.fr, pinned in `data/manifest.json`.
- Geocoder: Photon with the prebuilt India index (Compose profile `geocode`).
- Python 3.12 managed by uv: httpx, pyproj, shapely, osmium (pyosmium), pytest.
- API (Phase 4): FastAPI, Pydantic v2, SQLAlchemy 2 + Alembic, PostgreSQL 16.4 + PostGIS 3.4, Redis 7.4 (both pinned by digest in docker-compose).
- Later phases (not yet): Next.js, MapLibre.

## Layout

- `engine/athlete_engine/` Python package: engine client, polyline codec, geodesic measurement. Coordinates are `(lon, lat)` everywhere.
- `engine/scripts/` data fetch and fixture scripts. `engine/experiments/` numbered Phase 2 experiments.
- `engine/valhalla/`, `engine/photon/` container configuration.
- `docs/reports/phase2/` generated reports and GeoJSON.
- `tests/unit/` no network (`tests/unit/api/` for the API). `tests/api/` the API on Postgres and Redis, no engines. `tests/integration/` needs Valhalla running (and the whole stack for `test_api_*`). `tests/fixtures/` coordinates with OSM ids.
- `data/` is gitignored (extract, tiles, index).
- `solver/athlete_solver/` solver package with a CLI (`python -m athlete_solver`): `models` (request, candidate, conflict), `engine` (Valhalla adapter, the yardstick), `graphhopper` (the "recommended" generator, model R5, measured by Valhalla), `passnear` (checkpoints into route points), `avoid`, `ordering`, `p2p` (base route, gate, cut, truncation), `lengthen` (section 8 step 10: one through via on the longest leg; fixed ends), `loop` (loops without stops: shapes through the start, scaled to the distance, vias pulled out of water and off dead-end stubs), `out_and_back`, `scoring` (hard rules, NH flag, diversity), `solve` (both alternatives in parallel). It calls Valhalla only through `athlete_engine`.
- `tests/fixtures/scenarios/` solver scenarios (section 16); `docs/reports/phase3/` Phase 3 KPI report and the quieter spike; `docs/reports/phase3b/` Phase 3b KPI report and the rules spike; `docs/reports/phase3c/` Phase 3c KPI report.
- `api/athlete_api/` the Phase 4 backend (FastAPI; module list in `api/README.md`). `api/alembic/` migrations. `api/scripts/` measurement scripts (`measure_memory.py`). `docs/reports/phase4/` its reports. `tests/api/api_fixtures.py` has a fake solver that returns A01's real result. `web/` is a placeholder for Phase 5. `deploy/` the production files for one VM (Phase 8a); `engine/caddy/Caddyfile.prod` its Caddy.

## Commands

```
uv sync                                  # create .venv and install dependencies
uv run pytest tests/unit                 # unit tests, no services needed
uv run pytest -m integration             # needs Valhalla on localhost:8002
uv run python engine/scripts/fetch_extract.py   # verify local extract against engine/osm_pin.json, write data/manifest.json
uv run python engine/scripts/fetch_extract.py --from-backup   # restore the pinned extract from the GitHub release
uv run python engine/scripts/<name>.py   # other data scripts
uv run python engine/experiments/<name>.py
```

Valhalla (Docker Desktop must be running; serves on http://localhost:8002):

```
docker compose up -d                        # Valhalla, GraphHopper, Postgres (host port 5433; 5432 is a native Windows PostgreSQL), Redis (6379)
docker compose up -d valhalla graphhopper   # Valhalla: first run builds tiles + elevation, about 7 min; GraphHopper: first run imports, about 3 min, about 2 GB
docker compose logs -f valhalla
uv run python engine/scripts/configure_valhalla.py   # apply engine/valhalla/overrides.json
docker compose restart valhalla          # needed after changing overrides
docker compose stop valhalla             # stop by name; never a bare `docker compose down` (see the dev stack rule below)
uv run python engine/scripts/build_fixtures.py       # place nodes -> tests/fixtures/places.json
uv run python engine/experiments/00_engine_check.py  # version + elevation sanity check
```

Experiments (reports go to `docs/reports/phase2/`):

```
uv run python engine/scripts/build_pairs.py             # regenerate tests/fixtures/od_pairs.json (seeded)
uv run python engine/experiments/01_primitives.py
uv run python engine/experiments/02_length_check.py
uv run python engine/experiments/03_latency.py          # restart valhalla first for a true cold call
uv run python engine/experiments/04_tag_coverage.py     # no engine needed
uv run python engine/experiments/05_worked_example.py
uv run python engine/experiments/05b_quieter_probe.py
```

Solver and KPI harness (Valhalla and GraphHopper must be running; without GraphHopper the solver returns "shortest" only, flagged):

```
uv run python -m athlete_solver solve request.json [--geojson out.geojson]
uv run python tests/kpi/build_scenarios.py   # fixtures + brute-force reference values -> tests/fixtures/scenarios/scenarios.json
uv run python tests/kpi/run_kpi.py [--only S05,S15]   # -> docs/reports/phase3c/kpi.md, exit 0 only if every KPI passes
```

Scenario requests live in `tests/fixtures/scenarios/base.json`. Never edit `scenarios.json` by hand: its reference values come from `tests/kpi/reference.py` (every stop order routed and measured, no matrix, no DP), kept independent of the solver.

GraphHopper (http://localhost:8989, the "recommended" generator; started with Valhalla above). It runs alongside Valhalla (about 2.1 GiB). Photon can run with both (measured 2026-11-18). Delete `data/graphhopper/graph-cache` to re-import (needed after changing `engine/graphhopper/config.yml` or the custom models; rebuild the image with `docker compose build graphhopper`). Spike experiments:

```
uv run python engine/experiments/07_quieter_spike.py
uv run python engine/scripts/build_rules_fixtures.py     # Phase 3b acceptance places by OSM id -> tests/fixtures/rules_places.json
uv run python engine/experiments/08a_road_priority.py    # Phase 3b: priority models (profile foot_rules) -> docs/reports/phase3b/
uv run python engine/experiments/08b_pass_near.py --model "R5 trunk-last" --proximity network   # pass-near prototype
```

API (Phase 4, http://localhost:8000, docs at /docs; needs Postgres and Redis, and the engines for solves). One worker only (amendment 17):

```
docker compose up -d postgres redis
uv run alembic -c api/alembic.ini upgrade head     # migrations (psycopg); `check` compares them with athlete_api.db
uv run python -m athlete_api.purge_deleted --days 30   # removes saved routes soft-deleted more than 30 days ago; in Docker: docker compose exec api python -m athlete_api.purge_deleted
uv run uvicorn athlete_api.main:app --port 8000
uv run pytest tests/unit/api                       # API unit tests, no services
uv run pytest tests/api                            # the app on a throwaway athlete_test database + Redis db 15, no engines
uv run pytest tests/integration -k api              # live stack: A01 flow (vs the solver, with and without cache), 6 concurrent solves; athlete_live database + Redis db 14
uv run python api/scripts/export_sample_gpx.py      # through the running API: GPX for A01 and S02 -> docs/reports/phase4/gpx/ (manual Garmin/Strava check)
uv run python api/scripts/record_photon_fixtures.py  # needs Photon: re-record tests/fixtures/photon/ (the place tests' Photon responses)
uv run python api/scripts/build_examples.py          # live stack: OpenAPI examples from real solver output -> api/athlete_api/examples/ (never edit them by hand)
uv run python api/scripts/load_osm_features.py [--dsn postgresql://athlete:athlete@localhost:5433/athlete]   # OSM ways + boundaries from the pin -> osm_ways, osm_boundaries (Phase 5 A6; once per database, about 3 min)
uv run python api/scripts/measure_climb.py [--bridges]   # elevation smoothing measurements -> docs/reports/phase5/climb_data.json
docker compose --profile api up -d --build api        # the containerised API on :8000 (migrates on start; one worker)
uv run python api/scripts/measure_latency.py         # through the container, every active fixture -> docs/reports/phase4/latency.md (raise ATHLETE_RATE_* first; see the script)
uv run python api/scripts/measure_stack_memory.py    # memory of every container during six concurrent solves through the API
uv run python api/scripts/measure_overview.py        # needs Valhalla: smart against even waypoints (A14) -> docs/reports/phase5d/overview_data.json
uv run python api/scripts/measure_cues.py            # needs Valhalla: Follow cues against Valhalla's turns (A15) -> docs/reports/phase5d/cues_data.json
uv run python api/scripts/export_follow_fixtures.py [--check]   # no services: A15 answers for the web's Follow tests -> tests/fixtures/follow/routes.json
```

Health detail in tests: pass `health_key=...` and send `X-Health-Key`; without it `/v1/health` gives the public body.

Tests never use development data: `tests/devguard.py` stops any app a test starts on a database or Redis db outside its lists. Pass `live_database` and `live_redis` (or the `tests/api` settings), never plain `Settings()`; a new test database is added to the list.

The app uses asyncpg: psycopg's async mode cannot run on the Windows Proactor event loop. `ATHLETE_CACHE_ENABLED=false` turns the solve cache off (tests and diagnosis only). Settings come from `ATHLETE_*` variables (`athlete_api/config.py`); the engine URLs reuse `VALHALLA_URL` and `GRAPHHOPPER_URL`, like the solver.

Web (Phase 5, `web/`, Node 22.18 on this laptop; http://localhost:3000):

```
uv run python api/scripts/export_openapi.py [--check]   # API schema -> web/src/api/openapi.json (CI runs --check)
cd web; npm ci; npm run gen:api                         # openapi.json -> src/api/schema.d.ts (generated, never edit)
uv run python engine/scripts/fetch_basemap.py            # Kerala PMTiles (Protomaps build 20261115, engine/basemap_pin.json) + fonts/sprites -> web/public/basemap/ (226 MB, about 1 min)
npm run dev | npm test | npm run typecheck | npm run lint | npm run build
$env:NEXT_DIST_DIR=".next-check"; $env:NEXT_PUBLIC_API_BASE="same-origin"; $env:NEXT_API_PROXY="http://localhost:8000"; npm run build; npx next start --port 3001   # a test build beside the running :3000 server; /v1/* is proxied to the API (same origin, no CORS entry needed)
$env:E2E_BASE="http://localhost:3001"; $env:E2E_API="http://localhost:8000"; npx playwright test --project=phone   # the journeys against that build
uv run --no-project --with fonttools --with brotli python web/scripts/subset_pixel_font.py   # Silkscreen Regular (pinned google/fonts commit) -> web/src/fonts/pixel-gatho.woff2 (stat characters, tabular digits)
```

- Brand: `npm run gen:brand` (also predev and prebuild) writes `src/brand/logo.ts` (committed) and the gitignored `public/icons/`, `public/favicon.ico`, `public/brand/og.png` from `brand/logo.json`. `logo.json` and `brand/sprites.json` must equal `docs/reports/phase5b/sprites.md` (unit tests check).
- Themes: `data-theme` on `<html>`, set before first paint by `THEME_SCRIPT` (`src/theme/theme.ts`); tokens in `globals.css`; `src/theme/tokens.test.ts` checks every contrast pair in both themes. React state lives in `src/theme/useTheme.ts`, kept apart so server components can import `theme.ts`.
- The pixel font (Silkscreen) has no `tnum` and a narrower "1": the subset widens it, so the stat numbers are tabular.
- Icons: `src/brand/icons.ts` is generated from pixelarticons 2.4.2 (dev dependency, MIT) by `npm run gen:icons`; the list is in `scripts/gen-icons.mjs`, and a unit test fails if the file is stale. Use them through `<Icon>` in `src/components/ui`, 24 px only.
- Sprites: `src/brand/sprites.ts` is generated from `brand/sprites.json` by `npm run gen:sprites` (a unit test checks it is current and draws exactly the approved pixels). `<Sprite name="sneaker">` and `<SneakerCycle>` (loading) are in `src/components/Sprite.tsx`; `<Mascot>` is a client component of its own.
- Map markers are plain DOM built in `src/map/markers.ts` (sneaker start pin, stop discs grouped by screen distance, place diamonds, end flag); never transform a marker's root (MapLibre owns it). The sneaker faces the API's first km mark (RouteDetail reports it), the first geometry segment until then. The basemap has light and dark flavours of the same tiles (`basemap.ts`, quietened to the palette); a theme switch keeps drawn layers (`keepDrawn`). Route colours per theme: `ROUTE_COLORS` in `plan/routeStyle.ts`.
- The start pin is one marker for the map's life (`useRouteLayers`): never rebuild it on zoom, or it hops again. Stops are rebuilt on every zoom.
- Layer order is `src/map/overlays.ts`: route lines go below every overlay, the invisible marker obstacles on top. Add a map layer with `layerAbove`.
- The share page uses `useRouteLayers` too; there is no second set of marker code.
- Before the first route the planner shows the five setup steps (`src/components/setup/SetupFlow.tsx`); the e2e helper `setupRun` walks them. In setup, "half" is 64 % of the screen.
- Base components (`src/components/ui`): `Button` (primary has the 2 px hard shadow and drops into it when pressed), `IconButton` (label required), `Chip`, `Badge` (a button with a 44 px tap area when it opens a detail), `Snackbar` (no timeout).
- `/kit` shows every component in both themes; it answers 404 unless the server runs with `GATHO_UI_KIT=1`.

- **Every API call goes through `call` or `answer` (`src/plan/planClient.ts`)** or catches for itself: openapi-fetch rejects when the session or the network fails, and gives a non-JSON body as a string. A failure shows its real reason, never an invented status. Only `apiSaid(e, 404)` means deleted or gone: a plain 404 also comes from the wrong address. Test: `--project=unreachable` (answers /v1 itself, writes nothing).
- **Run web tooling from PowerShell (or a `D:\` path), not Git Bash's `/d/...`.** A lower-case drive letter makes Vitest load itself twice ("failed to find the current suite").
- `npm install` sometimes skips rolldown's native binary (npm optional-dependency bug): delete `node_modules` and `package-lock.json` and install again.
- PowerShell 5.1 `Set-Content -Encoding utf8` writes a BOM; never use it on package.json.
- jsdom is pinned to 29.x and ESLint to 9.x: jsdom 30+ needs Node 22.22, and eslint-plugin-react supports ESLint 9 only.
- MapLibre 6 loads its worker from `public/maplibre/` (copied by `scripts/copy-maplibre-worker.mjs` before dev and build); without it the map stays blank ("Worker failed to load").
- `@rolldown/binding-win32-x64-msvc` and `@rolldown/binding-linux-x64-gnu` are optional dependencies on purpose: npm otherwise drops the Windows one on every `npm install <pkg>`, and a lockfile made on Windows has no Linux binding, so `npm ci` in CI fails ("Cannot find native binding").
- End to end (live stack, `next start` on :3000, API with `ATHLETE_RATE_SESSION_PER_IP_HOUR=1000`): `npx playwright test --project=phone` (journeys A01, S02, G01, SR01, phone viewport; without `--project` every project runs) and `npx playwright test --project=screens` (screenshots; set `SHOTS_DIR`, or the committed ones are overwritten). Every on-screen number carries `data-value` (its raw API value); `e2e/helpers.ts` checks them all against the responses.
- Fix-round projects: `basemap` (iPhone 16 viewport, cold, warm and the cache trigger; that last test skips over Caddy's untrusted certificate, so run it on http), `layout`, `pin`, `direction`, `openin` (Google intercepted), `share`, `brand`. `SHOTS_ONLY=01,08` with `--project=screens` writes only those screens. Look at the screenshots: they caught three defects the tests did not.
- Phase 5c projects: `editing`, `saved`, `owner`, `errors`; SR01 is in `phone` (`sr01.spec.ts`); **`screens5c` always writes the committed docs/reports/phase5c/screenshots (it ignores `SHOTS_DIR`)**: run it only to replace them.
- Phase 5d/5e projects: `follow` (Follow with a mocked position: A01 replayed at running speed, screen lock, refresh, voice; zero requests during a run), `restore` (refresh and Back while planning), `openin`. Follow and Open-in screenshots land in each test's output folder; the report's copies are in docs/reports/phase5d/screenshots.
- Follow test mocks: the page clock moved by a test is carried over a reload in `window.name`; feed fixes one per frame when a test depends on what each render sees (batches skip a turn's 25 m window); Chromium accepts only its own voices on its own utterances, so the speech stub replaces `SpeechSynthesisUtterance`; a theme switch loads the other sprite, so take theme screenshots outside a request recording.
- `src/follow/` is pure (no DOM, network, storage or clock; a test checks it): `line`, `tracker`, `offRoute`, `cues`, `clock`, `run`, `kept` (what a tab keeps of a run), `voice`. `npm run sim:follow` simulates them with noisy GPS (about 10 minutes) -> docs/reports/phase5d/follow_sim_data.json.
- Lighthouse for a phase: build `main` from `git archive main web` (link `public/basemap` with a junction, and remove only the junction afterwards), serve both builds behind one throwaway Caddy on two ports, and interleave the runs: the laptop's load moves the score by several points.
- **The dev stack is the developer's: run `docker ps -a` before any compose command, and never a bare `docker compose down` as cleanup.** The API container migrates the dev database on start, so rebuilding it applies new migrations: back up first and ask. To test a migration or an API change, use a copy: a database from `pg_dump | pg_restore`, the API from the host on :8100 (`ATHLETE_DATABASE_URL`, `ATHLETE_REDIS_URL` on a spare db), the web built with `NEXT_DIST_DIR=.next-check` and `NEXT_API_PROXY=http://localhost:8100`, started with `API_INTERNAL_BASE` pointing at :8100, and a throwaway Caddy on :8443.
- `notFound()` pages are a client-rendered shell where the head theme script does not run: `ThemeSync` in the layout applies the theme.
- Generated files compared byte for byte by tests are pinned `eol=lf` in `.gitattributes`. Test a fresh clone with `core.autocrlf=true`, as this laptop has.
- The default limit (60 new sessions per IP per hour since Step 9; it was 10) can still run out over many journey runs: place search then shows "Too many session requests…" and every journey times out at the start. Raise it on the API alone: `$env:ATHLETE_RATE_SESSION_PER_IP_HOUR="1000"; docker compose --profile api up -d --no-deps api`, and wait for `/v1/health` before testing. Without `--no-deps`, compose can recreate Postgres too, and the API exits ("connection refused") if it starts first (happened 2026-11-18; `docker start athlete-api` recovered it, data intact). Since 2026-11-19 the API waits for Postgres's `pg_isready` healthcheck. Put it back to 10 the same way afterwards.
- Phone over the LAN: build with `$env:NEXT_PUBLIC_API_BASE="same-origin"`, then `$env:LAN_HOST="<ip>"; docker compose --profile api --profile web up -d --no-deps proxy`, and open `https://<ip>` or `https://localhost`, never `:3000` (that build has no API there) (Caddy, `tls internal`, `default_sni` for bare IPs). Steps, firewall and certificate install: docs/reports/phase5/phone.md. In PowerShell an empty `$env:X=''` deletes the variable, hence "same-origin".
- Lighthouse: `npx lighthouse@13.0.1 http://localhost:3000/` with `CHROME_PATH` set to Playwright's Chromium.
- G01's `set_distance` fix (22.2 km) is a solver estimate: the loop then needs 26.2 km (over_budget). Not changed; reported.
- CI: `.github/workflows/ci.yml` (schema and types not stale, Python unit tests, web typecheck, lint, tests, build, the first-load JS budget, the `unreachable` journeys; deploy files: shellcheck, compose config, caddy validate). `docs/ci-cd.md`.
- Step 9 projects: `link` (two browsers; the API needs migration 0006, so run it on a copy: CLAUDE.md's :8100 recipe), `privacy` (no request outside GATHO's origins). `npm run check:bundle` after a build (`NEXT_DIST_DIR` for another folder).
- A Next build rewrites `web/tsconfig.json` when `NEXT_DIST_DIR` is not `.next` (adds its types folder): `git checkout web/tsconfig.json` afterwards.

Photon (profile `geocode`, http://localhost:2322):

```
uv run python engine/scripts/fetch_photon.py
docker compose --profile geocode up -d photon
uv run python engine/experiments/06_photon_smoke.py
docker compose --profile geocode stop photon
uv run python api/scripts/measure_memory.py   # memory with every service up, Photon on and off -> docs/reports/phase4/memory.md
```

`data/valhalla/valhalla.json` is generated by the container. Never edit it by hand; change `engine/valhalla/overrides.json` and re-run the configure script. To rebuild the graph, delete `data/valhalla/`.

## Engine facts measured in Phase 2 (see docs/reports/phase2/summary.md)

- **Lengths shown to users come from geometry, not the engine summary.** Valhalla measures on a sphere; at this latitude its lengths run 0.1 to 0.5% above the WGS84 geodesic length of the same shape, more for north-south routes. Use `geodesy.line_length_m(route_shape(resp))`.
- **Exclude ferries with `exclude_ferries: true`, never with `use_ferry: 0` alone.** `use_ferry: 0` still routes over a ferry when combined with `shortest` or `use_lit`. Hard exclusions need `service_limits.allow_hard_exclusions` (set in `engine/valhalla/overrides.json`). Verify with `trace_attributes` (`edge.use == "ferry"`).
- Valhalla's default pedestrian costing (`use_ferry: 0.5`) takes the Chaliyam–Beypore ferry.
- Pedestrian costing has no option that penalises trunk or primary roads.
- OSM place nodes are not on roads (snap offsets of 2 to 54 m seen). Measure checkpoint compliance against the snapped point.
- Polyline shapes are precision 6. Edge attributes for a route shape: `trace_attributes` with `shape_match: edge_walk`.
- **`edge_walk` is not an access check**: pedestrian `edge_walk` accepts a bicycle route over a `foot=no` bridge, and fails on some unmodified pedestrian routes. Judge pedestrian access by `map_snap` coverage plus OSM tags (`athlete_engine.osm.is_walkable`).
- Valhalla stores edge lengths in whole metres: routes with many short edges drift from the spherical measurement by about 0.1 m per edge.
- Isodistance contours are outlines: vertices are often far nearer by route than the contour value. Route and measure every sample.

## Open decisions (Phase 3b, see docs/reports/phase3b/summary.md; do not resolve silently)

None open. Settled 2026-11-17 (blueprint Phase 3 amendments 18-20):
- road suitability is measured as trunk/motorway share, or flagged;
- the implementation defaults are confirmed;
- "recommended" is capped at 30% longer than "shortest" by easing every road penalty in steps (flag `detour_eased`);
- direction adherence is judged on "shortest".

Phase 3b facts: a pass-near plan depends on the engine, so `over_budget` means every alternative's way through the stops exceeds D + 500 m. Runs are cut from the whole route's geometry (a separately routed tail can begin with a U-turn the re-route cannot repeat). GraphHopper's lengths use a 6,371 km sphere. Valhalla exclusion limits are raised in `engine/valhalla/overrides.json`.
