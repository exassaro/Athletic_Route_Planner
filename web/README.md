# web

The Phase 5 front end: Next.js (App Router) + TypeScript + MapLibre GL JS (blueprint Phase 5 amendments).

```
npm ci                       # install (Node 22.12 or later)
npm run dev                  # http://localhost:3000, API at NEXT_PUBLIC_API_BASE (default http://localhost:8000)
npm test                     # component tests (Vitest)
npm run typecheck && npm run lint
```

Which address to open depends on how it was built:

| Mode | How | Open |
| --- | --- | --- |
| Development | `npm run dev`, with `NEXT_PUBLIC_API_BASE` unset | `http://localhost:3000` |
| PC and phone | `npm run build` with `NEXT_PUBLIC_API_BASE=same-origin`, then `npx next start --port 3000`, behind Caddy | `https://localhost`, or `https://<LAN IP>` |

A same-origin build does not work on `:3000`: the web server has no `/v1`, and the app says "GATHO's API isn't at this
address". The variable left over in a shell breaks `npm run dev` the same way (PowerShell:
`Remove-Item Env:NEXT_PUBLIC_API_BASE`).

API types: `src/api/schema.d.ts` is generated, never edited.

```
uv run python api/scripts/export_openapi.py   # (repo root) the API's schema -> web/src/api/openapi.json
npm run gen:api                               # openapi.json -> src/api/schema.d.ts
```

CI (`.github/workflows/ci.yml`) fails when either file is stale.

Basemap (Phase 5 amendments 3 and 12): `uv run python engine/scripts/fetch_basemap.py` (repo root) puts the Kerala
PMTiles file (Protomaps build of 2026-11-15, pinned in `engine/basemap_pin.json`), fonts and sprites into
`public/basemap/` (gitignored). The dev server answers range requests on it (checked: 206 Partial Content).

End to end and the phone: see `playwright.config.ts` (commands at the top) and `docs/reports/phase5/phone.md`.
Layout: `src/api/` (generated types, clients), `src/plan/` (request edits as JSON Patches, the plan client and its
waiting rules, formatting), `src/components/` (planner screens), `src/map/` (MapLibre, basemap, route layers),
`src/app/` (planner `/`, share page `/s/[slug]` server-rendered, saved routes `/routes`, manifest), `e2e/`.

## Follow mode logic (Phase 5d step 5)

`src/follow/` is pure (no DOM, network, storage or clock; `kept` is the text a tab keeps of a run, Phase 5e amendment 6): `line` (the route), `tracker` (progress), `offRoute`,
`cues`, `clock`, and `run`, which puts them together as a reducer. `npm run sim:follow` runs these modules under
simulated GPS (about 10 minutes, Node 22.18 or later for type stripping) and writes
`docs/reports/phase5d/follow_sim_data.json`; the findings are in `docs/reports/phase5d/follow.md`.

## Follow mode screen (Phase 5d step 6)

`/follow?saved=|route=|share=` (`src/components/follow/`). It needs https or localhost for a location.

**No request may depend on a position.** The map (`FollowMap`, not `MapView`) is served from the route's corridor
in memory (`src/map/corridor.ts`) and its style has no glyphs URL (`src/map/followStyle.ts`). Do not add a lazy
import, an image or a fetch to anything that shows during a run: `npx playwright test --project=follow` replays A01
and fails on any request at all.

Voice cues (step 8): `src/follow/voice.ts` decides what is said and picks an English voice that is on the device;
`src/components/follow/useVoice.ts` speaks through the browser. A remote voice is never used, even as the default.

## Surviving a refresh (Phase 5e items 1 to 3)

`src/restore/`: `draft` (what may be stored, and reading it safely), `tab` (the address and sessionStorage) and
`boot` (the head script that keeps step 1 from flashing). A restore only reads the API. Nothing with geometry, a
GPS position or a token goes into storage. A run keeps metres done, start time and pauses only (`gatho:run:v1`). Test: `npx playwright test --project=restore`.
