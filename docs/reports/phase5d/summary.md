# Phase 5d summary: route fidelity and Follow mode

"Open in Google Maps" now says what it is, an overview, and offers the exact route as a GPX first. A new Follow mode shows a runner where they are on the route, in the browser, with the location kept on the phone. Planning and a run survive a refresh. Decisions: blueprint Phase 5d amendments 1 to 15 and Phase 5e amendments 1 to 6. No solver change; the API changes are additive (A14, A15) and there is no migration.

Measured on 2026-11-22 and 2026-11-23 on the development laptop (Windows 11, i5 10th gen, 16 GB), not on a phone or a target server. **Nothing in this phase was tested on a real phone** (see the end).

## What changed

| Area | Before | After |
| --- | --- | --- |
| Google Maps link | Up to 8 evenly spaced km marks, presented as the route | 3 waypoints on a mobile browser, 9 elsewhere, picked by the API so that our router's path stays close to ours; labelled "Google Maps (overview)" with a note and an estimated overlap |
| "Open in..." | Google Maps first | "Get GPX (exact route)" first, then Google Maps (overview), then how to see the exact line in My Maps (a computer only), then the Garmin and Strava notes |
| Following a route | None | `/follow` from the route card, the saved route card and the share page: the route, a live dot, progress, time, pace, the next turn, an off-route banner, voice cues, battery saver |
| A refresh while planning | Back to step 1, everything lost | The plan comes back from the address, the unfinished setup from the tab (Phase 5e amendments 1 to 3) |
| A refresh during a run | (no runs) | "Your run is still going", from three values kept in the tab (Phase 5e amendment 6) |
| Starting again | Reload the page | "Plan a new run" in the menu, "New run" on the sheet, with Undo |

API (additive):

| Endpoint | What |
| --- | --- |
| `GET /v1/routes/{route_id}/overview-points?max=N`, `GET /v1/share/{slug}/overview-points?max=N` | A14: up to N waypoints in route order, `max_deviation_m` and `overlap_pct` (leg by leg). Cached by route, N and Valhalla build; 503 when Valhalla is down, and the web app uses evenly spaced km marks |
| `GET /v1/routes/{route_id}/follow`, `GET /v1/share/{slug}/follow` | A15: the vertices, the metres along the route at each, and the turn cues; always 200 (cues from the geometry alone when Valhalla is down, `cue_source` says so) |

## Route fidelity: overlap before and after

Measured with Valhalla's pedestrian route standing in for Google's ([overview.md](overview.md); **nothing was measured on Google Maps**). Deviation is the worst distance between our line and that path; overlap is by leg; drift is the path's length minus ours.

| Route | Waypoints | Overlap, even (before) | Overlap, smart (after) | Deviation before → after | Drift before → after |
|---|--:|--:|--:|--:|--:|
| A01 | 3 | 64.5 % | 78.9 % | 2,017 → 1,078 m | −978 → −664 m |
| A01 | 9 | 86.3 % | 100 % | 479 → 18 m | −271 → +8 m |
| S02 | 3 | 23.4 % | 43.4 % | 524 → 433 m | −1,554 → −298 m |
| S02 | 9 | 71.2 % | 100 % | 360 → 4 m | −623 → 0 m |

With 3 waypoints, the most a mobile browser takes, Google can still take a different path: S02 keeps 43 % of it. That is why the GPX comes first and the note says the path and distance can differ. An estimate above 95 % reads "over 95%", because it is our router's, not Google's.

**My Maps:** the steps under "How to see the exact line in Google Maps" were checked on 2026-11-22 against Google's help page [Import map features from a file](https://support.google.com/mymaps/answer/3024836) (its "Computer" tab). Its Android and iOS tabs say My Maps is not available there, so the sheet says it needs a computer.

## Follow mode

- **Progress** is the position along the route, snapped forward-only within a window, never a sum of GPS steps. Simulated with noisy GPS ([follow.md](follow.md)): every whole run reached 100 % with clean and drifting GPS (117 of 120 with poor GPS), none showed a false off-route banner, and after a lock the wrong part of the route was chosen 3 times in 18,000.
- **Cues** come from the API: a bend over 35° at a junction, with the road's name where OSM has one ([cues.md](cues.md): 99.3 % of Valhalla's own turns found on 54 routes). Most turns in Kozhikode have no name in OSM, so they say "turn left".
- **Off route:** more than 40 m from the line for 10 s and two good fixes, with a 200 ms buzz where the phone supports it.
- **Screen lock:** the browser stops the location while the screen is locked. On waking, "Finding you...", one fresh fix, the window widened by the time away, and "You were away for 2 min 10 s".
- **Voice cues:** off by default, offered only with an English voice that is on the phone. "In 90 metres, turn left onto Beach Road." and "Now, turn left."
- **A refresh during a run:** the tab keeps the metres done, the start time and the pauses only. No coordinates, no time of the last fix, no gaps. Simulated: 4 wrong passes in 14,400 refreshes, against 1 if the time of the last fix were kept. On an out-and-back the runner can wait about 25 s to be found again.
- **The location never leaves the phone.** No request depends on a position: the map's tiles for the route's corridor are loaded before the run and served from memory, and the map draws labels with the phone's fonts. Browser tests record every request during a run (A01 replayed at running speed, a screen lock, a refresh, voice on) and fail on any one.

## Tests and measurements

| Check | Result |
|---|---|
| Web unit tests | 416 pass, also in a fresh clone with `core.autocrlf=true` |
| Python unit tests | 234 pass |
| API tests (Postgres, Redis, no engines) | 113 pass |
| Live overview and Follow integration tests (Valhalla) | 2 pass |
| Browser tests through a throwaway Caddy over HTTPS (`https://172.24.255.68:8443`) | 89 pass; the basemap cache-trigger test cannot run over an untrusted certificate and passes over http |
| Lighthouse, mobile, median of three ([perf.md](perf.md)) | Planner 68 (main 69), share 67 (67), Follow 61 (new); accessibility 100 on all three |
| First-load JavaScript, gzip | `/` 187.25 KB (+4.34 KB over the Phase 5b-fix baseline, budget 5 KB); `/follow` 171.95 KB |

Screenshots, light and dark (start, running, off route, finished, permission denied, and more): [screenshots/](screenshots/).

The first Lighthouse run found a regression from this phase: the planner at 55, because the restore code redrew the setup after every load. Fixed, with a browser test ([perf.md](perf.md)).

## Browser limits

- **Foreground only.** Every browser stops giving the location to a page whose screen is locked or which is in the background. There is no background tracking, and a web page cannot get it. GATHO says so on the start screen and recommends the GPX in Organic Maps or a watch for long runs.
- **HTTPS is needed** for the location: the Caddy address on the LAN, never `http://<ip>:3000`.
- **The screen stays on only where the browser has the Screen Wake Lock API** and the phone's battery saver allows it. Otherwise one line says so.
- **Vibration needs `navigator.vibrate`**, which iPhones' browsers do not have. The banner still shows.
- **Voice cues depend on the phone's voices.** They are offered only when the browser reports an English voice as on the device (`localService`); some browsers may report this differently from what the voice really does.
- **iPhones are stricter** about speech before a tap, wake locks and background pages. Nothing was tested on one.

## Not tested on real devices

Everything above ran in desktop Chromium with phone viewports and a simulated position. Not tested:

- **The Redmi lock test:** start Follow outside, run for a few minutes, lock the phone for 60 s while moving, wake it, and time how long "Finding you..." takes until the first fix. Note whether the progress jumped to the right place and whether the "You were away" line was right.
- Whether Android Chrome reports its voices as on the device, and how the cues sound outside.
- The real Android Back gesture during a run and after a refresh.
- Vibration, the wake lock with the phone's battery saver on, and GPS accuracy under trees and between buildings.
- Google Maps with the new waypoints, on a phone and on a computer.
- My Maps import of the GPX, by hand.
- An iPhone at all.

## Open

- **Storing the time of the last fix** for a run, which would remove most of the out-and-back's wait after a refresh. Not approved, not stored.
- **Follow's largest paint** waits for the route (Lighthouse 61). Showing the start screen's fixed text before the route arrives would help. Not built.
- **The rest of the Phase 5e brief** (faster reload, the bundle budget in CI) is cut off after "Fail the build" and is not built.
- **The development API container** has not been rebuilt for A14 and A15. There is no migration; back up before rebuilding, as always.
- Still open from earlier phases: the hallway test (`docs/reports/phase5b/hallway/script.md`) and the shared per-IP limits behind Caddy.
