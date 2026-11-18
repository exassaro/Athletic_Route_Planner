# web

The Phase 5 front end: Next.js (App Router) + TypeScript + MapLibre GL JS (blueprint Phase 5 amendments).

```
npm ci                       # install (Node 22.12 or later)
npm run dev                  # http://localhost:3000, API at NEXT_PUBLIC_API_BASE (default http://localhost:8000)
npm test                     # component tests (Vitest)
npm run typecheck && npm run lint
```

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
