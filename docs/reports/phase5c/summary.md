# Phase 5c summary: manage saved routes

Saved routes can be renamed, edited in the planner and deleted with Undo. Decisions: blueprint Phase 5c amendments 1 to 12. No solver change. The API changes are additive; migration 0005 is the one schema change.

Measured on 2026-11-22 on the development laptop (Windows 11, i5 10th gen, 16 GB), not on a target server.

**Before deploying: back up, then migrate.** The API container runs `alembic upgrade head` when it starts, so rebuilding it applies 0005. The development database has not been migrated yet (see "Deploying").

## What changed

| Area | Before | After |
| --- | --- | --- |
| Saved routes page | Four buttons on every card, `window.prompt` to rename, no delete | Name, distance, end, "Updated <when>", Open and Edit. A "..." menu has Rename, Open in, Download GPX and Delete |
| Rename | Only by saving the route again | A dialog with an 80-character counter, and `PATCH` |
| Delete | None (Phase 5 amendment 11) | Soft delete, at once, with Undo for 10 seconds |
| Edit | The planner could not open a plan | `/?edit=<saved_id>` opens the saved route's own version |
| Saving while editing | | "Update <name>" (same link, with Undo) or "Save as new" |
| Share page | The same for everyone | The owner also gets "Your route": Edit, Rename, Delete |
| A dead link | "Route not found", unstyled | "This link doesn't work any more", the same page for deleted and unknown |
| Database | | `saved_routes.deleted_at`, `updated_at`, an index on (client_id, deleted_at) |

API:

| Endpoint | Change |
| --- | --- |
| `PATCH /v1/me/routes/{saved_id}` | New: `{name?, route_id?}`; keeps slug and created_at |
| `DELETE /v1/me/routes/{saved_id}` | New: 204, and 204 again |
| `POST /v1/me/routes/{saved_id}/restore` | New: Undo |
| `GET /v1/me/routes` | No deleted routes, newest update first; `updated_at`, `plan_version` |
| `GET /v1/share/{slug}`, `.../gpx` | Deleted is 404 with an unknown slug's exact body; `no-store`; `updated_at`, `is_owner` |
| `PATCH /v1/plans/{id}` | Optional `from_version` (A11) |
| `POST /v1/routes/{id}/save` | Optional `as_new` (A12); never revives a deleted row |
| CORS, rate limits | DELETE allowed; a "write" limit of 60 a minute per client |

Purge, by hand (there is no scheduler):

```
uv run python -m athlete_api.purge_deleted --days 30
docker compose exec api python -m athlete_api.purge_deleted --days 30
```

## Decisions

From the product owner:

- **Delete is a soft delete with Undo.** The link answers as an unknown one; Undo restores both.
- **Edit reopens the planner**, then "Update" or "Save as new". The UI says anyone with the link will see the update.
- **Rename is a dialog and a PATCH.**
- **Anonymous clients as before.** Another client's id is always 404, never 403.

Approved after testing the plan's assumptions:

| What was found | Decision |
| --- | --- |
| PATCH always edited the latest version: opening a six-stop version and changing the distance gave zero stops. 4 of 113 saved routes in the dev database were not at their plan's latest version | `from_version` |
| Saving an unchanged route again renamed it, and two saved routes on one route made a save return 500 | `as_new`; a plain save takes the newest live one |
| The share page is rendered without the token, so `is_owner` would always be false | The browser asks again, and never creates a session for a visitor |
| Dropping `deleted_at` would republish deleted links | The downgrade deletes those rows first |
| There was no "write" limit; the name fell through to "read" | 60 a minute per client, none per IP |
| There was no danger colour | The one amber, with an icon and a divider |
| A01 at 20 km is over budget | SR01 updates to the full route, 22.3 km, and checks its exact value |
| "No changes yet" by route id fails after undo, which makes a new id | Compares request and geometry |

## Screenshots

Phone, 390 x 844, light and dark, in [screenshots/](screenshots/):

| Screen | Light | Dark |
| --- | --- | --- |
| Saved routes | [light](screenshots/01-saved-routes-light.png) | [dark](screenshots/01-saved-routes-dark.png) |
| The menu | [light](screenshots/02-saved-menu-light.png) | [dark](screenshots/02-saved-menu-dark.png) |
| Rename dialog | [light](screenshots/03-rename-dialog-light.png) | [dark](screenshots/03-rename-dialog-dark.png) |
| Editing, no changes | [light](screenshots/04-editing-no-changes-light.png) | [dark](screenshots/04-editing-no-changes-dark.png) |
| Editing, Update ready | [light](screenshots/05-editing-update-light.png) | [dark](screenshots/05-editing-update-dark.png) |
| Updated, with Undo | [light](screenshots/06-updated-undo-light.png) | [dark](screenshots/06-updated-undo-dark.png) |
| Owner bar | [light](screenshots/07-owner-bar-light.png) | [dark](screenshots/07-owner-bar-dark.png) |
| Deleted, with Undo | [light](screenshots/08-deleted-undo-light.png) | [dark](screenshots/08-deleted-undo-dark.png) |
| Dead link | [light](screenshots/09-dead-link-light.png) | [dark](screenshots/09-dead-link-dark.png) |

## Tests

Run on an isolated stack: a copy of the development database, its own API (8100), web build (3100) and Caddy (`https://172.24.255.68:8443`). Only the engines, Photon and the Postgres and Redis servers were shared.

- **Through Caddy:** 41 browser tests pass: SR01, A01, S02, G01, the Phase 5c projects (`editing`, `saved`, `owner`, `errors`) and the Phase 5b regression. The cache-trigger test cannot run over an untrusted certificate, so it ran over http against the same build: pass.
- **Every shown number carries data-value:** SR01 scans each screen and proves the scan catches a planted number. The edit message's "−2.7 km" did not carry it and now does.
- **Web:** 160 unit tests (134 before), typecheck, lint, stale-type check, build.
- **Python:** 243 unit and API tests and 7 live API integration tests.
- **Migration on a copy of the dev database:** 0004 to 0005, down, up again. The 113 saved routes were identical each time and `alembic check` found no drift.
- **Pin at rest:** 56 ms of main-thread time in 5 s, against 55 ms with it removed; no style work in either.
- **Lighthouse 13.0.1 mobile, median of three:** accessibility 100 on the planner, share and saved routes pages (gate 95). Performance: planner 69, share 68 (both as in 5b-fix), saved routes 95. The test API ran on the host, so these timings do not compare exactly with 5b-fix.
- **Untouched:** `solver/`, `engine/`, scenario fixtures.

Found and fixed on the way:

- A dead link ignored the dark theme: Next serves `notFound()` as a shell where the head script never runs.
- **From 5b-fix:** two web tests failed on any Windows checkout with `core.autocrlf=true`, `main` included. That round's fresh-clone check had used `autocrlf=false`, which hid it. The generated files are now pinned to LF and were checked in a clone with `autocrlf=true`.

## Not tested

- **A real phone, Safari or Firefox:** Chromium with phone viewports only. The on-screen keyboard over the rename dialog was not seen.
- **Screen readers:** roles, labels and focus are tested, not how they are read out.
- **The containerised API with this code:** the tests ran the API from the host. The image was not rebuilt, because starting it would have migrated the development database. The purge command was not run inside the container.
- **Delete under `npm run dev`:** the CORS preflight is tested at the API, not in a browser on the dev server.
- **Two tabs editing one plan**, and an update racing a delete.
- **CI on Linux** for this branch: not pushed.
- **The solver KPI harness** was not re-run (no solver change).

## Known limits

- **Anonymous clients:** saved routes belong to a token in one browser. Clearing its data loses them, and there is no way back until sign-in (Phase 8).
- **Orphaned routes are kept:** delete and purge remove only `saved_routes` rows. Routes and plan versions stay, and nothing cleans them up.
- **Undo is brief:** after 10 seconds nothing in the UI restores a delete, although the API can until the purge.
- **One Undo at a time:** a second delete replaces the first one's message.
- **Copies elsewhere:** a deleted route's GPX files and cached link previews stay where they are.
- **Behind Caddy all clients share the proxy's IP**, so the per-IP limits (10 new sessions an hour) are shared by every user. A separate change: trusting forwarded addresses also needs port 8000 closed to the LAN.
- **`/` is rendered per request** to read `?edit=`; it was static.
- **A dead link shows for a moment without a theme** while React starts.

## Deploying

1. Back up: `docker exec athlete-postgres pg_dump -U athlete -Fc athlete > <file>` (from Git Bash or cmd; PowerShell 5.1's `>` corrupts binary output).
2. `docker compose --profile api up -d --no-deps --build api`: migrates to 0005 on start.
3. Rebuild and restart the web app. It needs this API: against an older one the list has no `updated_at`, and rename and delete fail.
4. To go back: `uv run alembic -c api/alembic.ini downgrade 0004`. **This permanently deletes soft-deleted saved routes**, on purpose.
