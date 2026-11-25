# Step 9: cross-device link, launch hardening, CI/CD

2026-11-25. Blueprint "Step 9 amendments" (top of `docs/blueprint.md`). All numbers were measured on the development
laptop (Windows 11, Docker Desktop), not on the VM. Nothing was run against the server, Vercel or AWS.

**The solver is unchanged:** `git diff fe82d12 HEAD -- solver engine/athlete_engine` is empty.

## Commits

| Item | Commit | What |
|---|---|---|
| 1 | `85d0520` | link and claim API, migration 0006, Caddy log filter, blueprint amendments |
| 2 | `05f6008` | "Use on another device" dialog and the `/link` page |
| 3 | `3a4264f` | the QR code (uqr, lazy) and the bundle measurement |
| 4 | `c9bae85` | Playwright journey with two browsers (project `link`) |
| 5 | `21587cd` | busy and error states (solver_busy countdown and Cancel, rate_limited, 503, 504) |
| 6 | `db98cd7` | session limits (60/h per IP, 120/min in all); one session per browser |
| 7 | `f82b899` | health detail behind `ATHLETE_HEALTH_KEY`; `ATHLETE_DOCS` |
| 8 | `03e2ffa` | About and privacy, footer link, saved-routes note, third-party request check |
| 9 | `eb4ccf3` | Caddy recreated when stale, and checked (first_run, update, health) |
| 10 | `a3ae53c` | CI: bundle budget, deploy files job, `unreachable` journeys, concurrency, caching |
| 11 | `d6f9c7b` | `docs/ci-cd.md` |
| 12 | `ae97f16` | `deploy-server.yml` (manual, off until its secrets exist) |
| docs | (last) | CLAUDE.md, api/README.md, web/README.md, deploy/RUNBOOK.md, this report |

## Bundle size (first-load JS, gzip)

Measured by `web/scripts/bundle-size.mjs` (the root main files plus the page's entry chunks from its client
reference manifest; `import()` chunks excluded), on a plain `npm run build`.

| Page | Before (fe82d12) | After | Change |
|---|---|---|---|
| `/` | 191,832 B | 192,693 B | +861 B (+0.45 %) |
| `/routes` | 160,819 B | 162,461 B | +1,642 B (+1.02 %) |

The QR encoder (3,926 B gzip) and the link dialog (2,112 B gzip) are separate chunks in no page's first load
(checked in the build). The first load did grow a little, but not because of the QR code:

- `/routes` gained the "Use on another device" button, the `next/dynamic` stub, the "Linked" message and the footer.
- `/` gained the busy countdown and Cancel, the health banner's new body, and the map-id hashing for the "older map"
  note.

The budget in `web/bundle-budget.json` is the measured "after" plus 3 %, and CI enforces it.

## API changes

All are listed in the approved brief, except the one marked *.

- **A16 `POST /v1/session/link`** (needs `X-Client-Token`, 201): returns `{code, expires_in_s}`.
  - The code is 192 random bits, URL-safe. Redis stores only its sha256 (`link:<sha256>` → client id), for 300 s.
  - Limit: 10 an hour per client.
  - It never returns the token.
- **A17 `POST /v1/session/claim {code}`** (no token, 201): returns `SessionOut`, a new token for the same client.
  - GETDEL makes the code single use, even with 8 claims sent at once (tested).
  - Limit: 10 a minute per IP, every attempt counted.
  - Unknown, expired, used, or a client that no longer exists: one identical 404 `link_invalid`.
- **Migration 0006**: a `client_tokens` table, detailed in the next section.
- **Session limits:** 60 an hour per IP (was 10), plus a new limit of 120 a minute across all IPs. An IP over its own
  limit does not use up the shared one.
- **A18 `/v1/health`:** the status codes are unchanged (200 and 503).
  - Without the right `X-Health-Key`, the body is `{status, features {planning, search, recommended}, map}`.
  - \* `map` holds `{osm, valhalla, graphhopper}`, each the first 16 hex characters of the sha256 of that engine's
    build id.
    - *Why:* the planner's "Built on an older map" note (Phase 5e) compared build ids from `/v1/health`. The opaque
      ids keep that note working without showing any version. The web hashes the plan version's build ids the same
      way. (Plan versions already carry build ids in clear, as before.)
    - I also kept `"down"` as a status value. It was already there and comes with the 503.
  - With the key: the previous detailed body, unchanged.
  - Both answers send `Cache-Control: no-store`.
- **`ATHLETE_DOCS=false`** turns off `/docs`, `/redoc` and `/openapi.json` (production).
- `openapi.json` and the generated types are regenerated (`export_openapi.py --check` passes).

Not an API change, but worth knowing: **Caddy's access log recorded `X-Client-Token`**. Caddy logs request headers and
hides only Cookie and Authorization by itself. `Caddyfile.prod` now deletes `X-Client-Token` and `X-Health-Key` from
the log. The logs already on the VM still hold tokens; the RUNBOOK has the one-line command to delete them.

## Migration 0006

`client_tokens (token_hash bytea primary key, client_id uuid → clients.id on delete cascade, created_at, label text
null)`, plus an index on `client_id`.

- It only adds a table. Token lookup checks `clients.token_hash` (unchanged) or `client_tokens`, so every existing
  token keeps working with no data change.
- Tested up, down and up again on a fresh database. Also applied to a copy of the dev database (`athlete_step9`):
  0005 → 0006, all 359 clients unchanged, 0 rows in `client_tokens`.
- The downgrade drops the table: every linked device's token stops working, and that browser gets a new, empty
  client on its next request. The first device is not affected.

## New settings and environment variables

| Name | Default | Notes |
|---|---|---|
| `ATHLETE_HEALTH_KEY` | `""` (never give the detail) | `.env.prod`; written by `gen_secrets.sh` (64 hex) |
| `ATHLETE_DOCS` | `true` | `false` in `docker-compose.prod.yml` |
| `ATHLETE_RATE_SESSION_PER_IP_HOUR` | `60` (was 10) | **the VM's `.env.prod` sets 10 explicitly**: change it (below) |
| `ATHLETE_RATE_SESSION_GLOBAL_MIN` | `120` | new |
| `ATHLETE_RATE_LINK_PER_CLIENT_HOUR` | `10` | new |
| `ATHLETE_RATE_CLAIM_PER_IP_MIN` | `10` | new |
| `ATHLETE_LINK_TTL_S` | `300` | new, at least 30 |
| `NEXT_PUBLIC_CONTACT_EMAIL` | unset (no contact line) | Vercel, build time |

## Before deploying: exact steps

**Order matters.** A push to `main` deploys the web app on Vercel at once, and the new web app calls
`/v1/session/link`, so update the VM before the push reaches Vercel. Nothing has been pushed yet.

1. **Vercel** (optional; for the contact line): Settings → Environment Variables → Production → add
   `NEXT_PUBLIC_CONTACT_EMAIL` = the address to show. It is read at build time, so it takes effect with the push in
   step 3 (or a Redeploy).
2. **On the VM** (`ssh -i <key>.pem ubuntu@54.252.91.95`). First push the commits to GitHub so the VM can pull them.
   That push is what makes Vercel deploy, so run these commands straight after it:

   ```bash
   cd ~/athlete_router
   bash deploy/backup.sh
   bash deploy/update.sh                          # pull, migration 0006, new API image, health check
   bash deploy/gen_secrets.sh --add-health-key    # adds ATHLETE_HEALTH_KEY to .env.prod; changes nothing else
   sed -i 's/^ATHLETE_RATE_SESSION_PER_IP_HOUR=10$/ATHLETE_RATE_SESSION_PER_IP_HOUR=60/' deploy/.env.prod
   grep -q '^ATHLETE_RATE_SESSION_GLOBAL_MIN=' deploy/.env.prod || echo 'ATHLETE_RATE_SESSION_GLOBAL_MIN=120' >> deploy/.env.prod
   source deploy/lib.sh; dc up -d --no-deps --force-recreate api
   wait_healthy athlete-prod-api 180
   refresh_caddy                                  # the new log filter (this first update.sh run is the old copy)
   sudo find data/logs/caddy -name 'access*.log*' -delete; refresh_caddy force   # drop logs that hold tokens
   bash deploy/health.sh && bash deploy/smoke.sh
   ```

   The Vercel build takes a minute or two, so the window in which the new web app meets the old API is short. To
   avoid it entirely, push to a branch first, run `update.sh` with `git checkout <branch>`, then merge.
3. **GitHub**, once: protect `main` (`docs/ci-cd.md`, "Protect main": PR required, checks `api-schema-and-unit`,
   `web`, `deploy-files`). `deploy-server.yml` stays off unless you add its four secrets and open port 22 (see the
   doc for the risk).

## What could break existing saved routes or tokens

- **Nothing changes existing tokens or rows.** 0006 only adds a table, and token lookup still accepts
  `clients.token_hash`. Tested with old tokens before and after linking.
- **Downgrading 0006** logs out linked devices (see above). Their saved routes stay with the first device.
- **Linking on a browser with its own saved routes** switches that browser to the other client. Its own routes are
  not deleted, and their share links keep working. The browser keeps its old token as `athlete.token.previous`, but
  the app has no button to switch back yet.
- **A leaked link code** gives full access to that client's saved routes for up to 5 minutes, once. The dialog says
  to keep it private.
- **Web before API:** if Vercel deploys before the VM is updated, "Use on another device" shows "Could not get a
  code" (a 404) until it is. Nothing else depends on the new API: the old health body still works with the old
  web, and the new web's banner reads only `features`.
- **health.sh run from the laptop** without `ATHLETE_HEALTH_KEY` checks the public body only, and says so.

## What was run

| Check | Result |
|---|---|
| `pytest tests/unit` | 234 passed |
| `pytest tests/api` (Postgres and Redis; includes link, claim, race, expiry, limits, old tokens, migration 0006 up and down, health with and without key, docs off) | 133 passed (2 min) |
| `pytest tests/integration -k api` (live engines, `athlete_live`) | 9 passed |
| `alembic check` on the migrated test database | no new operations |
| web: typecheck, lint, Vitest | clean, clean, 53 files / 466 tests passed (last full run) |
| web: `next build`, `check:bundle` | pass, within budget |
| Playwright `link`, `privacy` (copy of dev DB at 0006, API on :8100, `.next-check` on :3001) | 4 passed |
| Playwright `restore`, `errors` | 24 passed |
| Playwright `phone` (A01, S02, G01, SR01), `saved`, `owner`, `editing` | 14 passed |
| Playwright `unreachable` against a build with no reachable basemap (as in CI) | 7 passed |
| `shellcheck -x deploy/*.sh` | clean |
| `docker compose -f deploy/docker-compose.prod.yml config` (dummy env) | valid; `ATHLETE_DOCS: "false"` |
| `caddy validate` of `Caddyfile.prod` (caddy:2.10.2) | valid configuration |
| actionlint on both workflows | clean |
| `gen_secrets.sh` new file, existing file, `--add-health-key` twice (scratch copy) | as expected; password untouched |
| `caddy_stale` / `check_caddy_mounts` against a caddy:2.10.2 container | pass (see limits) |

**Third-party requests:** the `privacy` project records every request while visiting the planner with a route on the
map, Saved routes with the QR dialog open, About, `/link` and a share page. Every request went to the page's own
origin or the API. There is no analytics package in `web/package.json` and no analytics script in the app.

## Not run, or not fully

- **GitHub Actions itself**: the workflows are linted, and their steps were run here one by one, but not on GitHub.
  The `web` job's Playwright step installs Chromium on the runner, which was not exercised.
- **Lighthouse**: not run for this step, and not wired into CI (it needs the basemap and a running stack).
- **A real phone scanning the QR code**: the code was checked structurally (finder patterns, quiet zone, version 5
  at level M for a 65-character link), not scanned by a camera. Worth doing once after the deploy.
- **The Linux stale-mount case**: Docker Desktop shares bind mounts by path, so a replaced directory is seen at
  once on this laptop. The checks (the file missing, or its size and mtime different from the host's) are what will
  catch it on the VM. The "missing" path was seen to fire here.
- The other Playwright projects (`follow`, `basemap`, `screens`, `pin`, `direction`, `layout`, `openin`, `share`,
  `brand`, `screens5c`), and the KPI harness (the solver did not change).
