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

## Split origin (front end on Vercel, API and basemap on a VM)

Three build-time variables, set in the Vercel project (Production):

| Variable | Value | What reads it |
| --- | --- | --- |
| `NEXT_PUBLIC_API_BASE` | the API's public address, e.g. `https://api.<domain>` (no trailing `/v1`) | every API call from the browser (`src/api/client.ts`); the share page's server render too, unless `API_INTERNAL_BASE` is set |
| `NEXT_PUBLIC_SITE_URL` | `https://gatho.shahinsha.xyz` | absolute OpenGraph and icon links (`src/app/layout.tsx`) |
| `NEXT_PUBLIC_BASEMAP_ORIGIN` | the origin that serves `/basemap/`, e.g. `https://tiles.<domain>` (no path) | the PMTiles archive, fonts and sprites (`basemapOrigin()` in `src/map/basemap.ts`) |
| `NEXT_PUBLIC_CONTACT_EMAIL` | optional, an address you read | the contact line on `/about` (`src/lib/contact.ts`); left out when unset or not an address. Never hard-coded |

All of them are inlined at build time: changing one needs a redeploy. Unset, `NEXT_PUBLIC_BASEMAP_ORIGIN` falls back
to the page's own origin, which is how development and the LAN Caddy work.

**The API** must allow the front end's origin: `ATHLETE_CORS_ORIGINS=https://gatho.shahinsha.xyz` (exactly that, no
trailing slash; comma-separated if more are needed). The CORS middleware already allows `X-Client-Token`, PATCH and
DELETE, and exposes `Retry-After` and `Content-Disposition`.

**The basemap server** (Caddy on the VM, a later step) must, for everything under `/basemap/`:

- send `Access-Control-Allow-Origin: https://gatho.shahinsha.xyz` (or `*`: no credentials are sent; pmtiles and
  MapLibre fetch with `credentials: "same-origin"`, which sends none cross-origin);
- answer the `OPTIONS` preflight with `Access-Control-Allow-Methods: GET, HEAD, OPTIONS` and
  `Access-Control-Allow-Headers: Range` (pmtiles sends a `Range` header; not every browser treats it as safelisted);
- send `Access-Control-Expose-Headers: ETag, Content-Range, Content-Length` (pmtiles reads `ETag` to notice a
  replaced archive and `Content-Range` on a 416; without exposure it sees `null`);
- answer Range requests with 206 (Caddy's `file_server` does);
- keep **`Cache-Control: no-store` on `/basemap/kerala.pmtiles`** (Phase 5b amendment 12; the rule in
  `next.config.ts` covers only files that Next itself serves, i.e. development and the LAN setup). Fonts and sprites
  may be cached.

Nothing else assumes one origin: there is no CSP, no preload link and no service worker for the basemap, and the
Follow map's style still has no `glyphs` URL (its tiles come from the corridor in memory, loaded from the archive
before the run). Share links (`src/saved/share.ts`) use the page's origin, which is the front end, as they should.

## Step 9 (cross-device link, launch hardening)

- **"Use on another device"** (`src/components/LinkDeviceDialog.tsx`, opened from Saved routes and the menu via
  `/routes#another-device`): a one-time link `<origin>/link#<code>` (code in the **fragment**: in no server log and
  no Referer), a QR code, Copy, a 5-minute countdown and "New code". The dialog is `next/dynamic`, and the QR encoder
  (`src/saved/qr.ts`, uqr 0.1.3, MIT) a second `import()` inside it: neither is in a first load.
- **`/link`** (`src/app/link/LinkClaim.tsx`) reads the fragment once and clears it with `replaceState` before any
  request, claims without a token, stores the new token (the old one is kept as `athlete.token.previous`, never
  sent), and goes to `/routes` ("Linked. Your saved routes are here"). A browser with saved routes of its own is
  warned first; nothing is deleted on the server.
- **One session per browser** (`PlanClient.token`): made only when a request needs a token; concurrent calls share
  one request; tabs wait on a Web Lock (`gatho:session`) and read the token the first one stored.
- **Busy and error states** (`solveCall`, `StatusLine` in `Planner.tsx`): solver_busy counts down from Retry-After,
  at most 3 retries, with Cancel (`CANCELLED`, not an error); rate_limited says how long to wait and does not retry;
  503 "Planning is temporarily unavailable"; a 504 polls first, then "That route took too long; try a shorter
  distance". The plan and the draft stay.
- **Health:** the app reads the public `/v1/health` body (`features`, `map`); the "older map" note hashes the
  version's build ids the same way (`src/plan/mapIds.ts`; needs WebCrypto, so https or localhost).
- **About and privacy** (`/about`) and a footer link (`SiteFooter`) on Saved routes, `/link` and the share page.
- **First-load JS budget:** `npm run build && npm run check:bundle` (`scripts/bundle-size.mjs`, limits and the
  measured numbers in `bundle-budget.json`). CI runs it.
- Playwright projects: `link` (two browsers, live stack with migration 0006), `privacy` (no request outside GATHO's
  own origins), and `unreachable` now also runs in CI.
