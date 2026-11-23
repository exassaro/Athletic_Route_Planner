# Intelligent Athletic Route Planner: Research & Development Blueprint

Nov 16, 2026 · @Azzm

## Phase 5e amendments

Items 1 to 3 of the Phase 5e brief (resume on refresh), brought forward on 2026-11-22 at the product owner's request and built with Phase 5d step 7. The rest of 5e (faster reload, the performance guard) is not built, and its brief is cut off after "Fail the build". The solver and the API do not change. Where these amendments conflict with an earlier amendment or a later section, they win.

1. **The address is the truth for a computed plan:** `/?plan=<plan_id>&v=<version>&r=<candidate>`, with `&edit=<saved_id>` while a saved route is edited, updated with replaceState.
   - On load that version is read (`GET /v1/plans/{id}/versions/{n}`) and shown as a fresh result. A restore never solves. Edits then name that version (`from_version`, Phase 5c amendment 7).
   - The plan id is still private: only its own client can read it, and opening the address without a token makes no session.
2. **This tab keeps the rest** in sessionStorage, `gatho:draft:v1`: the setup's step and draft, the sheet's position, the open editor, the map's view, and the plan's pointer with its undo list (so the way back from Saved routes restores the run).
   - **No geometry, no GPS position, no token.** Stops keep their OSM ids and are built again by the API before planning. A start taken from "My location" is not kept (nor the view then): the setup says so.
   - Written 300 ms after the last change and on pagehide or hidden. Older than 12 hours, another schema or unreadable: a clean start.
   - The sheet waits for the restored state before it paints. The map jumps to its view without animation.
   - A plan not found says "That run is no longer available", with the draft filled in. Offline or a server error keeps the draft and offers "Try again". A plan made on other engine builds says "Built on an older map".
3. **"Plan a new run"** in the menu and, once a route exists, "New run" in the sheet's header. It clears the address, the tab's draft and the editing state and shows step 1, with "Cleared your run. Undo" for 10 seconds. Closing the tab starts clean. No beforeunload prompts.
4. **No accidental reload:** `overscroll-behavior-y: contain` on html (item 4's first part only).

5. **The elevation chart is loaded when there is a route**, not in the first load of `/` (item 6's list), which keeps `/` within 5 KB of the Phase 5b-fix baseline.

6. **A run in Follow mode survives a refresh, in its tab only** (decided 2026-11-23; it replaces "nothing about a run is saved ... in the browser" in Phase 5d amendments 4, 5, 8, 10 and 11).
   - sessionStorage `gatho:run:v1` holds three things: **metres done, the start time and the pauses** (their total, and since when the open one; Stop is the last pause, with a mark). With them only the schema and the route's id, so the metres are never applied to another route.
   - **No coordinates, no time of the last fix, no gaps.** Metres along a known route still say where the runner is, which is why this needed a decision. They are never sent or logged.
   - The tracker takes the earliest time those metres could have been reached (5 m/s, 100 m of slack) as its last match, so the window is not too small. [Simulated](reports/phase5d/follow.md): 4 wrong passes in 14,400 refreshes, against 1 with the time stored.
   - Coming back shows "Your run is still going", and the location is asked for only when "Carry on" is tapped. The summary then says that earlier time away and skipped parts aren't known.
   - It is cleared by Done and by "Plan a new run" (whose Undo puts it back), replaced when another run starts, and ignored after 12 hours (*default*, as the draft).

**Not covered:** an edit still being solved at the moment of the refresh, where the version before it comes back.

## Phase 5d amendments

Decided 2026-11-22 by the product owner: route fidelity and Follow mode, before Phase 6. The solver does not change. Every API change is additive. Where these amendments conflict with an earlier amendment or a later section, they win. Items marked *default* fill in a detail of the approved plan and stand until the product owner changes them. They replace:

- Phase 5 amendment 4's "never computes a position along a route", for Follow only (decision 5);
- Phase 5b amendment 18's "only UI bearing", with one more (decision 5);
- Phase 5b amendment 13's hops, on the Follow screen only (decision 14);
- Phase 5b amendment 20's Google Maps and GPX items (decisions 1 to 3);
- section 6's "live turn-by-turn navigation is deliberately out of the MVP", for a foreground-only web Follow mode. Background tracking, offline maps and watch sync still wait for a native app (sections 14 and 19).

**Decisions: route fidelity**

1. **Google Maps is an overview; the GPX is the exact route.** The link stays `travelmode=walking` (driving is road-only and obeys one-ways). It has at most 3 waypoints on a mobile browser (a coarse pointer and a narrow viewport, or the user agent; one tested function. *Default:* narrow is under 900 px, the app's desktop breakpoint, of the viewport or the screen, whichever is smaller, because a phone's "Desktop site" widens only the viewport) and 9 elsewhere, [Google's limits](https://developers.google.com/maps/documentation/urls/get-started).
2. **A14, overview points:** `GET /v1/routes/{route_id}/overview-points?max=N` and `GET /v1/share/{slug}/overview-points?max=N`, 1 ≤ N ≤ 9.
   - Start and end are fixed. The route point that deviates most from the Valhalla pedestrian route between its current neighbours is added (maximum distance, sampled every 25 m) until N are used or every deviation is under 30 m.
   - It returns the points in route order, `max_deviation_m` and `overlap_pct`: the share of our length within 30 m of that Valhalla path, **leg by leg** (decided 2026-11-22: against the whole path an out-and-back scored 100 % while 1.9 km short). Valhalla stands in for Google.
   - It uses the solver's Valhalla client, is cached by route, N and Valhalla build, and counts against the "read" limit. Valhalla down: 503 in the usual error shape, and the web app uses evenly spaced km marks.
   - The rule stays greedy. It must deviate less than even spacing at N = 3 and N = 9, the limits the app uses, on A01 and S02 (tested; decided 2026-11-22 after [the measurement](reports/phase5d/overview.md): at N = 1 and 2 it can tie or lose).
3. **"Open in...", in this order:**
   - **"Get GPX (exact route)"**, the primary button. It shares the file where the browser can. Otherwise (Chrome on Android refuses `.gpx`) it downloads it and says how to open it. Under it: "Open it in Organic Maps or OsmAnd (free, offline maps) to see the exact line."
   - **"Google Maps (overview)"**, with "Google may re-route between points, so the path and distance can differ. Our route: <km>. Estimated overlap: <n>% (tested with our router, not Google)." Above 95 the number reads "over 95%" (decided 2026-11-23), because it is our router's estimate. Without overview points the last sentence is left out. The estimate is never called Google's path.
   - **"How to see the exact line in Google Maps"**, collapsed: the steps from [My Maps help](https://support.google.com/mymaps/answer/3024836), saying "needs a computer", because My Maps is not available on Android or iOS.
   - Garmin and Strava stay as manual notes.

**Decisions: Follow mode**

4. **`/follow?saved=<saved_id>`, `?route=<route_id>` or `?share=<slug>`**, from a "Follow" button on the saved route card, the route card and the share page. A visitor never gets a session. It is foreground only and needs HTTPS. Nothing about a run is saved on the server. Its tab keeps three values until Done (Phase 5e amendment 6).
   - It opens in the same tab from all three. The planner restores itself on the way back (Phase 5e amendments 1 and 2).
   - The saved route's card has three buttons (Open, Edit, Follow).
5. **What the UI may work out, in Follow only:**
   - the runner's position along the route, by snapping to the line and interpolating between the API's metres per vertex. Every route distance still comes from the API's measurement;
   - the straight-line distance back to the line, always labelled straight-line;
   - the bearing back to the line, shown in words.

   None of the three is sent or logged. Of them only the metres done are stored, in the tab (Phase 5e amendment 6).
6. **A15, follow data:** `GET /v1/routes/{route_id}/follow` and `GET /v1/share/{slug}/follow`, fetched once, before the run. They return the route's vertices, the metres along the route at each, and the cues. The vertices come in the same answer, so they cannot belong to another route than the metres when a share link is updated.
   - A cue is a bearing change over 35° within 20 m, at a junction, with the road's name where Valhalla has one: "In 300 m: turn left onto <road>", otherwise "In 300 m: turn left". Cues under 50 m apart are merged (*default*): the later turns follow ("turn right, then left"), none is dropped.
   - At a junction: within 15 m along the line of a node where another walkable edge meets it (*default*, from [the measurement](reports/phase5d/cues.md)). A turnaround is always a cue.
   - The name is the road after the turn (*default*). It is left out when it is the road the runner is already on, and a name that is only a class of road ("MDR") is never used.
   - Valhalla down: still 200, with cues from the geometry alone and no names (`cue_source` says which). A stretch Valhalla cannot match keeps its bends as unnamed cues.
7. **Location never leaves the device.** Permission is asked only when Follow is tapped, with one line saying why. No request may depend on a position: no API call carries one, and the map loads the tiles of the route's corridor at the start, then none for the moving camera. A browser test checks this.
   - The corridor is zoom 9 to 12 over the route's box and 13 to 15 within 1 km of the route, served from memory. Outside it the map is blank (*default*).
   - The Follow map's style names no fonts URL, so MapLibre draws labels with the device's fonts: with the URL it fetches a font file as new labels come into view, which says where the camera is.
8. **Progress is the snapped distance along the route**, never a sum of GPS steps, within a forward-only window.
   - Where passes tie while tracking, the one nearest the expected progress wins.
   - After a gap of T seconds the window is 5 m/s × T + 100 m, back to normal after three good fixes.
   - While off route the window grows by the same formula, T being the seconds since the last on-route fix, so a runner who rejoins further ahead is found (decided 2026-11-22; [simulated](reports/phase5d/follow.md): found in every trial on A01, S02 and the out-and-back, in seconds at the median).
   - *Defaults from that simulation:*
     - a rejoin beyond the normal window counts after 40 m along the route, so a crossing moves nothing (after a lock a single fitting pass is taken at once);
     - direction decides after 20 m of movement, or 2.5 times the accuracy if more; a pass the runner could have walked back to is a candidate and never lowers progress;
     - a jump is refused while the pass just behind explains the fix as well;
     - fixes worse than 50 m only move the dot; within 15 m of the end is the end.
   - If more than one pass fits after a gap, progress is held until the direction of the following fixes decides. Expected pace never decides after a gap: on S02 it jumps to the finish after a 33 minute lock at the start.
9. **Off route:** an amber banner, with a short vibration where supported, after more than 40 m from the line for 10 s **and** two consecutive fresh fixes with accuracy under 30 m. With worse accuracy it says "GPS is weak" and does not guess. The distance is to the nearest place on the whole route, so another pass of it is never off the route: progress and cues wait (*default*).
10. **Screen lock.**
    - On hidden: the time and last snapped position are kept in memory and the off-route timer stops.
    - On visible: "Finding you...", the wake lock is asked for again, and `getCurrentPosition` runs with maximumAge 0 and a 15 s timeout. A fix over 10 s old is discarded.
    - After more than 30 s away: "You were away for 2 min 10 s. Cues are off while the screen is locked." (with the real gap). The summary counts the gaps.
    - Elapsed time comes from timestamps, never from a timer.
11. **Start screen:** "Locking your phone pauses GATHO's tracking. Keep the screen on, or use the GPX in Organic Maps or on a watch for long runs." A missing or refused wake lock shows one line. A refused location permission shows a calm message.
    - **Back during a run** (added 2026-11-22 at the product owner's request) asks "Stop this run?" instead of losing it: one history entry made in a tap, no beforeunload prompt. A second Back leaves, and the run can be carried on from this tab (Phase 5e amendment 6).
12. **Screen and HUD:** the map shows the route with the part done dimmed, and a live dot with its accuracy ring. At peek: km done, km left, elapsed and pace in the pixel numerals with `data-value`, and the next cue. Pause, resume and stop. Stop shows a summary (distance done, time, gaps) and "Done".
    - The distances and pace are labelled "along the route", because a shortcut counts as done. When progress jumped over a part, the summary says "includes a skipped part" (decided 2026-11-22).
    - When the runner may have finished while locked (the window reaches the end, and they are at it or not yet found), Stop asks "Did you finish the route?", and a yes records 100 % (decided 2026-11-22: a loop's finish cannot be told from standing at its start). Any other Stop asks "Stop this run?" once, because a stopped run can't be carried on (*default*).
13. **Voice cues:** English, off by default, offered only with an on-device voice (`localService`), because a remote voice sends the text away.
    - *Defaults (step 8):* a turn is said within 100 m ("In 90 metres, turn left onto Beach Road.") and at it ("Now, turn left."). A merged cue says its first two turns, as the screen does; a turn already said as a "then" is said again only at it.
    - It speaks only while cues show, cancels mid-sentence on pause, stop, the screen lock or leaving the route, and never queues an old cue. A road name in another script is left out. The reader's own English voice is picked first, never the browser's default unless it is on the device.
    - It is turned on from a tap (browsers speak only after one), with "Voice cues on.", and is not kept: a refresh turns it off.
    - The off-route buzz is 200 ms, once each time the banner appears.
14. **Motion and battery:** the sneaker pin stays still (the live dot is the runner) and reduced motion is respected. "Battery saver" is an optional near-black HUD with no map animation; the screen stays on. It also darkens the map, keeping the sprite already loaded so that it makes no request during a run (*default*).
15. **Gates:** no Lighthouse regression, with `/follow` reported; the Follow code and the contents of "Open in..." are not in the first load of `/`; both themes; 44 px targets. The report gives the overlap before and after, the browser limits, and what was not tested on real devices, with the Redmi lock test (lock for 60 s mid-run, wake, time the first fix).

**Found while planning** (2026-11-22, this laptop, throwaway simulations with GPS noise of 5 m sigma on the committed A01 and S02 tracks; the out-and-back is A01's first half and back):

- While tracking with the closest point alone, 10 of 20 out-and-back runs were at some point over 100 m wrong in progress; with decision 8's tie-break, none.
- After a 15 minute lock on the out-and-back, the first fix alone picked the wrong pass in 3.5 to 4.2 % of wakes; the direction of the fixes in 0.5 % with 6 fixes and 0 % with 16, for a runner moving at 1.5 to 4 m/s.
- A bare 35° bend rule gives 55 cues on A01, 10 of them under 50 m apart: hence decision 6's junctions and merging.
- Holding progress for a runner who has not moved was simulated in step 5 ([follow.md](reports/phase5d/follow.md)): no jump except 4 in 500 with poor GPS on S02.

**Status (2026-11-22): in progress.**

## Phase 5c amendments

Decided 2026-11-22 by the product owner: manage saved routes (rename, edit, delete) before Phase 6. The solver does not change. Every API change is additive; migration 0005 is the one schema change. Where these amendments conflict with an earlier amendment or a later section, they win. They replace Phase 5 amendment 11's "no deleting a saved route" and Phase 5 amendment 7's closed list of API changes (A10 to A13 are added).

**Decisions**

1. **Delete is a soft delete with Undo.** The route leaves "Saved routes" and its share link answers 404 with the same body and the same page as an unknown slug. Undo restores both. Deleting again answers 204 while the row exists. `python -m athlete_api.purge_deleted --days 30` removes rows deleted more than 30 days ago; there is no scheduler. Routes and plan versions are never deleted by these endpoints.
2. **Edit reopens the saved route in the planner** (`/?edit=<saved_id>`) at its own plan version. Saving then offers "Update <name>" (the same saved route and slug, now pointing at the selected route; with Undo) or "Save as new". The UI says that anyone with the share link will see the updated route. Update is off while nothing has changed, judged on the request and the geometry, because returning to an earlier request makes a new route id.
3. **Rename is an in-app dialog and a PATCH**: trimmed, at most 80 characters, empty means no name. The Phase 4 save call still renames and keeps its limit of 200.
4. **Owner only, anonymous clients as before.** Another client's `saved_id` answers 404, never 403. Saved routes live on the device that holds the token.
5. **Migration 0005** adds `saved_routes.deleted_at` and `updated_at` (backfilled from `created_at`) and an index on (client_id, deleted_at). `updated_at` moves on rename and on update, not on delete or restore, so Undo puts a card back where it was. **The downgrade deletes soft-deleted rows first**: dropping the column alone would republish deleted links.
6. **A10, the saved-route endpoints:** `PATCH` and `DELETE /v1/me/routes/{saved_id}`, `POST /v1/me/routes/{saved_id}/restore`; `GET /v1/me/routes` leaves out deleted routes, orders by `updated_at`, newest first, and gains `updated_at` and `plan_version`. CORS allows DELETE.
7. **A11, `from_version` on `PATCH /v1/plans/{id}`** (optional): the patch applies to that version's request and the diff is against it. Without it, editing a saved version that is not the latest would silently apply the edit to another request. The new version is still the next number.
8. **A12, `as_new` on `POST /v1/routes/{id}/save`** (optional): always a new saved route with a new slug. Without it the save renames the most recently updated live saved route of that route, or makes one. A save never revives a deleted row or its slug. Several saved routes may point at one route.
9. **A13, `updated_at` and `is_owner` in the share response.** `is_owner` is true only for the owner's token; no token or an unknown one gives false, never 401. The response is `no-store`. The share page is rendered on the server without a token, so the browser asks again with the token it already has; it never creates a session for a visitor.
10. **The "write" rate limit:** 60 a minute per client (configurable), none per IP, because behind the proxy every client has the proxy's address.
11. **Delete in menus** uses the one warning colour (Phase 5b amendment 4) with a trash icon and a divider, last in the list.
12. **Undo after a delete** shows for 10 seconds, paused while the message has the pointer or the focus, and survives the move to the saved-routes page.

**Found while planning, for a separate change:** behind Caddy every client shares the proxy's IP, so the per-IP limits (10 new sessions an hour among them) are shared by all users. Trusting forwarded addresses also needs port 8000 closed to the LAN.

**Status (2026-11-22): built** ([docs/reports/phase5c/summary.md](reports/phase5c/summary.md)). Deployed the same day, after a backup: the development database is at 0005.

## Phase 5b amendments

Decided 2026-11-18 by the product owner: a mobile-first redesign of `web/` before Phase 6, under the name **GATHO**. There are no new features. The API and the solver do not change unless a change is listed and approved first. Where these amendments conflict with an earlier amendment or a later section, they win. Items marked *default* came from the Phase 5b plan and stand until the product owner changes them. Mockups: the GATHO 5b canvas (claude.ai artifact, private); sprites: [docs/reports/phase5b/sprites.md](reports/phase5b/sprites.md); baseline: [docs/reports/phase5b/before/README.md](reports/phase5b/before/README.md).

**Decisions**

1. **Name: GATHO** (Malayalam ഗതി, "gathi": movement and direction). Used in the top-bar wordmark (drawn, never typed: amendment 26), page titles, the PWA manifest (name and short_name "GATHO"), the share page, OpenGraph tags and the about screen. Python packages, the repo and API paths keep their names.
2. **Look: playful retro, minimal.** At most three retro elements visible on any screen, counted from: the wordmark, pixel numerals, map markers, the hard shadow. The pixel icon set is the icon style and is not counted (*default*). On route screens the top bar is search and menu; the wordmark sits in the top bar on the setup steps, the share page and saved routes, and in the menu and about (*default*).
3. **Type.** Pixel font (**Silkscreen**, OFL, self-hosted subset; it replaced Pixelify Sans on 2026-11-18 because Pixelify's "5" reads as an "S") only for the big stat numbers (distance, time, climb) at 24 px or more, with tabular figures; never for the wordmark (amendment 26, 2026-11-22), body text, labels, place names, anything under 20 px, or Malayalam. Body text is the system font at 15 to 16 px (*default*; the mockups use Inter).
4. **Colour tokens** as in the mockups' brand board, with **accent #0F6E56** (light; dark #3DBFA3) for the route and primary actions, one warning colour (amber), a second route dashed in ink, never colour alone. Body text 4.5:1 or more; controls and the route line 3:1 or more, checked in both themes.
5. **Themes: light and dark, with a toggle in the menu; the default is light** (changed from dark by the product owner, 2026-11-18). The choice is kept on the device. The dark basemap is the Protomaps dark flavour of the same pinned build (its sprites fetched by `fetch_basemap.py`; the tiles do not change).
6. **Markers** (changed 2026-11-22, amendments 13, 16, 17 and 22). The start pin is the supplied pixel **sneaker** (31 × 17), mirrored when the route starts westward (bearing from the start to the API's first km mark; the first geometry segment until that arrives), anchored at the middle of the sole, about 48 px wide, tap target 44 px or more, aria-label "Start: <place>". Its hop (1.1 s, toe up about 6°, squash on landing, shrinking shadow) is CSS on an inner element only, and runs only as amendment 13 says; none under prefers-reduced-motion; paused while the map moves and while a solve runs; static in thumbnails. Stops are pixel discs, overlapping stops grouped on screen, pass-near place points as pixel diamonds, the end a pixel flag. The sneaker is also the mascot and the loading animation (amendments 16 and 17); the runner sprite is withdrawn. Sprites become static SVG components at build time (rects, crispEdges, depth layer of non-outline pixels offset 0.3 px, black at 20 %). The side mark on the sneaker is a forward arrow, never a swoosh or stripes.
7. **App icons** show the GATHO O, not the sneaker (changed 2026-11-22, amendment 27). The sneaker is the map pin and mascot only.
8. **Layout.** Bottom sheet with peek, half and full; first-time setup as five steps (start, distance, shape, towards, stops); chips open small editors and the permanent form goes; route cards with pixel numbers, road-class bar with a text legend, badges, "Why this route?"; stops as a timeline with distance marks; over_budget and conflicts as one headline with the API's numbers and fix buttons, no repeated text; Undo as a message at the bottom, history and redo in the menu.
9. **Every number on screen is still the API's.** The number check runs at every sheet state (peek, half, full) so hidden numbers are still checked. The A01, S02 and G01 journeys keep their intent; only selectors change.
10. **Gates:** Lighthouse accessibility 95 or more (was 90), touch targets 44 px or more. Performance is reported before and after, measured the same way (through Caddy on the LAN address, Lighthouse 13.0.1 mobile, median of three runs); the start pin has no main-thread cost at rest: resting, it measures the same as with the pin removed (reworded 2026-11-22, amendment 13).
11. **A8 approved (2026-11-18):** GPX `creator="GATHO"` and a GATHO metadata name. An API change (the API writes the GPX); built in step 10, XSD test kept.

**Phase 5b-fix (approved 2026-11-22)**

A round of fixes and small features on top of the built Phase 5b, with the final logo. These are the exceptions to "no new features" above. The solver does not change; the only API change is A9 (amendment 22).

*Bugs*

12. **Basemap fetches bypass the browser cache.** Chrome on Windows can return zero-filled bodies for cached Range responses after overlapping requests were aborted ("Wrong magic number for PMTiles archive"). pmtiles avoids the cache only when the user agent contains "Windows", which device emulation removes. So:
    - the `.pmtiles` is always fetched with `cache: "no-store"` and served with `Cache-Control: no-store` (`no-cache` does not prevent the bug);
    - a failed load is retried once, then the map shows a message with "Reload map";
    - the OSM credit stays visible when tiles fail.
13. **The pin hops three times (about 3.3 s), then rests.** It does so when a route arrives, when the start changes and when a saved or shared route opens, and hops once per tap or key press. Zooming and theme changes do not replay it. Nothing loops while idle.
14. **Map labels and markers.**
    - Km labels show from zoom 12 and are hidden where they would overlap a stop, the pin or another label; they draw above the route lines.
    - The end flag's pole stands on the end point and the flag points away from the route; place labels give way to it.
15. **Sheet.** The Undo message sits just above the sheet (at full, in its own row under the handle) and never covers content. The peek stats show only at peek. The chip row fades at its clipped edge and snaps.

*Features*

16. **The mascot is the sneaker** at 3 px a pixel (93 px wide), with a soft ground shadow and the three hops of amendment 13. The runner and its run cycle are deleted.
17. **Loading is a four-frame sneaker cycle**, derived from the approved sprite by whole-pixel column shifts, with no pixel redrawn. For column x from the heel (0 to 30), y pointing down:
    - frame 1: flat;
    - frame 2, toe up and lifted: dy = -1 - floor(x / 11);
    - frame 3: flat, dx = 3;
    - frame 4, heel up: dy = -floor((30 - x) / 11), dx = 1.

    Two or three dust puffs follow it, with three pixel dots to the right and "GATHO is planning...".
18. **Directions are shown in words** ("North-east"), each with where it lies on the map as currently rotated, and an eight-point dial. The request's values are unchanged. **Exception to Phase 5 amendment 4, for a label only:** when the direction is a place, the UI may work out the bearing from the start to that place to say "Heading south-east, towards Beypore". That bearing is never sent, stored or used for anything else. (Follow mode adds one more: Phase 5d amendment 5.)
19. **Compass.** A pixel compass (44 px or more) under the menu button replaces MapLibre's: its needle points to true north and a tap faces the map north. In the direction picker it also marks the chosen direction.
20. **"Open in..."** on the result, the share page and each saved route (the Google Maps and GPX items are replaced by Phase 5d amendments 1 to 3):
    - **Google Maps (walking):** at most 3 waypoints on a phone and 8 otherwise (Google allows 3 in mobile browsers and 9 elsewhere), chosen evenly from the API's km marks, with a note that Google may change the path between them. Nothing is measured in the UI.
    - **Share the GPX:** Web Share with a file where the browser allows it. Chromium, desktop and Android, refuses `.gpx` even when `canShare` says yes, so a refusal downloads the file and says so.
    - **Download GPX**, as before.
    - **Garmin:** no button; a link to Garmin's help (its import steps could not be verified).
    - **Strava:** no upload link, because Strava rejects files without timestamps as activities and our courses have none. A link to Strava's "create a route from a GPX" help, marked manual.
21. **The share page, which is also the saved-route view, uses the planner's sheet**, opening at peek with the stats in the peek bar and a "Map" button; the desktop panel collapses. Its stops are grouped as in the planner.
22. **A9 approved: `km_marks` in the share response.** Additive: every km mark, the same as the elevation endpoint's. The pin faces as in the planner and "Open in..." has its points.

*Brand*

23. **One build script, `web/scripts/make-brand.mjs`**, draws the wordmark, icons and OpenGraph image from the supplied grids.
24. **Logo colours are tokens:** light letters #1E1E1C and O #1D9E75; dark letters #F7F5EE and O #3DBFA3; the dot #E8673A in both.
25. **Logo contrast.** In the light theme the wordmark is always backed by the surface token (#FBF8F1: O 3.19:1, dot 3.08:1; on paper both fall under 3:1). The dot on the icon's green tile (1.04:1) is decorative and exempt from amendment 4.
26. **The wordmark is never set in a font.** It is 5 × 7 pixel letters with a one-cell margin, at least 14 px tall; smaller, the icon is shown instead.
27. **App icons:** a 9 × 9 green tile with cut corners, the paper O and the orange centre. The maskable icon is a full square on an 11 × 11 grid, so the O stays in the 80 % safe circle (on 9 × 9 its corners reach 42.3 % of the side from the centre, over the 40 % limit).
28. **OpenGraph image** 1200 × 630 on #FBF8F1 (amendment 25), without a shadow, the tagline "Plan the run you actually want." in the Geist font bundled with Next, so the build is reproducible. Absolute links come from a site-URL build setting.

**Status (2026-11-22): built 2026-11-18; Phase 5b-fix built 2026-11-22** ([docs/reports/phase5b/fix-summary.md](reports/phase5b/fix-summary.md)).
- Results: the journeys pass through Caddy; Lighthouse accessibility is 100 on both pages; performance went from 68 to 70 on the planner and from 67 to 69 on the share page.
- The hopping start pin cost about 2 % of the main thread at 4× slowdown. Fixed 2026-11-22 (amendment 13): at rest it measures 52 ms per 5 s, against 56 ms with the pin removed.
- Open: the hallway test waits for the product owner.

See [docs/reports/phase5b/summary.md](reports/phase5b/summary.md).

## Phase 5 amendments

Decided 2026-11-18 by the product owner at the start of Phase 5, the web front end and map in `web/`. There is no LLM chat (Phase 6) and no drag-to-edit (Phase 7). The solver does not change; a front-end need that requires an API change is listed and approved first. Where these amendments conflict with an earlier amendment or a later section, they win. Sections 13 and 15 (Phase 5) are updated to match.

**Decisions**

1. **Stack:** Next.js (App Router), TypeScript and MapLibre GL JS. The share page is server-rendered; the planner is client-side.
2. **API types are generated from the OpenAPI schema** (openapi-typescript, with openapi-fetch as the client). There are no hand-written copies of `RouteRequest` or `SolveResult`. A CI check (GitHub Actions) fails if the generated types are stale.
3. **Basemap: self-hosted vector tiles for Kerala**, a PMTiles file served as a static file: no API key, no per-load fee. OSM attribution is always visible. The tiles are built with Planetiler (Protomaps basemap profile) from the pinned extract (`engine/osm_pin.json`), so the map shows the roads the router used; fonts and sprites are self-hosted too. Fallback: `pmtiles extract` from the Protomaps build nearest the pin, with its date recorded.
4. **One source of truth: the current `RouteRequest`.** Every control edits it, and every edit is sent as a JSON Patch to `PATCH /v1/plans/{id}`. The UI never computes a route, a distance, a position along a route (Follow mode excepted: Phase 5d amendment 5) or an endpoint. Everything shown comes from the API response.
5. **Running time = foot length × the user's pace** (stored in the browser, default 6:00 /km, editable). This is arithmetic on a measured distance, not an estimate, and is labelled "at your pace". The engine's walking duration is not shown.
6. **Mobile first:** a full-screen map with a bottom sheet; a side panel on desktop.

**Implementation choices** (from the Phase 5 plan, accepted 2026-11-18)

7. **API changes in Phase 5** (the solver is unchanged by all of them):
   - **A1 CORS** for the front end's origins, configurable (`ATHLETE_CORS_ORIGINS`).
   - **A2 GPX:** the end waypoint of a loop or an out-and-back is named after the start plus "finish"; `?ele=false` leaves out `<ele>`.
   - **A3 Typed diff:** the PATCH diff gets its own schema model; the JSON is unchanged.
   - **A4 Fix patches:** every `Fix` and `Saving` carries the RFC 6902 patch that applies it, built by the API from the request (`null` when it cannot be built unambiguously or the action is not supported).
   - **A5 Positions along the route:** each elevation profile sample carries its position, and the route carries km marks, from the same geometry sampling. The UI never measures geometry.
   - **A6 OSM features:** `GET /v1/places/{place_id}/feature` returns the OSM way ids, lines and boundaries a request item needs (bridges, roads, the pass-near boundary fallback), from an `osm_features` table loaded from the pinned extract. This is OSM geometry from the pin, not a geocoder cache: amendment 16 of Phase 4 ("no places table") still holds.
   - **A7 (pending the elevation report):** a smoothed profile for the chart and a noisy-climb flag. Any change to the solver's gain and loss is a separate decision.
8. **Place picker:** duplicates of the same place (same name and county: village, boundary, station) are grouped in the UI, with each member's kind listed. No distance is involved; the user still picks.
9. **One origin in production:** a Caddy service serves the web app, `/v1` and the tiles together (and HTTPS on the LAN with `tls internal`, which geolocation on a phone needs). CORS is then needed only for development.
10. **Lighthouse:** accessibility ≥ 90 is a gate; performance is reported as measured.
11. **Left out:** deleting a saved route (no endpoint; replaced by Phase 5c amendment 1) and "Remix this route" (the plan id stays private).

**Decided after the elevation report** (2026-11-18, [docs/reports/phase5/elevation.md](reports/phase5/elevation.md))

12. **Basemap: the fallback of amendment 3.** `pmtiles extract` of the Protomaps daily build of 2026-11-15 (the pin's day) for Kerala, instead of Planetiler, which needed Java 21, Maven and a 908 MB coastline download. The build date is pinned and recorded.
13. **Climb over bridges (solver change, P3):** the solver's `climb` replaces the heights over bridge edges (Valhalla `edge.bridge`) with a straight line between the bridge's ends before smoothing; the DEM gives the water there, not the deck. Smoothing is otherwise unchanged (5 samples, 3 m). `Candidate.bridges_m` carries the spans so the chart uses the same series. Gain and loss are not used in scoring, so no route changes.
14. **Smoothed profile (P1):** the elevation endpoint also returns the profile smoothed exactly as the solver smooths it, bridges included; the chart draws that series.
15. **Approximate climb (P2):** a candidate whose route has a median DEM height under 20 m is marked `climb_approximate`; the card shows "approx." and says why.

## Phase 4 amendments

Decided 2026-11-18 by the product owner at the start of Phase 4, the backend API in `api/` (evidence: [docs/reports/phase4/memory.md](reports/phase4/memory.md)). There is no front end and no LLM in this phase. The solver's behaviour does not change: if the API needs a solver change, it is raised with the product owner first. Where these amendments conflict with an earlier amendment or a later section, they win. Sections 11, 12 and 15 (Phase 4) are rewritten to match.

**Decisions**

1. **The API exposes the solver's own models as they are**: `RouteRequest`, `SolveResult`, `Candidate`, `Conflict` and `Flag`. This covers:
   - the `over_budget` outcome;
   - the "recommended" and "shortest" alternatives;
   - the Case B options;
   - `via`, `avoid` and `must_use`;
   - pass-near and `must_reach` checkpoints;
   - loops.
2. **Stack:**
   - FastAPI and Pydantic v2;
   - SQLAlchemy 2 with Alembic;
   - PostgreSQL 16 with PostGIS, and Redis;
   - all in docker-compose next to the engines, and managed by uv like the rest of the repository.
3. **Solves run in a worker thread**, never on the event loop.
   - A global limit allows 2 concurrent solves (configurable).
   - When the limit is reached, a request waits up to 10 s, then gets 429 with `Retry-After`.
   - Each solve has a 15 s budget. Over it, the API returns 504 with what is known.
4. **Persistence:**
   - **`plans`.**
   - **`plan_versions`:** the full RouteRequest as JSON; the source (form, chat or drag); the outcome; the conflict; both engine build ids.
   - **`routes`:** the geometry as a PostGIS LineStringZ; the foot length; every stat and flag the Candidate carries; the label.
   - **`saved_routes`**, with share slugs.

   Lengths stored are the solver's measured ones and are never recomputed in SQL for display. `ST_Length(geography)` is used only as a cross-check in tests.
5. **Cache.**
   - The key is a hash of the canonical RouteRequest plus the Valhalla build id and the GraphHopper build id, so a rebuild of either engine invalidates it.
   - The SolveResult is cached in Redis for 24 h.
6. **Edits.** `PATCH /v1/plans/{id}` does four things:
   - takes an RFC 6902 JSON Patch on the RouteRequest and validates it;
   - re-solves;
   - stores a new version;
   - returns a diff against the previous version: the fields that changed, the length delta, the duration delta, whether the end changed, and the stops added or removed.

   Undo means reading an earlier version and posting it as a new one.
7. **Identity.** A client is anonymous: `POST /v1/session` issues a random token, which is sent as a header. Real login is deferred to Phase 8. Requests are rate-limited per client id and per IP.
8. **Geocoding.**
   - `/v1/places/search` and `/v1/places/reverse` go through Photon, biased to a given point and restricted to Kerala.
   - When the top results are close in score, or share a name in different districts, all of them are returned as candidates for a picker. The API never picks one.
   - If Photon is down, the API returns 503 with a clear message, and never falls back to coordinates from anywhere else.
9. **GPX export.**
   - A track with the geometry and elevation, plus waypoints for the start, each checkpoint and the end.
   - It must import cleanly into Garmin Connect and Strava. Tests validate it against the GPX 1.1 schema; the product owner checks the apps by hand.
10. **Explanations.**
    - Each response carries the solver's facts object unchanged, plus a short explanation string built from templates (no LLM).
    - Over-budget savings of 0 m say "dropping X does not shorten the run".

**Implementation choices** (from the Phase 4 plan, accepted 2026-11-18)

11. **`duration_s` is the engine's walking time**, passed through unchanged. Example: A02's 22.26 km "recommended" route is 16,068 s. It is documented as walking time, and the diff's duration delta is a walking-time delta. Explanations do not mention duration. A running-pace estimate waits for a pace source (user profiles).
12. **A 504 cannot carry partial routes**: the solver is synchronous, returns nothing part-way, and a Python thread cannot be stopped.
    - The 504 carries the plan id, `status: "solving"`, the elapsed time and a URL to poll.
    - The solve keeps its slot until it really finishes, so no more than 2 solves ever run. It then stores the version and caches the result, and `GET /v1/plans/{id}` returns it.
    - Returning the best candidates found so far would need a deadline in the solver: a solver change, not made in Phase 4.
13. **The 10 s queue wait is separate from the 15 s solve budget**, so the worst-case response time is about 25 s.
14. **The cache key also holds a hash of the solver's and `athlete_engine`'s source**, so a code change cannot serve stale results.
    - Valhalla's build id is its version plus `tileset_last_modified` from `/status`.
    - GraphHopper's is its version plus its import date from `/info`.
    - Results with `alternative_unavailable` (an engine down) are not cached.
    - The cached value also holds each candidate's elevation, so a cache hit makes no engine call.
15. **Elevation is added by the API, not the solver.** `Candidate.geometry` is two-dimensional. After a solve, one Valhalla `/height` call (through `athlete_engine`) gives:
    - the Z of every vertex: raw DEM heights;
    - the profile, sampled every 30 m (the solver's own step).

    The gain and loss shown are always the solver's smoothed values, never recomputed from Z.
16. **Explanation numbers come only from the SolveResult**: its facts, its conflict (the savings live there) and its candidates' measured stats, formatted but never computed by the API. A test extracts every number from each explanation and finds it in the result.
17. **No `places` table.** A geocoder cache would be a fallback while Photon is down. Search always returns a ranked list, with `ambiguous: true` and the reasons when results share a name, also across districts (Photon's `county`). If Photon exposes no score, "close in score" cannot be measured, and the name rule applies alone.
    - Measured 2026-11-18: Photon 1.3.0 returns no score, so the name rule applies alone.
    - Its `county` is sometimes a district (Kozhikode, Palakkad) and sometimes a taluk (Tirur, Iritty).
    - OSM often holds a place several times (village node, boundary, station), so most common names are ambiguous. "Kadalundi" returns three in Kozhikode; "Chungam" appears in 7 districts or taluks.
18. **Clients and ownership.**
    - `clients` replaces the `users` table until Phase 8, and the token is stored only as a hash.
    - Plans and routes are readable only by the client that created them; any other client gets 404.
    - Share slugs are public.
19. **Undo is a PATCH that replaces the whole request**: `{"op": "replace", "path": "", "value": <earlier request>}`. An optional `If-Match: "v<n>"` header returns 412 if a newer version exists.
20. **One uvicorn worker.** The 2-solve limit is held in that process. A limit across several processes (in Redis) is deferred.
21. **GPX files are courses.**
    - They have no `<time>`, so Strava imports them as routes and Garmin Connect as courses.
    - Waypoints sit where the route passes each checkpoint.
    - `via` and `must_use` items are not waypoints.
22. **Rate-limit defaults** (configurable):
    - solves (create and patch): 20 a minute per client, 40 per IP;
    - reads: 300 a minute per client;
    - new sessions: 10 an hour per IP.

    Being limited returns 429 `rate_limited`, which is distinct from 429 `solver_busy`.
23. **"Same result" means the same outcome, candidates, conflict, facts and flags**, ignoring `elapsed_ms`, `engine_calls` and `edge_ids`.
    - The `edge_ids` are internal and are not part of the API response.
    - The A01 round-trip test runs once through the cache and once with it bypassed.
    - A fresh solve that differs is reported, not fixed in the solver.
24. **Photon stays up during development.** With every engine, Postgres, Redis and Photon up, the Docker VM used 3.7 of 7.7 GiB, with no swap. No stub geocoder is needed; the tests use a fake one.
25. **Left for later phases:** `POST /v1/plans/{id}/messages` (Phase 6) and magic-link login (Phase 8).

## Phase 3 amendments

Decided 2026-11-17 by the product owner after the Phase 3 review (evidence: [docs/reports/phase3/summary.md](reports/phase3/summary.md), [quieter_spike.md](reports/phase3/quieter_spike.md)). These are routing-rule changes for **Phase 3b**, still solver only. Where they conflict with the Phase 2 amendments or a later section, these win. Items marked *default* came from the Phase 3b plan and stand until the product owner changes them. Implementation waits for the rules spike ([docs/reports/phase3b/rules_spike.md](reports/phase3b/rules_spike.md)) and the decision after it.

**Decisions**

1. **Route generator.** GraphHopper foot with a custom model is the default generator. Valhalla stays the single yardstick for measurement, road classes, checkpoint checks and the access check, as in the KPI harness. Lengths still come from the geometry (Phase 2 amendment 2).
2. **Road priority, a preference and not a hard rule:**
   - (a) Ordinary car-drivable roads first, including service roads beside highways.
   - (b) Primary roads, mild penalty.
   - (c) Trunk and motorway last.
   - (d) Footways, paths, tracks and steps only when nothing else connects, or when the user asks.

   One-way restrictions are ignored for running. A route using trunk or motorway carries the flag "uses a national highway; running there may be prohibited". `foot=no` stays a hard exclusion.
   - *Default:* motorways stay unwalkable unless tagged `foot=yes`. This is the behaviour of both engines, so "motorway last" means "only where tagged walkable".
   - *Default:* the flag fires on trunk or motorway and names the road from its `ref` tag (for example "NH 66") when it has one.
   - *Default:* the request preference `paths: "avoid" | "allow"` (default `"avoid"`) is how the user asks for footways and paths.
3. **Checkpoints are "pass near" by default.**
   - The route must pass within 1 km of the place point, with no out-and-back spur to reach it. A spur is a dead-end excursion over 100 m that returns on the same edges (section 8, scoring).
   - *Default:* "within 1 km" is the straight-line distance from the place point to the nearest point of the Valhalla-matched route. Like a snap distance, it is a proximity and never a route distance.
   - If no route passes within 1 km without a spur, fall back to passing inside the place's OSM boundary where one exists, and flag it.
   - A checkpoint marked `must_reach` keeps the Phase 3 behaviour: a `break` location, within 50 m of the snapped point.
   - Checkpoints may also be bridges, junctions or named roads.
   - *Default:* a bridge or named-road checkpoint means the route uses it (the same mechanism as `must_use`, decision 7), ordered like any other checkpoint.
4. **Ferries are always excluded.** The ferry opt-in, the ferry fixtures (scenario 6, the ferry variant of scenario 7) and the "allow ferries" fix are removed from the MVP. This replaces Phase 2 amendment 1, except that the exclusion is still done with `exclude_ferries: true` (Valhalla) and a zero priority (GraphHopper), never `use_ferry: 0`.
5. **Tolerance is ±500 m**, replacing the 2% rule. The distance-accuracy KPI (section 16) is unchanged and separate.
6. **Over budget.** When the stops alone exceed the budget, the solver returns:
   - the full route, with outcome `over_budget`;
   - the overshoot in metres;
   - a ready "cut at target" candidate;
   - the savings list.

   Disconnected points and snaps that are too far stay conflicts.
   - *Default:* the full route ends at the last stop.
   - *Default:* a route up to D + 500 m is `ok`, not `over_budget`.
7. **New request fields.**
   - `via`: pass-near points or named roads.
   - `avoid`: places, roads or areas.
   - `must_use`: a named bridge or road.

   An edit holds the distance by moving the endpoint.
   - *Default:* a `via` is for shaping only. It is never dropped, is not listed as a stop and does not appear in the savings list. Checkpoints are named, reported and can be dropped.
8. **Phase 3 proposals accepted.**
   - The repeated-edge limit (hard above 10%, KPI median under 2%) applies to repetition beyond what `must_reach` stops force.
   - The engine consistency check (0.1% / 2 m) gets an allowance of 0.2 m per edge for whole-metre edge lengths.
9. **Alternatives are "recommended" and "shortest".** "Recommended" is the GraphHopper generator under the rules above. "Shortest" is Valhalla pedestrian. "Fewer main roads" is dropped as a separate alternative, because the default now does it; this replaces Phase 2 amendment 3. The diversity filter (overlap under 60%) still applies.

**Acceptance test (from local knowledge)**

The request: from Athanikkal towards Kozhikode, 25 km, passing near Kottakadavu, Kadalundi, Chaliyam, Karuvanthuruthy bridge, Beypore and Kallayi. It must:
- follow that corridor in that order;
- not take a spur into Chaliyam's beach end;
- not use a ferry;
- repeat less than 2% of its road.

Its measured length is reported. If it is over 25 km, the `over_budget` result is shown. Coordinates come from OSM or Photon. *Default:* the solver orders the stops itself, and the test checks that it chooses this order.

Ten further fixtures outside Kozhikode (Kochi, Thiruvananthapuram, Thrissur, Kannur, Wayanad) show that nothing is tuned to one route.

**Decided after the rules spike** (2026-11-17, evidence: [docs/reports/phase3b/rules_spike.md](reports/phase3b/rules_spike.md); these replace the *defaults* above where they differ)

10. **Road-priority model R5.** GraphHopper profile `foot_rules` (hard rules only), with priorities sent per request: primary ×0.6, trunk and motorway ×0.1, footway, path, track, steps, cycleway and bridleway ×0.1, every other road 1.0. `paths: "allow"` sets the path factor to 1.0.
11. **"Within 1 km" is walking distance**: the Valhalla pedestrian matrix from the place point to sample points every 100 m along the route. The straight-line kilometre is only a pre-filter. A straight line is met from the far bank of a river.
12. **National-highway flag.** "Uses a national highway; running there may be prohibited" is raised for 200 m or more of trunk or motorway in one stretch, named from the road's `ref` or name. A shorter stretch carries the note "crosses a national highway".
13. **Checkpoints are ordered on the Valhalla pedestrian matrix** (one call), then routed by each alternative's engine.
14. **One request per run.** GraphHopper's `pass_through` relaxes where a `must_reach` stop needs a U-turn, so no leg-by-leg routing is needed.
15. **The consistency check uses each engine's own earth radius**: Valhalla 6,378,137 m, GraphHopper 6,371,000 m. The threshold is 0.1% or 2 m plus 0.2 m per edge (decision 8).
16. **Boundary fallback stays.** A checkpoint may carry its OSM boundary polygon. If no candidate within 1 km on foot avoids a spur, candidates inside the boundary are tried and the stop is flagged. Without a boundary, the least-added candidate is used even with a spur, and flagged.
17. **Junction checkpoints** are through vias at the junction itself (within 50 m, no spur). **Bridge and named-road checkpoints**, and `must_use` items, are satisfied by the route using one of the item's OSM ways: a bridge through both ends, a road through its point of least added distance.

**Decided after implementation** (2026-11-17, evidence: [docs/reports/phase3b/summary.md](reports/phase3b/summary.md))

18. **Road-suitability KPI** (section 16) measures the **trunk and motorway** share of the "recommended" route: under 10%, or the stretch carries the national-highway flag. Primary share is reported as information, since amendment 2 asks only a mild penalty on primary roads.
19. **Confirmed defaults:**
    - Junction checkpoints pass through the junction (decision 17).
    - With no spur-free pass point and no boundary, the stop is passed with the shortest spur and flagged `pass_near_spur` (decision 16).
    - `over_budget` means every alternative's own way through the stops exceeds D + 500 m. The conflict numbers come from the shorter plan; an alternative whose own way does not fit, while the other's does, returns its full route and cut, flagged `alternative_over_budget`.
    - An avoided place given only as a point is a 300 m circle around it.
20. **Long detours by "recommended" are capped** (decided 2026-11-17). Easing only the trunk penalty was measured and is not enough: on the Wayanad ghat (S13), "shortest" also uses 1.7 km of footpath shortcuts across the hairpins.
    - When "recommended"'s way to the target is more than 30% longer than "shortest"'s, it is re-solved with every road penalty eased step by step until it is within 30%: (primary ×0.8, trunk ×0.3, paths ×0.3), then (×0.9, ×0.6, ×0.6), then none. The result is flagged `detour_eased`.
    - On S13 the second step brings it from +56% to +8%, down NH 766, with the national-highway flag.
    - The direction-adherence KPI is judged on "shortest". "recommended"'s adherence is reported as information, because its detours under 30% are the road rules working (X10: avoiding 19 km of primary road).

After Phase 3b, for Phase 3c (lengthening, then loops; decided 2026-11-17):

21. **Loops are built now, in the solver only.** Section 8 step 10 (lengthening with a via-point) comes first, then the loop generator and the section 16 loop KPIs. Phase 7 keeps the blind test against a competitor, scenic routes, drag-to-edit and per-area circuity learning.
22. **Loop distance:** the hard rule stays ±500 m, but a loop keeps iterating until it is within the smaller of 500 m and 3% of D, so the loop KPI (p90 under 3%, none over 5%) catches short loops that drift.
23. **Loops are generated by GraphHopper R5** (road rules and the national-highway flag apply). The 2 best-scored loops that overlap less than 60% are returned; Valhalla only measures. If GraphHopper is down, Valhalla generates the loops and the result is flagged. The "recommended" / "shortest" pair stays for point-to-point.
24. **Loops with stops: longest leg first, then the others** (decided 2026-11-18). The longest leg of the closed tour is lengthened with one via (section 8 step 10). Only if none of its detours passes the loop rules (no spur, at most 10% walked twice) are the other legs tried, longest first. Measured case: a 10 km loop from Mananchira past Kallai and Calicut Beach, where every detour on the longest leg walked 10 to 18% of its road twice.

**Open implementation questions for the spike** (answered by decisions 10 to 17)
- Open-source GraphHopper has no matrix call. *Default:* checkpoints are ordered on the Valhalla matrix, then routed by GraphHopper. The spike checks that both engines give the same order.
- GraphHopper's `pass_through` applies to a whole request, not to one point. A route mixing pass-near stops (no U-turn) and `must_reach` stops (U-turn allowed at a dead end) may need routing in stretches between `must_reach` stops and joining them.
- Memory: GraphHopper (about 1.9 GiB) and Valhalla now run together, so Photon runs alone, for name lookup only.

## Phase 2 amendments

Decided after Phase 2 (evidence: [docs/reports/phase2/summary.md](reports/phase2/summary.md)). Where these conflict with a later section, these win.

**Decisions**

1. **Ferries are hard-excluded by default** with `exclude_ferries: true`; never rely on `use_ferry: 0`, which still routes over ferries when combined with other options. Ferries are an explicit opt-in. When allowed, ferry metres are reported separately and do not count toward the running distance: **the budget is distance on foot.**
2. **Every distance shown, and every cut, uses ellipsoid geometry length** (WGS84 geodesic length of the returned shape). The engine consistency check compares the engine's reported length with a spherical measurement of the same geometry; threshold 0.1%, with a floor of 2 m so rounding on short routes does not trip it.
3. **MVP alternatives are "direct" and "fewer main roads".** "Flatter" is dropped from the MVP; `hills` stays in the request model and is reported as unsupported. How to build "fewer main roads" is decided after a spike of at most 2 days comparing Valhalla bicycle costing (`use_roads: 0`, re-checked as walkable with pedestrian costing) against GraphHopper's foot profile with a custom model ([docs/reports/phase3/quieter_spike.md](reports/phase3/quieter_spike.md)).
4. **Geocoding is Latin script only for the MVP.** Malayalam-script search needs a custom Photon import and is deferred.
5. **Checkpoints are `break` locations; `through` is only for shaping vias.** Checkpoint compliance (within 50 m) is measured against the point where the route meets the network, not the raw OSM place node, which can sit tens of metres off the road.
6. **Engine warnings** (for example code 401, "retrying with relaxed restrictions") are carried into the result as flags.

**Solver details agreed for Phase 3**

- Conflict savings (dropping a stop, allowing ferries) are computed by routing the variant and measuring its geometry, not from matrix sums: matrix distances are engine lengths and include ferry metres.
- Checkpoint ordering uses exact dynamic programming (the request allows at most 8 stops); OR-Tools is not needed. When ferries are allowed, the two best orders by matrix are routed and the one with fewer foot metres wins. The "heads towards the target" tie-break (section 8 step 4) applies only when the preferred order still fits the budget.
- The truncation cut snaps to a junction only within 0.5% of the target distance; otherwise the route ends mid-road at the exact distance. End labels come from street names and the nearest OSM place, without a running geocoder.
- Every truncated candidate is re-routed as one engine request (start, stops, cut point) and the re-routed geometry is what is returned and measured.
- Section 8 step 10 (lengthening with a via-point, needed for "add a detour" in Case B and for pinned endpoints) is built after the point-to-point KPIs hold, before loops. Built in Phase 3c: fixed ends, and Case B's "detour on an earlier leg" (offered only when the via adds no spur).

**Measured facts the algorithm must respect**

- Start → Kadalundi → Chaliyam → Beypore needs 19.60 km on foot with the ferry and 25.89 km without it, so "25 km via those three stops" is infeasible with ferries excluded.
- Chaliyam and Beypore stay connected by road with ferries excluded: the "no walking route" message in section 13 is wrong for that pair.
- Pedestrian costing has no option that penalises trunk or primary roads, and sidewalk, surface and lit tags cover 3.5%, 12.2% and 0.1% of walkable km in Kozhikode district.
- The pinned OSM extract (Kerala, 2026-11-15) is recorded in `engine/osm_pin.json`; the upstream file is overwritten daily, so expected values in fixtures are tied to that pin.

## 1. Executive summary

The product is buildable by one developer in roughly 5 to 6 months full-time, and the hard part is a constraint solver wrapped around an open-source routing engine, not the AI.

- **Verdict.** Feasible. No routing engine offers "25 km towards Calicut via three stops" out of the box, so the core IP is an orchestration layer that calls a real engine many times and never computes road distances itself.
- **Real gap.** Distance-budgeted, point-to-point, direction-aware routes with mandatory checkpoints and an honest infeasibility explanation were not found in any competitor checked. Plain "give me a 10 km loop" is already commoditised (Strava, Komoot, Garmin, Runplanner and several new apps do it).
- **Engine.** Self-hosted Valhalla on an OpenStreetMap extract. It gives request-time pedestrian costing, many-to-many matrices, isodistance contours and elevation in one MIT-licensed service. GraphHopper is the fallback if rule-level custom weighting becomes necessary.
- **Algorithm.** Order checkpoints on a network-distance matrix, compute the minimum feasible length, then spend the remaining budget by truncating the path towards the target place at the exact distance. Loops use iterative via-point scaling. Every result is re-measured from its geometry.
- **AI role.** The LLM converts text into a JSON patch on a constraint object and phrases explanations from computed numbers. It never supplies coordinates, distances or durations.
- **Stack.** Your preferred FastAPI + PostgreSQL/PostGIS + Redis stack fits. Front end: Next.js with MapLibre GL JS, shipped as a responsive web app and PWA. Native mobile waits for product-market fit.
- **Cost.** About 40 to 100 USD per month for the MVP when self-hosted (estimate). Hosted routing APIs become expensive quickly because one generated route costs 5 to 30 engine calls.
- **Biggest risks.** (1) OSM in Kerala has sparse sidewalk, surface and lighting tags, so "safer" and "quieter" are road-class proxies, not facts. (2) Loop quality is subjective and Strava's heatmap data cannot be matched. (3) The headline feature serves a narrower audience than loops, so demand must be validated early.

## 2. Problem statement and product opportunity

Route planners treat distance as an output of choosing a destination, while endurance athletes treat distance as the input and the destination as negotiable.

A marathon trainee with a 25 km long run on the plan does not care where the run ends. They care that it is 25 km, heads somewhere pleasant, passes the water stop they know, and does not put them on a highway shoulder. Today they get there by dragging waypoints until the number matches.

Three specific failures are worth solving:

1. **Destination beats distance.** A to B routing returns whatever length the shortest path has. Asking for 25 km towards a city 31 km away has no direct expression.
2. **Checkpoints distort silently.** Adding stops changes the length, and tools do not say when the stops alone already exceed the target.
3. **Edits lose context.** Changing one constraint usually means rebuilding the route by hand.

The opportunity is a planner where the constraint set is the product: start, budget, direction, mandatory stops and preferences are held as state, every edit re-solves against all of them, and conflicts are explained with numbers.

An honest caveat: point-to-point long runs need a way home, so the core audience is long-run marathoners, run clubs with a pickup plan, run commuters and cyclists. That is smaller than the casual-loop market. The MVP must therefore also produce acceptable loops, even though loops are not the differentiator.

## 3. Competitor analysis

Loop generation by distance is widely available; no checked competitor offers a distance-budgeted point-to-point route in a named direction with mandatory stops and a feasibility check.

| Product | Auto-generation | Direction control | Waypoints | AI / natural language | Price | Weakness for our use case |
| --- | --- | --- | --- | --- | --- | --- |
| [Strava](https://www.endurancesportswire.com/strava-unveils-suite-of-new-subscriber-features/) | Heatmap-driven suggested routes and point-to-point routing, subscribers only | Not found | Manual route builder with waypoints | [Plain-language route and POI search](https://www.wareable.com/sport/strava-update-route-discovery-mapping-tools-offline-route-navigation-subscribers) (Oct 2026): search, not constraint solving | From [11.99 USD/month](https://pipedot.org/6XED9) | Suggestions depend on local activity density; [reviewers found routes solid mainly in well-travelled areas](https://pipedot.org/730HG) |
| [Komoot](https://www.komoot.com/running-app/create-running-routes) | Sport-specific planner, round trips | Not verified | Yes | [ChatGPT integration suggests tours from its route database](https://www.bike-magazin.de/en/tours/tour-tips/komoot-with-ai-route-planning-with-chatgpt-how-it-works/) | Premium [4.99 USD/month or 59 USD/year](https://dcrainmaker.com/2025/03/komoots-expanded-paywalls-trying-to-make-sense-of-it.html) | AI surfaces existing tours; hiking and cycling focus |
| [Garmin Connect / devices](https://www8.garmin.com/manuals/webhelp/GUID-3B607AEB-9EB5-4BF3-A38D-1F9926BB9F65/EN-US/GUID-D39D8539-1FE6-492E-B9F2-7B71DA432E8E.html) | Round-trip course from distance, up to three options | Yes: a compass heading for the loop | Course creator with points | None found | Free with device | Direction applies to loops only; no "towards a place for N km" |
| [Footpath](https://footpathapp.com/support/faq/) | None found; trace with a finger and it snaps to roads | Manual | Yes | None found | Elite [3.99 USD/month, 23.49 USD/year](https://apps.apple.com/lk/app/id634845718?l=en-gb) | Fully manual: the user does the distance matching |
| [Plotaroute](https://www.plotaroute.com/subscribe) | Auto-plot between clicked points | Manual | Yes, with reshape tools | None found | Premium 20 GBP / 27 USD per year | Avoid-highway and off-road options are premium; web-first |
| [Runplanner](https://runplannerapp.pages.dev/blog/welcome-to-runplanner.html) | Round-trip generator from a target distance | Not found | Tap waypoints | None found | Free, Android | Loops only; no stops plus budget logic |
| Google Maps | None: A to B with stops | Destination only | Yes | Assistant features, no distance target | Free | No distance target, no GPX export (general knowledge, not re-verified) |
| RouteSpinner | Loop generator by distance (not verified in this pass) | Not verified | Not verified | Not verified | Not verified | Re-check in Phase 1 |

**What the evidence supports**

- Direction-aware *loops* already exist. Garmin asks for a distance and a heading, and [Bikemap's loop planner lets premium users set direction](https://help.bikemap.net/hc/en-us/articles/14336111632796). Do not market "direction-aware" alone as new.
- "AI" in Strava and Komoot means recommendation and search over existing routes. Neither was found to parse constraints such as "5 km longer, keep the start, avoid highways" into a re-solve.
- New loop-first apps keep appearing ([RouteFast](https://www.producthunt.com/products/routefast), [Routerunner](https://routerunnerr.pages.dev/)). Competing on "loop from here" is a race to free.

**Genuine gaps**

1. Point-to-point routes with a distance budget and a direction, where the endpoint is computed.
2. Mandatory checkpoints checked against the budget, with a numeric explanation when they do not fit.
3. Conversational edits that preserve all other constraints and report the change in distance and time.
4. Regions with thin activity data, such as most of Kerala, where heatmap-driven suggestions are weakest.

"Not found" means no evidence in vendor pages and recent coverage, not proof of absence. Hands-on trials of each app in Calicut belong in Phase 1.

## 4. Feature and functional requirements

Every feature reduces to one object, the route request, which the form, the map and the chat all edit.

```json
{
  "activity": "run",
  "route_type": "point_to_point",
  "start": {"lat": 11.05, "lon": 75.86, "label": "Current location"},
  "target_distance_m": 25000,
  "tolerance_pct": 2,
  "direction": {"kind": "towards_place", "place_id": "osm:R:...", "label": "Kozhikode"},
  "end": {"kind": "auto"},
  "checkpoints": [
    {"place_id": "...", "label": "Kadalundi", "mandatory": true},
    {"place_id": "...", "label": "Chaliyam", "mandatory": true},
    {"place_id": "...", "label": "Beypore", "mandatory": true}
  ],
  "checkpoint_order": "auto",
  "preferences": {"avoid": ["highways", "ferries"], "hills": "minimise", "quiet_roads": 0.8, "surface": "paved"},
  "alternatives": 3
}
```

| Area | Requirement | Acceptance rule |
| --- | --- | --- |
| Distance | Length measured on network geometry | Point-to-point within 1% of target; loops within 3% (p90) |
| Route types | Loop, point-to-point, out-and-back, custom | Type is explicit; never silently changed |
| Direction | Compass bearing or a named place; the place need not be reached | Endpoint is computed; the route never ends at the place merely because it was named |
| Checkpoints | Up to 8 mandatory stops, auto or manual order | Route passes within 50 m of each; infeasible sets return an explanation, not a route |
| Editing | Add, remove, reorder stops; change distance, end, preferences | Every edit re-solves with all other constraints kept and returns a before/after diff |
| Alternatives | Up to 4 labelled options: direct, scenic, flatter, quieter | Options share under 60% of their edges; a label is shown only when its data exists |
| Route card | Distance, deviation from target, duration, gain/loss, start, end, stops, surface mix | All numbers computed from the stored geometry |
| Persistence | Save, share link, GPX export | GPX opens in Garmin Connect and Strava |
| Natural language | Text creates or patches the request | No number in the reply originates from the LLM |

## 5. Mapping and routing technology comparison

OpenStreetMap data with a self-hosted Valhalla engine is the best fit; hosted commercial APIs fail on cost per generated route, on request-time control, or on licence terms.

Cells with a link were checked against the linked page in November 2026. Cells without a link come from prior knowledge of the vendor docs and must be re-checked in Phase 1.

### Data and platform providers

| Provider | Pedestrian, cycling, trails | Self-host | Licence | Free tier and price | Live traffic | Elevation |
| --- | --- | --- | --- | --- | --- | --- |
| OpenStreetMap | Footways, paths, tracks, cycleways where mapped; quality varies by area | Yes | [ODbL: any use including commercial, attribution required](https://osmfoundation.org/wiki/Licence_and_Legal_FAQ) | Free | No | No; pair with a DEM |
| Google Maps Platform | Walking and cycling modes; no trail profiles | No | Proprietary terms; storing results and showing them on non-Google maps is restricted | India billing: [70,000 free calls per Essentials SKU per month](https://developers.google.com/maps/billing-and-pricing/pricing-categories), then [1.50 USD per 1,000 Compute Routes](https://developers.google.com/maps/billing-and-pricing/pricing-india). Global: 10,000 free, then [5 USD per 1,000](https://developers.google.cn/maps/billing-and-pricing/pricing) | Yes, for driving | Separate API |
| Mapbox | Walking and cycling profiles | No | Proprietary terms | [100,000 Directions requests free per month, then 2 USD per 1,000; 50,000 web map loads free](https://superdupr.com/blog/mapbox-pricing) | Yes, for driving | Terrain tiles |
| HERE | Pedestrian and bicycle routing | No | Proprietary | Not verified in this pass | Yes | Yes |
| TomTom | Pedestrian and bicycle routing | No | Proprietary | Not verified in this pass | Yes | Limited |
| GraphHopper Directions API | Foot, hike and bike profiles on OSM | Engine is open source | Engine Apache-2.0; hosted terms apply | [Free plan: 500 credits/day, non-commercial, no flexible mode. Basic 69 EUR/month for 5,000 credits/day](https://www.graphhopper.com/pricing/) | No | Yes |
| openrouteservice (HeiGIT) | Foot-walking, foot-hiking, several cycling profiles on OSM | Yes | Engine GPL-3.0 | [Free: 2,000 directions, 500 matrix and 500 isochrone requests per day](https://openrouteservice.org/plans/) | No | Yes |

Live traffic matters little for runners. No provider offers pedestrian-relevant traffic volumes, so "less traffic" must be approximated from road class in every option.

### Routing engines

| Engine | Waypoints | Request-time preferences | Round trip built in | Matrix and isodistance | Elevation | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| **Valhalla** (MIT) | Yes; [break, through and via types plus a start heading with tolerance](https://valhalla.github.io/valhalla/api/route/api-reference/) | Yes: costing options per request such as `use_hills`, `use_ferry`, `use_living_streets`, `use_tracks`, `walking_speed`, `exclude_polygons` | No | Both, in the open-source build | Yes, from DEM tiles | **Recommended core** |
| **GraphHopper** (Apache-2.0) | Yes | Yes: [`custom_model` speed and priority rules, in flexible mode](https://docs.graphhopper.com/openapi/routing/postroute) | Yes: [`round_trip` with approximate distance and a random seed](https://docs.graphhopper.com/openapi/routing/postroute) | Isochrone open source; matrix availability in the open-source build to verify | Yes: returns ascend and descend | Strong alternative |
| **openrouteservice** | Yes; [50 on the hosted API](https://openrouteservice.org/restrictions/) | Avoid features and polygons | Yes: round-trip option, [capped at 100 km hosted](https://openrouteservice.org/restrictions/) | Both | Yes | Prototype with the hosted API, then drop |
| **OSRM** (BSD-2) | Yes | No: profiles are fixed when the graph is built | No | Matrix only | Not by default | Fast but too rigid |
| **Google Routes API** | Yes, up to 25 intermediates | Avoid highways, tolls, ferries only | No | Matrix | Not in the route response | Not for the core |
| **Mapbox Directions** | Yes, up to 25 coordinates | Exclusions and a few walking biases | No | Separate Matrix and Isochrone APIs | No | Hosted fallback only |

### Why Valhalla, and where it is weaker

- The algorithm in section 8 needs four primitives: route with vias, many-to-many matrix, isodistance contour, and per-edge attributes. Valhalla ships all four in one binary with no licence fee.
- Costing is resolved per request, so "avoid highways, minimise hills" needs no graph rebuild. OSRM cannot do this at all, and GraphHopper needs its slower flexible mode.
- Its tiled graph keeps memory low; a South India extract should run on a small VPS (to confirm in Phase 2).
- **Weaker:** costing is a fixed set of knobs. A rule such as "penalise primary roads without a sidewalk by 3x" needs C++ changes, where GraphHopper's custom model expresses it in JSON.
- **Weaker:** no round-trip helper. GraphHopper's helper is not a substitute anyway: its docs call it ["meant for fun"](https://docs.graphhopper.com/openapi/routing/postroute) with randomness, its distance is approximate, and [users report the heading being ignored](https://discuss.graphhopper.com/t/rund-trip-idea/9842).

### Why not a hosted API for the core

A generated loop costs about 20 engine calls. At 1,000 generations a day that is 600,000 calls a month: about 1,000 USD on Mapbox (500,000 billable at 2 USD per 1,000) or about 795 USD on Google at India rates (530,000 billable at 1.50 USD per 1,000). The free openrouteservice quota covers roughly 100 generations a day. A self-hosted engine costs the same at any volume the server can carry.

## 6. Recommended technology stack

Your FastAPI, PostgreSQL/PostGIS and Redis preference is sound; the only additions are Valhalla, a self-hosted geocoder and MapLibre.

| Layer | Choice | Why | Alternative considered |
| --- | --- | --- | --- |
| Routing engine | Valhalla, self-hosted in Docker | Section 5 | GraphHopper if custom weighting rules are needed |
| Map data | OSM regional extract, rebuilt weekly | Free, editable, pedestrian detail | None realistic for self-hosting |
| Elevation | DEM tiles loaded into Valhalla; Copernicus GLO-30 for offline analysis | [GLO-30 is free worldwide](https://developers.google.com/earth-engine/datasets/catalog/COPERNICUS_DEM_GLO30_2024_1) and [evaluated as more accurate than SRTM and NASADEM](https://katalog.lib.cas.cz/KNAV/EdsRecord/8gh,181153872) | SRTM |
| Geocoding | Photon, self-hosted on the same extract | The public Nominatim server [allows 1 request per second and forbids autocomplete](https://moltchat-agent-commons.onrender.com/wiki/Nominatim_geocoding_usage_policy_and_rate_limits) | A paid OSM geocoder to skip hosting |
| Backend | Python 3.12, FastAPI, httpx (async), Pydantic | The work is I/O-bound orchestration of engine calls; Python has Shapely, pyproj, OR-Tools | Go or Rust only if you later write your own graph search |
| Database | PostgreSQL + PostGIS | Geometry storage, `ST_Length` on geography for verification, spatial indexes | None needed |
| Cache and state | Redis | Cache matrices and routes by request hash; rate limiting; chat session state | In-process cache for the first weeks |
| Background jobs | arq or Celery | Only for weekly graph rebuilds and bulk test runs; route requests stay synchronous | Cron on the server |
| Web front end | Next.js + React + TypeScript | Fits your existing Next.js and Vercel experience; share pages render server-side | Plain Vite SPA |
| Map rendering | MapLibre GL JS with Protomaps or MapTiler vector tiles | Open source, no per-load fee, smooth vector editing | Mapbox GL JS: polished, but proprietary and billed per map load. Leaflet: simpler, raster-first, weaker for draggable routes |
| Mobile | PWA first; React Native with MapLibre Native later | One codebase now; GPX export covers watches | Flutter is equally viable but shares no code with the web app |
| LLM | A small, fast model with structured output, behind a provider-agnostic interface | Parsing is a simple extraction task | Rule-based parser as offline fallback |

**Web, PWA or native?** Start with a responsive web app installable as a PWA. Planning happens before the run, on a large map, and GPX export hands navigation to Garmin, Coros or Strava. Background GPS in an iOS PWA is unreliable, so live turn-by-turn navigation is deliberately out of the MVP and is the trigger for a native app. (Phase 5d adds a foreground-only Follow mode on the web; background navigation still waits for the native app.)

## 7. Proposed system architecture

A thin client talks to one FastAPI service whose solver module makes all routing decisions by calling a self-hosted Valhalla instance.

&#91;embedded content: system architecture · client, backend modules, five services, data build\]

Read top down: the web app sends a route request or a chat message; the backend parses, solves, scores and stores; the weekly build feeds Valhalla, Photon and the basemap from the same OSM extract.

### Request sequence for "25 km towards Calicut via three stops"

1. The client posts text to `/plans/{id}/messages`.
2. The parser calls the LLM and receives a patch plus place names.
3. Photon resolves the names; ties go back to the client as a picker.
4. The solver calls Valhalla: one matrix, one base route, then one tail route per costing, in parallel.
5. The scorer fetches edge attributes and elevation, re-measures lengths, ranks and filters.
6. The version, routes and diff are written to PostGIS; the request hash is cached in Redis.
7. The client receives routes, the diff and an explanation built from the facts object.

### Deployment

- One Docker Compose stack on a single VPS for the MVP: API, Valhalla, Photon, Redis, PostgreSQL.
- The front end deploys separately to a static or serverless host.
- Valhalla and Photon are stateless readers of prebuilt files, so scaling later means more replicas behind the API.
- The API never exposes Valhalla directly; all engine access goes through the solver so limits and caching apply.

## 8. Detailed route-generation algorithm

The solver treats the routing engine as an oracle: it proposes candidate via-points and endpoints, asks the engine for real network routes, measures them, and iterates until the measured length matches the budget.

### Why a heuristic

Finding a simple path of an exact length in a graph is NP-hard in general, and "maximise niceness within a length budget" is the Arc Orienteering Problem, also NP-hard. Published work on this exact problem, [Efficient Computation of Jogging Routes (Gemsa, Pajor, Wagner, Zündorf, 2013)](https://i11www.iti.kit.edu/extra/publications/gpwz-ecjr-13.pdf), uses heuristics that approximate the length while scoring "niceness". Cycle-trip planning has been modelled as an [arc orienteering problem solved with iterated local search](https://www.econbiz.de/Record/an-extension-of-the-arc-orienteering-problem-and-its-application-to-cycle-trip-planning-verbeeck-cedric/10010404550).

| Technique | Role here |
| --- | --- |
| Dijkstra, A\* | Inside the engine for every route and matrix call. Do not reimplement. |
| TSP (open path, fixed start, free end) | Ordering mandatory checkpoints. Exact dynamic programming up to 10 stops; OR-Tools beyond. |
| Orienteering Problem | Later, for *optional* stops: pick the subset that fits the budget. |
| Constrained shortest path | The framing of the whole problem; solved heuristically by via-point search. |
| Multi-objective optimisation | Different costings produce different candidates; a weighted score ranks them and a diversity filter keeps distinct ones. |
| Genetic algorithms | Not in the MVP. Each fitness evaluation is an engine call, so they are slow, and via-point scaling converges in 3 to 6 steps. Revisit only for loop quality. |

### Step by step: point-to-point towards a place, with checkpoints

Inputs: start S, target distance D, tolerance e, target place T, mandatory checkpoints C1..Ck, preferences P.

1. **Resolve places.** Geocode T and each checkpoint with a location bias around S. If a name has several plausible matches, stop and ask. Snap every point to the pedestrian network; reject points that snap more than about 150 m away.
2. **Build the distance matrix.** One many-to-many pedestrian matrix call over {S, C1..Ck, T} with costing P. All later decisions use these network distances. Haversine is used only to pre-filter candidates.
3. **Check connectivity.** A missing matrix cell means no pedestrian path under P, typically a river with the ferry excluded. Report which pair is disconnected and which preference causes it.
4. **Order the checkpoints.** Solve the open-path TSP from S. Among orders within 2% of the shortest, prefer the one whose stops get monotonically closer to T on the network. If the user fixed the order, skip this step.
5. **Compute the minimum length.** L\_min is the routed length S to C1 to ... to Ck in that order, taken from the actual route, not the matrix sum.
6. **Feasibility gate.** If L\_min exceeds D(1+e), return no route. Return the conflict object from the infeasibility subsection below.
7. **Allocate the remainder.** R = D minus L\_min is the budget after the last checkpoint Ck (or after S when there are none).
8. **Select the endpoint.**
   - *Case A, T is farther than R from Ck:* route Ck to T and cut the geometry at exactly R. Move the cut to the nearest junction or named place within the tolerance so the run ends somewhere real. The route heads to T by construction and its length is exact by construction.
   - *Case B, T is nearer than R:* the user asked for more distance than the direct way provides. Produce labelled options: end at T and report the shortfall; continue past T on the same bearing; or lengthen an earlier leg with a detour (step 10).
   - *Bearing only, no place:* request an isodistance contour at R from Ck, sample its boundary within 45 degrees either side of the bearing, snap the samples, route to each, and keep those within tolerance.
9. **Generate alternatives.** Repeat steps 5 to 8 under different costings (direct, low hills, quiet roads, waterfront bias). Because each costing takes a different path, each alternative gets its own cut point and endpoint.
10. **Lengthen when the endpoint is fixed.** If the user pins the end and the route is short by X, insert one via-point V on the longest leg A to B. Candidates come from a grid inside the ellipse with foci A and B; two matrix calls give d(A,V)+d(V,B) for all candidates; choose the one closest to the required leg length, route it with a `through` via to prevent U-turns, measure, and refine along the same ray until within tolerance.
11. **Verify and score.** Recompute the length from the returned geometry, then score each candidate (subsection below). Discard any that fail a hard rule.
12. **Explain.** Emit facts for the UI: order chosen, L\_min, R, endpoint name, deviation, and the changes against the previous version.

```text
solve(req):
    pts    = snap(geocode(req))
    M      = matrix(pts, costing(req.prefs))            # network metres
    if M has gaps: return Disconnected(pair, blocking_preference)
    order  = open_tsp(M, start=S, toward=T) unless req.order_fixed
    base   = route(S, *order)                           # real geometry
    if base.len > D * (1 + e): return Infeasible(base.len, marginal_costs(M, order))
    R      = D - base.len
    out    = []
    for c in costings(req.prefs):
        tail = route(order[-1] or S, T, c)
        if tail.len >= R: cand = base + cut(tail, R)    # exact by construction
        else:             cand = extend_or_report(base, tail, R)
        cand.len = geodesic_length(cand.geometry)       # independent check
        if passes_hard_rules(cand): out.append(score(cand))
    return diversify(sorted(out))[:req.alternatives]
```

### Worked example (illustrative numbers, to be replaced by measured values in Phase 2)

Request: 25 km towards Calicut from a start south of Kadalundi, via Kadalundi, Chaliyam and Beypore.

Geography matters here. [Chaliyam is bounded by the Chaliyar to the north and the Kadalundi river to the south](https://ipfs.ssi.eecc.de/ipns/en.wikipedia-on-ipfs.org/wiki/Chaliyam), and Beypore lies across the Chaliyar estuary. The crossing is a ferry whose service has been unreliable: [without it the road route is about 8 km via Karuvanthuruthy and Feroke](https://www.onmanorama.com/news/kerala/2025/08/29/kadalundi-jetty-restoration.amp.html), and [a new Ro-Ro service was suspended on its first trip in December 2025](https://www.onmanorama.com/news/kerala/2025/12/28/beypore-ro-ro-service-suspension-jhankar-docking-problems.html). Ferries are therefore excluded by default.

| Leg | Ferry excluded | Ferry allowed |
| --- | --- | --- |
| Start to Kadalundi | 9.0 km | 9.0 km |
| Kadalundi to Chaliyam | 5.0 km | 5.0 km |
| Chaliyam to Beypore | 8.0 km (via Feroke) | 0.5 km |
| L\_min | 22.0 km | 14.5 km |
| Remainder R at 25 km | 3.0 km | 10.5 km |
| Result | Ends 3 km past Beypore on the way to Calicut | Ends 10.5 km past Beypore, close to or in Calicut |

The same request yields endpoints 7.5 km apart depending on one preference. The UI must state this, not hide it.

### Infeasible requests

If the user asks for 15 km with the ferry excluded, L\_min of 22 km exceeds the budget. The solver returns:

- the minimum distance that visits all stops (22.0 km) and the overshoot (7.0 km);
- the saving from dropping each stop, computed from the matrix (for example, dropping Beypore saves 8.0 km and makes the route fit);
- the saving from relaxing each blocking preference (allowing the ferry saves 7.5 km);
- one-tap fixes: raise the distance to 22 km, drop a named stop, make a stop optional, or allow the ferry.

The same gate catches disconnected points, stops that snap too far from any path, and loops whose stops lie farther than D/2 from the start.

### Loops and out-and-back

- **Out-and-back:** build the directional route with budget D/2, then return on the same geometry. Exact, simple, and repeated edges are expected.
- **Loop without checkpoints:** place three via-points on a circle through S whose circumference is D divided by a circuity factor (start at 1.3). Rotate the circle so it leans towards the requested bearing. Route S, V1, V2, V3, S with `through` vias; measure L; scale the radius by D/L; repeat up to 5 times. Run 6 to 8 rotations and shapes in parallel and keep the best scored.
- **Loop with checkpoints:** order the stops as a closed tour, then lengthen the longest leg with step 10 until the budget is met.
- **Coastline and rivers:** candidates that fall in water or snap far away are discarded before routing. If fewer than two rotations survive, fall back to out-and-back and say why.

### Scoring and hard rules

| Criterion | Measure | Use |
| --- | --- | --- |
| Distance error | Absolute difference from D, as a share of D | Hard: reject above tolerance |
| Access | Any edge without pedestrian access, or a ferry not opted into | Hard: reject |
| Checkpoints | Each mandatory stop within 50 m of the geometry | Hard: reject |
| Repeated edges | Share of length on edges used more than once (edge ids from the engine's attribute call) | Hard above 10% unless out-and-back; otherwise penalty |
| Spurs | Dead-end excursions longer than 100 m that return on the same edge | Penalty; hard for loops |
| Direction adherence | Share of length during which network distance to T increases | Penalty; target under 15% |
| Road suitability | Share of length on trunk and primary roads | Penalty weighted by the quiet-roads preference |
| Elevation | Smoothed gain per km | Penalty weighted by the hills preference |
| Turn density | Turns per km | Light penalty: fewer turns are easier to follow |
| Diversity | Jaccard overlap of edge sets between kept alternatives | Keep only below 0.6 |

### Limits to state openly

- Truncated routes can end at an arbitrary roadside. Snapping to a named place trades a little distance accuracy for a sensible finish.
- Loop convergence fails in sparse networks (islands, single coastal roads). The fallback is out-and-back.
- Quality is bounded by the engine's cost model. The solver cannot prefer a pleasant street that OSM tags do not distinguish from an unpleasant one.

## 9. Geospatial data strategy

Use one OSM extract as the single source for routing, geocoding and the basemap, so that what the user sees, searches and runs on always agree.

### Pipeline

1. Download the regional OSM extract weekly (Kerala or the southern India zone to start).
2. Build Valhalla tiles with elevation, a Photon index, and vector basemap tiles from the same file.
3. Run the regression suite from section 16 against the new graph. Promote the build only if KPIs hold.
4. Keep the previous build for instant rollback.

### Licence obligations

- OSM data is under the ODbL: [any use including commercial is allowed, and attribution is required](https://osmfoundation.org/wiki/Licence_and_Legal_FAQ).
- Routes and map images are "produced works". [Applications that incorporate an OSM-based routing engine must credit OpenStreetMap](https://osmfoundation.org/wiki/Attribution).
- Share-alike bites only if you publish a database derived from OSM. Keep user data (saved routes, feedback, ratings) in separate tables so it stays a collective database, not a derivative one. Get legal advice before selling data.

### Where each calculation runs

| Calculation | Runs in | Reason |
| --- | --- | --- |
| Snapping, shortest paths, matrices, isodistance, map matching, elevation sampling | Routing engine | It owns the graph; anything else would duplicate it badly |
| Haversine and bearing | Backend | Candidate pre-filtering and sector tests only; never shown as a route distance |
| Checkpoint ordering, endpoint selection, iteration, scoring, GPX | Backend | Product logic |
| Independent length check, geofences, avoid-areas, "saved routes near me", POI proximity | PostGIS | `ST_Length` on geography, GiST indexes, `ST_DWithin` |
| Drawing, drag handles, live distance hints while dragging | Client | Display only; the server result replaces the hint |

### Concepts and how they are used

- **Coordinates:** WGS84 latitude and longitude everywhere (EPSG:4326). Use the geography type in PostGIS so lengths are in metres on the ellipsoid.
- **Straight line versus network:** haversine is a lower bound on network distance. The ratio (circuity) is roughly 1.2 to 1.5 on ordinary street grids and far higher across rivers. The solver learns a per-area circuity factor from its own results to seed loop sizes.
- **Bearing:** the forward azimuth from S to T sets the direction sector. Adherence is judged on network progress towards T, because a coastal road can head the right way while pointing 60 degrees off the straight line.
- **Spatial indexing:** GiST in PostGIS for saved content; the engine has its own tile index for snapping.
- **Graph representation:** nodes are junctions and edges are way segments with access flags, class, surface and length. You do not hold this graph in the backend during the MVP.
- **Map matching:** needed later for importing GPX files and for dragging a route onto a specific road. Not required to generate routes.
- **Elevation profiles:** sample the DEM along the geometry every 25 to 50 m, smooth, and count gain only above a 2 to 3 m threshold. Raw 30 m DEM sums overstate gain. GLO-30 is a surface model [that includes buildings and vegetation](https://developers.google.cn/earth-engine/datasets/catalog/COPERNICUS_DEM_GLO30?hl=en), so urban profiles are noisy.

### Data quality in the test region

- Expect main roads to be mapped well, and sidewalks, surface, lighting and footpaths to be sparse. Measure tag coverage in Phase 2 before promising any preference.
- "Scenic" can be approximated from proximity to coastline, rivers, beaches and parks, which are mapped reliably.
- Ferries exist in OSM as routable ways regardless of whether the service runs today. Exclude them unless the user opts in.
- Fix errors upstream: edit OSM for the test region as you find problems. It is the cheapest quality lever and benefits the next weekly build.

## 10. AI integration strategy

Use the LLM as a translator between language and the route request object, and nowhere else; ship the structured form first and add chat as a second way to edit the same state.

| Task | Use an LLM? | Design |
| --- | --- | --- |
| Intent detection (new route, modify, explain, compare) | Yes | One structured-output call returns an intent plus a patch |
| Location extraction | Yes, names only | The model returns strings ("Kadalundi"). The geocoder returns coordinates. |
| Constraint extraction | Yes | Maps "quieter roads", "flat", "no highways" to enumerated preference fields |
| Modification commands | Yes | Output is a JSON patch: "5 km longer" becomes `target_distance_m += 5000` applied by code |
| Conversation | Limited | Clarifying questions only when a required slot is missing or a place is ambiguous |
| Explaining routes | Yes, phrasing only | The solver produces a facts object; the model words it; a validator rejects any reply containing a number not in the facts |
| Distances, coordinates, ordering, feasibility | Never | Solver and engine only |

### Flow for one message

1. Send the user text, the current request object and the schema to the model. Ask for `{intent, patch, place_names, clarification}`.
2. Validate the patch with Pydantic. Reject unknown fields and out-of-range values.
3. Geocode new place names near the start. More than one strong match triggers a picker in the UI, not a guess.
4. Apply the patch, run the solver, compute the diff against the previous version.
5. Generate the reply from the facts object, or use a template when the change is simple.

### LLM interface versus structured form

|  | Structured form and map | Natural-language chat |
| --- | --- | --- |
| Precision | Exact; no misreading | Parse errors possible; needs confirmation chips |
| Speed for simple requests | Three taps | One sentence; faster when several constraints change at once |
| Discoverability | Shows every option | Hides what is possible unless prompted |
| Compound edits | Many controls | Strong: "make it 5 km longer, drop Beypore, flatter" |
| Cost and latency | None | One model call per message, roughly 1 s, small per-message cost |
| Failure mode | None | Must degrade to the form when the model is down |

Conclusion: chat is a convenience layer, valuable for compound edits and for the "towards X via Y" phrasing that is awkward in a form. It is not the foundation. After each message, show the parsed constraints as editable chips so a misparse is visible and fixable in one tap.

### Guardrails and evaluation

- A rule-based parser handles trivial patterns ("25 km loop") without a model call.
- Aliases matter locally: Calicut and Kozhikode, transliteration variants, and Malayalam script. Normalise through the geocoder, not the model.
- Build a golden set of at least 150 utterances with expected patches, including ambiguous and adversarial ones. Target 95% slot accuracy before launch and rerun it on every prompt or model change.
- Keep the provider behind an interface so the model can be swapped; log parse failures for the golden set.

## 11. Database schema

Rewritten for Phase 4 (Phase 4 amendments 4, 14, 15 and 18). Requests are stored as versioned JSON, so every edit can be replayed and every route traced to the request, engine builds and solver code that produced it. Lengths are the solver's measurements, stored as `double precision` so they come back exactly as the solver gave them. The migrations in `api/` (Alembic) are the authority; this is their shape.

```sql
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE clients (                       -- anonymous identity until Phase 8 (amendment 7)
  id           uuid PRIMARY KEY,
  token_hash   bytea UNIQUE NOT NULL,        -- sha256 of the token; the token itself is never stored
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz
);

CREATE TABLE plans (                         -- one planning session
  id         uuid PRIMARY KEY,
  client_id  uuid NOT NULL REFERENCES clients(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE plan_versions (                 -- one row per solve: create, each patch, each undo
  id                uuid PRIMARY KEY,
  plan_id           uuid NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  version_no        int  NOT NULL,
  request           jsonb NOT NULL,          -- the full RouteRequest, defaults filled in
  source            text NOT NULL CHECK (source IN ('form', 'chat', 'drag')),
  user_text         text,                    -- chat only (Phase 6)
  outcome           text NOT NULL CHECK (outcome IN ('ok', 'over_budget', 'infeasible', 'disconnected', 'unsupported')),
  conflict          jsonb,                   -- SolveResult.conflict
  facts             jsonb NOT NULL,          -- SolveResult.facts, unchanged
  flags             jsonb NOT NULL,          -- SolveResult.flags (result level)
  explanation       text NOT NULL,           -- template-built (amendment 10)
  diff              jsonb,                   -- against version_no - 1; null for version 1
  graph_build       text NOT NULL,           -- the OSM pin timestamp, as the solver reports it
  valhalla_build    text NOT NULL,
  graphhopper_build text,                    -- null when GraphHopper was down
  solver_hash       text NOT NULL,
  cache_key         text NOT NULL,
  from_cache        boolean NOT NULL,
  elapsed_ms        double precision,        -- the solver's own time (of the original solve, on a hit)
  engine_calls      int,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_id, version_no)
);

CREATE TABLE routes (                        -- one row per Candidate of a version
  id               uuid PRIMARY KEY,
  plan_version_id  uuid NOT NULL REFERENCES plan_versions(id) ON DELETE CASCADE,
  seq              int  NOT NULL,            -- position in SolveResult.candidates
  label            text NOT NULL,            -- recommended | shortest | loop_1 .. loop_4
  option           text NOT NULL,            -- main | end_at_target | continue_past_target | detour_to_target
                                             -- | full_route | cut_at_target | out_and_back | short_loop
  engine           text NOT NULL,            -- valhalla | graphhopper
  geom             geography(LineStringZ, 4326) NOT NULL,  -- solver geometry; Z = DEM height (amendment 15)
  length_m         double precision NOT NULL,  -- ellipsoid geometry length, foot + ferry
  foot_m           double precision NOT NULL,  -- what the budget counts
  ferry_m          double precision NOT NULL,
  engine_length_m  double precision NOT NULL,
  sphere_length_m  double precision NOT NULL,
  edge_count       int NOT NULL,
  deviation_m      double precision NOT NULL,
  duration_s       double precision,         -- engine walking time (amendment 11)
  gain_m           double precision,         -- the solver's smoothed values
  loss_m           double precision,
  repeat_share     double precision,
  backtrack_share  double precision,
  score            double precision,
  end_label        text,
  end_point        jsonb NOT NULL,           -- Candidate.end
  stops            jsonb NOT NULL,           -- Candidate.stops (StopOnRoute list)
  road_class_m     jsonb NOT NULL,
  flags            jsonb NOT NULL,           -- Candidate.flags
  elevation        jsonb,                    -- [[distance_m, height_m], ...] every 30 m; null if heights failed
  UNIQUE (plan_version_id, seq)
);
CREATE INDEX routes_geom_gix ON routes USING gist (geom);

CREATE TABLE saved_routes (
  id          uuid PRIMARY KEY,
  client_id   uuid NOT NULL REFERENCES clients(id),
  route_id    uuid NOT NULL REFERENCES routes(id),
  name        text,
  share_slug  text UNIQUE NOT NULL,          -- random, URL-safe
  rating      int CHECK (rating BETWEEN 1 AND 5),   -- post-run feedback (later phases)
  feedback    text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),   -- Phase 5c: last rename or update
  deleted_at  timestamptz                    -- Phase 5c: soft delete; null while live
);
CREATE INDEX ix_saved_routes_client_id_deleted_at ON saved_routes (client_id, deleted_at);
```

Notes:

- `length_m`, `engine_length_m` and `sphere_length_m` together keep the distance-accuracy and consistency KPIs answerable from the database.
- `ST_Length` is only a cross-check in tests. Displayed lengths are always the stored solver values (amendment 4).
- **Drop Z before measuring:** use `ST_Length(ST_Force2D(geom::geometry)::geography)`.
  - On a geography `LINESTRING Z`, PostGIS 3.4's `ST_Length` includes the height changes: 109.29 m flat measured 148.13 m with a 100 m rise.
  - With Z dropped, A01's three candidates agree with the solver to about 10⁻⁸ m (measured 2026-11-18).
- `graph_build`, the two engine builds and `solver_hash` let any route be reproduced after the data or the code changes.
- The Candidate's `edge_ids` are internal to the solver and are not stored.
- The draft's `users`, `places` and `route_stops` tables are gone:
  - `users` becomes `clients` until Phase 8;
  - `places` would be a geocoder fallback (amendment 17);
  - stops are the Candidate's own list, kept as jsonb.

## 12. API

Rewritten for Phase 4. Every path is under `/v1`. Requests and responses use the solver's own models (amendment 1). FastAPI's OpenAPI page shows them, with examples taken from real solver output.

| Method and path | Purpose | Notes |
| --- | --- | --- |
| `POST /v1/session` | Issue an anonymous client token | Returns `{client_id, token}`. The token goes in `X-Client-Token` on every other call except share and health |
| `GET /v1/places/search?q=&lat=&lon=&limit=` | Geocoding through Photon, biased to (lat, lon), English names, Kerala only (the pinned extract's bounding box as a pre-filter, then `state` = Kerala) | Every Kerala result in Photon's order with `place_id` (`osm:node/…`), label, kind, `county` (Photon's: a district or a taluk), lon, lat; `ambiguous` with reasons (`same_name`, `same_name_different_areas`, `no_exact_match`). Never picks. 503 if Photon is down |
| `GET /v1/places/reverse?lat=&lon=` | Name for a point | 503 if Photon is down |
| `POST /v1/plans` | Create a plan: body `{request: RouteRequest, source}` | Solves; returns version 1 |
| `PATCH /v1/plans/{id}?source=form` | Body: RFC 6902 patch on the latest stored request, defaults filled in (`application/json-patch+json`; plain JSON is accepted too) | Re-solves; returns the new version with its diff. Optional `If-Match: "v<n>"`. Undo: `replace` at path `""` with an earlier request |
| `GET /v1/plans/{id}` | Latest version, list of version numbers, and `status` (`ready` or `solving`) | |
| `GET /v1/plans/{id}/versions/{n}` | Any earlier version, in full | |
| `GET /v1/routes/{id}` | One route as a GeoJSON Feature | LineString with Z; properties are the Candidate's stats, stops and flags |
| `GET /v1/routes/{id}/elevation` | Profile `[[distance_m, height_m], …]` every 30 m, plus the solver's gain and loss | |
| `GET /v1/routes/{id}/gpx` | GPX 1.1 course | Track with `ele`; waypoints for start, checkpoints, end |
| `POST /v1/routes/{id}/save` | Save under a name | Returns `{saved_id, share_slug, share_url}`; saving again renames the most recently updated live save and keeps its slug; `as_new` always makes another (Phase 5c A12) |
| `GET /v1/me/routes` | This client's saved routes | Without deleted ones, newest `updated_at` first; carries `plan_id` and `plan_version` to edit from |
| `PATCH /v1/me/routes/{saved_id}` | Rename, or update to another route | `{name?, route_id?}`; keeps the slug and created_at (Phase 5c A10) |
| `DELETE /v1/me/routes/{saved_id}` | Soft delete | 204, again 204; another client's is 404 |
| `POST /v1/me/routes/{saved_id}/restore` | Undo a delete | 404 once purged (`python -m athlete_api.purge_deleted --days 30`) |
| `GET /v1/share/{slug}` | Public read-only route | No token needed; with one, `is_owner`; a deleted slug is 404, as an unknown one |
| `GET /v1/share/{slug}/gpx` | The shared route as GPX | No token needed. Added in Phase 4 so a share page can offer the download |
| `GET /v1/routes/{id}/overview-points?max=N` | Waypoints (N from 1 to 9) for a Google Maps overview link (Phase 5d A14) | `points`, `max_deviation_m`, `overlap_pct` (leg by leg, Valhalla standing in for Google); cached by route, N and Valhalla build |
| `GET /v1/share/{slug}/overview-points?max=N` | The same for a shared route | No token needed; counts against the share link's per-IP read limit; `no-store` |
| `GET /v1/routes/{id}/follow` | Follow data, fetched once before a run (Phase 5d A15) | `points`, `along_m` at each, `cues` (`at_m`, `turn`, `road`, `then`), `cue_source`; still 200 without Valhalla |
| `GET /v1/share/{slug}/follow` | The same for a shared route | No token needed; counts against the share link's per-IP read limit; `no-store` |
| `GET /v1/health` | Valhalla, GraphHopper, Photon, Postgres, Redis; both build ids; OSM pin; solver hash | 200 when the solve path (Valhalla, Postgres, Redis) is up, else 503 |

### Response for create, patch and version reads

```json
{
  "plan_id": "…", "version": 2, "source": "form", "created_at": "…",
  "outcome": "over_budget",
  "request": { "…": "the RouteRequest as solved" },
  "candidates": [
    { "route_id": "…", "label": "recommended", "option": "full_route", "length_m": 22258.03, "foot_m": 22258.03,
      "deviation_m": 2258.03, "duration_s": 16067.6, "gain_m": 113.5, "stops": [], "end": {}, "flags": [],
      "geometry": [[75.846, 11.121], "…"], "…": "every other Candidate field except edge_ids" }
  ],
  "conflict": { "kind": "checkpoints_exceed_distance", "minimum_m": 21738.6, "overshoot_m": 1738.6,
                "savings": [{"action": "drop_checkpoint", "label": "Kallai", "saves_m": 6600.0, "fits": true}],
                "fixes": [] },
  "facts": { "…": "SolveResult.facts, unchanged" },
  "flags": [],
  "explanation": "…",
  "diff": {
    "from_version": 1,
    "changed": ["/target_distance_m"],
    "outcome": {"from": "ok", "to": "over_budget"},
    "length_delta_m": -2742.0, "duration_delta_s": -1979.1, "end_changed": true,
    "candidates": [
      {"label": "recommended", "from_option": "main", "to_option": "full_route",
       "from_length_m": 25000.0, "to_length_m": 22258.0,
       "length_delta_m": -2742.0, "duration_delta_s": -1979.1, "end_changed": true}
    ],
    "candidates_added": [], "candidates_removed": [],
    "stops_added": [], "stops_removed": []
  },
  "builds": {"osm": "2026-11-15T00:15:25Z", "valhalla": "…", "graphhopper": "…", "solver": "…"},
  "cached": false, "elapsed_ms": "…", "engine_calls": "…"
}
```

The numbers above are from a live patch of A01 from 25 km to 20 km (2026-11-18, this laptop); lengths rounded here to 0.1 m; the OpenAPI examples are generated from live solver output.

Diff rules:
- `changed` lists the JSON pointers that differ between the two requests, whatever patch produced them.
- Candidates are paired by `label`, with `main`, `full_route` and `continue_past_target` treated as each alternative's primary option. Unpaired candidates are listed as added or removed.
- Deltas are differences of the solver's stored values. The top-level `length_delta_m`, `duration_delta_s` and `end_changed` repeat the first paired alternative. `duration_delta_s` is a walking-time delta (amendment 11).
- An end has changed when its coordinates, kind or label differ.
- Stops are compared by `place_id`, or by label when there is none, across checkpoints, `via` and `must_use`.

### Errors

Every error has the body `{"error": code, "message": text, "detail": …}`.

| Status | Code | When |
| --- | --- | --- |
| 401 | `client_required` | Missing or unknown `X-Client-Token` |
| 404 | `not_found` | Unknown id, or it belongs to another client |
| 409 | `patch_test_failed` | A `test` operation in the patch failed |
| 409 | `plan_solving` | PATCH while a solve for the plan is still running, or before it has any version |
| 412 | `version_mismatch` | `If-Match` names an older version |
| 422 | `invalid_patch` | The patch is malformed or its path does not exist |
| 422 | `invalid_request` | The request, or the patched request, fails RouteRequest validation (Pydantic's errors in `detail`) |
| 429 | `rate_limited` | Per-client or per-IP limit; `Retry-After` |
| 429 | `solver_busy` | No solve slot within 10 s; `Retry-After` |
| 503 | `engine_unavailable` / `geocoder_unavailable` | Valhalla or Photon down. A GraphHopper outage is not an error: the solver returns "shortest" with the flag `alternative_unavailable` |
| 503 | `overview_unavailable` / `overview_timeout` | Overview points only: no walking path between some of the points, or over 10 s (the work carries on and is cached) |
| 504 | `solve_timeout` | Over the 15 s budget. `detail` has `plan_id`, `status: "solving"`, `elapsed_ms` and the URL to poll |

### Operational rules

- Solves run in a worker thread, with at most 2 at once; extra requests wait up to 10 s for a slot, and each solve has a 15 s budget (amendments 3, 12, 13).
- Results are cached by the canonical request, both engine build ids and the solver hash for 24 h (amendments 5 and 14). Identical requests already in flight share one solve.
- Rate limits are per client and per IP (amendment 22).

## 13. UI/UX architecture

Updated 2026-11-18 by the Phase 5 amendments, which win over this section:
- the alternatives are "recommended" and "shortest" plus any Case B options (cut at target, full route, continue past target, out-and-back fallback), not three labelled cards;
- the chat input waits for Phase 6 and drag editing for Phase 7;
- time is the measured foot length at the user's own pace, labelled "at your pace";
- every number shown comes from the API response; the UI computes no distance and no position along a route;
- the place picker shows the district (Photon's county) and a mini-map, not a distance from the start;
- the saved routes list has no delete, and the share page has no "Remix" (amendment 11).

One screen does most of the work: a full map with a bottom sheet (side panel on desktop) that always shows the current constraints as chips and the candidate routes as cards.

### User journey

1. **Open.** The map centres on the current location. The sheet shows Start, Distance, Type, and "Towards (optional)".
2. **Ask.** The user fills the form or types "25 km run towards Calicut". Chips appear: `Run`, `25 km`, `Point-to-point`, `Towards Kozhikode`.
3. **Compare.** Three route cards appear, each a different colour on the map. Tapping a card highlights it and shows its elevation profile.
4. **Add stops.** "Add Kadalundi, Chaliyam and Beypore as mandatory stops." Stops appear as numbered pins and list rows. A banner reports: "Stops need at least 22.0 km. 3.0 km remains after Beypore. New end: ...".
5. **Refine.** "Prefer quieter roads and minimum elevation gain." Cards re-rank; each shows what changed ("+0.4 km on residential roads, 18 m less climbing").
6. **Resize.** "Increase to 28 km." Start, stops, direction and preferences stay. The endpoint moves and the card shows "+3.0 km, about +18 min, new end: ...".
7. **Keep.** Save, share a link, export GPX.

### Main screens

| Screen | Contents |
| --- | --- |
| Planner | Map; start pin; constraint chips; distance stepper (plus and minus 1 km and free entry); type selector; chat input; route cards |
| Stops panel | Ordered list with drag handles; a lock toggle between "auto order" and "my order"; mandatory or optional switch per stop; running distance at each stop |
| Route detail | Elevation chart linked to the map cursor; surface and road-class bars; stops with distance marks; deviation from target; ferry or data warnings |
| Compare | Up to four cards side by side on desktop, swipeable on mobile |
| Place picker | Shown when a name is ambiguous: candidates with district and distance from start, plus a mini-map |
| Saved routes | List and map of saved routes; rename, delete, export |
| Share page | Read-only map, stats, GPX download, "Remix this route" |

### Wireframe description: Planner on mobile

- Top: search field for the start, with a locate button.
- Middle: map filling the screen. The selected route is drawn 6 px wide in colour; alternatives are 3 px and muted. Distance markers appear every 5 km. Checkpoints are numbered; the computed end is a flag labelled "End (auto)".
- Bottom sheet, collapsed: a chip row and a one-line summary of the selected route.
- Bottom sheet, expanded: route cards, then the stops list, then the chat input.

### Route comparison card

| Field | Example |
| --- | --- |
| Label and colour | Quieter |
| Distance and deviation | 25.1 km (+0.1) |
| Time at the user's pace | 2 h 31 min |
| Climb and descent | +64 m / -60 m |
| End | Auto: named junction or place |
| Road mix | A bar: residential, tertiary, primary, path |
| Trade-off line | "1.2 km on a primary road; flattest option" |

### Drag editing

Dragging a point on the line inserts a `through` via and re-solves. Because the distance budget is still enforced, the endpoint moves to compensate, and the card says so. A "free edit" toggle turns the budget off for users who want manual control.

### Error and infeasibility messages

| Situation | Message |
| --- | --- |
| Stops exceed the distance | "These three stops need at least 22.0 km, which is 7.0 km over your 15 km. Fix: raise to 22 km, drop Beypore (saves 8.0 km), or allow the ferry (saves 7.5 km)." |
| Disconnected | "There is no walking route between Chaliyam and Beypore with ferries off. Allow ferries, or route via Feroke (+7.5 km)." |
| Target place nearer than the budget | "Kozhikode is 21.3 km away by this route. End there, continue 3.7 km beyond, or add a detour?" |
| Ambiguous place | "Which Beypore? Pick one." |
| Loop cannot converge | "Few roads here allow a loop of 10 km. Showing an out-and-back." |
| Preference unmet | "1.4 km of primary road could not be avoided at the Feroke bridge." |
| Data caveat | "Lighting and sidewalk data are incomplete here. 'Quieter' is based on road type." |

Every message names the numbers, the cause and at least one one-tap fix. The app never returns a route that silently violates a constraint.

## 14. MVP scope

The MVP is running only, one region, web only, and proves a single claim: constraint-true routes with honest explanations.

| Priority | Feature |
| --- | --- |
| **Must have** | Start selection by search, tap or current location |
|  | Target distance with tolerance |
|  | Point-to-point towards a place or bearing, with computed endpoint |
|  | Out-and-back |
|  | Up to 5 mandatory checkpoints with auto-ordering and the feasibility gate |
|  | Pedestrian routing with highways and ferries excluded by default |
|  | Three alternatives: direct, flatter, quieter |
|  | Re-solve on any edit, with a before/after diff |
|  | Interactive map, route cards, elevation profile |
|  | Save, share link, GPX export |
|  | Independent length verification on every route |
| **Should have** | Loops by distance with a direction lean |
|  | Natural-language input for create and edit |
|  | Manual checkpoint reordering and optional stops |
|  | Place disambiguation picker |
|  | Scenic variant based on waterfront and park proximity |
| **Could have** | Drag-to-edit with budget enforcement |
|  | Surface mix display |
|  | User accounts beyond a magic link |
|  | Post-run rating of a route |
| **Future** | Cycling, trail running and hiking profiles |
|  | Native app with background live navigation and offline maps (foreground Follow on the web: Phase 5d) |
|  | Direct sync to Garmin, Coros and Strava |
|  | Popularity signal from user feedback and imported GPX |
|  | Training-plan integration and club features |

Two deliberate departures from your list: loops move to "should" because they are not the differentiator but users will expect them soon after launch, and the chat interface is "should" because the solver must be proven through the form first. Cut "safer route" as a labelled option until data supports it.

## 15. Development roadmap

Eight phases total 19 to 26 weeks of full-time solo work; roughly double that alongside a part-time job. Phase 3 carries the most risk and should not be compressed.

| Phase | Objective | Solo estimate | Depends on |
| --- | --- | --- | --- |
| 1. Research and validation | Confirm the gap and the demand | 1 to 2 weeks | None |
| 2. Data and engine experiments | Prove the four engine primitives on Kerala data | 2 weeks | 1 |
| 3. Core algorithm | Solver library that meets the KPIs offline | 4 to 6 weeks | 2 |
| 4. Backend API | Plans, versions, routes, GPX | 2 to 3 weeks | 3 |
| 5. Front end and map | Planner screen end to end | 3 to 4 weeks | 4 |
| 6. Natural-language interface | Text to patch, with evaluation | 2 weeks | 4, 5 |
| 7. Customisation and optimisation | Loops, drag editing, scenic, performance | 3 to 4 weeks | 3 to 6 |
| 8. Testing, deployment, production readiness | Launchable beta | 2 to 3 weeks | All |

### Phase 1: Product research and technical validation

- **Tasks:** try every competitor in section 3 in Calicut on the ten test scenarios and record results. Interview 10 to 15 runners from local clubs about how they plan long runs. Re-check the unverified cells in section 5.
- **Technologies:** none beyond a spreadsheet.
- **Deliverables:** competitor results table, interview notes, go or no-go decision.
- **Challenges:** confirmation bias; people say they want features they will not use.
- **Acceptance:** at least 5 of the interviewees describe the distance-first, point-to-point or checkpoint problem unprompted. If not, reposition around loops plus explanations before building.

### Phase 2: Geospatial data and routing engine experiments

- **Tasks:** run Valhalla in Docker on a Kerala extract with elevation. Script route, matrix, isodistance and attribute calls. Measure latency and memory. Compare lengths against GraphHopper on 50 pairs. Audit tag coverage (sidewalk, surface, lit, ferry, bridge) in the test region. Stand up Photon.
- **Technologies:** Docker, Valhalla, Photon, Python notebooks, QGIS for inspection.
- **Deliverables:** benchmark notebook, tag-coverage report, measured distances for the worked example in section 8.
- **Challenges:** tile build configuration; elevation tile sourcing; ferry and bridge tagging errors.
- **Acceptance:** all four primitives work; a 25 km pedestrian route returns in under 300 ms on the target server; engine and geometry lengths agree within 0.5%.

### Phase 3: Core route-generation algorithm

- **Tasks:** implement the solver as a pure Python library with a command-line runner: ordering, feasibility gate, truncation, endpoint snapping, via-point lengthening, out-and-back, scoring, diversity filter. Build the regression harness from section 16.
- **Technologies:** Python, httpx, Shapely, pyproj, OR-Tools, pytest.
- **Deliverables:** `solver` package, 60 or more scenario fixtures, KPI report.
- **Challenges:** endpoint quality after truncation; spurs and repeated edges; rivers and coastline.
- **Acceptance:** point-to-point KPIs in section 16 met on the fixture set; every infeasible fixture returns a correct conflict object.

### Phase 4: Backend API development

Updated 2026-11-18 by the Phase 4 amendments.

**Status (2026-11-18): built.** Every acceptance criterion holds on the development laptop except the manual Garmin Connect and Strava import, which waits for the product owner. See [docs/reports/phase4/summary.md](reports/phase4/summary.md).

- **Tasks:**
  - the FastAPI app;
  - the schema and its Alembic migrations;
  - plan versioning with JSON Patch edits and the diff;
  - template explanations;
  - the GPX writer;
  - elevation profiles;
  - the Redis cache;
  - the solve slot limit;
  - anonymous client tokens and rate limiting;
  - Photon search and reverse with a picker.

  Login (magic link) moves to Phase 8.
- **Technologies:** FastAPI, Pydantic v2, SQLAlchemy 2, Alembic, PostgreSQL 16 + PostGIS, Redis, all in docker-compose and managed by uv.
- **Deliverables:**
  - a documented OpenAPI spec, with examples from real solver output;
  - a containerised service;
  - a report in `docs/reports/phase4/`: the endpoints, latency per endpoint, memory, and what was left out.
- **Challenges:** keeping p95 latency inside the budget when the solver makes many engine calls, with two solves sharing the engines.
- **Acceptance:**
  - create and patch return in under 5 s at p95 for point-to-point, on the development laptop;
  - cache hits return in under 100 ms;
  - GPX validates against the GPX 1.1 schema, and imports cleanly into Garmin Connect and Strava (checked by hand);
  - all tests pass;
  - the solver KPIs are unchanged.

### Phase 5: Front end and interactive map

Updated 2026-11-18 by the Phase 5 amendments.

**Status (2026-11-18): built.** The A01, S02 and G01 journeys pass end to end, with every number on screen checked against the API response; Lighthouse accessibility 100, performance 63. Checked on a real phone over the LAN (Redmi 12 5G, by the product owner). The five-runner hallway test waits for the product owner. See [docs/reports/phase5/summary.md](reports/phase5/summary.md).

- **Tasks:**
  - planner (start by search, tap or location; distance stepper; route type; towards a place or bearing; checkpoints with pass-near or must-reach; via, avoid, must-use; paths preference; constraint chips);
  - results: up to two alternatives plus Case B options, drawn in distinct colours and dash patterns; a card per candidate;
  - `over_budget` and conflict screens with one-tap fixes;
  - place picker; stops list with reorder; route detail with an elevation chart linked to the map;
  - version history with undo and redo, and the diff after every edit;
  - save, rename, share, GPX; the server-rendered share page;
  - loading, busy, solving, timeout and engines-down states; PWA manifest and icons (no offline mode).
- **Technologies:** Next.js (App Router), TypeScript, MapLibre GL JS, PMTiles built from the pinned extract, types generated from OpenAPI.
- **Deliverables:** the web app, usable on a phone; a report in `docs/reports/phase5/` with screenshots of each screen and state (mobile and desktop), Lighthouse scores, bundle size, the API changes made, and what was left out.
- **Challenges:** bottom-sheet and map gesture conflicts on mobile; drawing several routes legibly.
- **Acceptance:**
  - the A01, S02 and G01 journeys pass end to end in Playwright against the live stack;
  - every number on screen matches the API response;
  - the planner is usable on a phone over the LAN (HTTPS, documented);
  - five runners complete the A01 journey without help (run by the product owner).

### Phase 6: AI natural-language interface

- **Tasks:** schema-constrained parsing, patch validation, clarification flow, explanation generation with number validation, golden set, rule-based fallback.
- **Technologies:** an LLM API with structured output, Pydantic.
- **Deliverables:** `/messages` endpoint, chat drawer, evaluation report.
- **Challenges:** compound edits; place-name variants; relative references ("the second stop").
- **Acceptance:** 95% slot accuracy on the golden set; zero replies containing a number absent from the facts object.

### Phase 7: Route customisation and optimisation

- **Tasks:** loop generator with direction lean, optional stops, scenic variant, drag-to-edit, per-area circuity calibration, caching of matrices and isodistance results.
- **Technologies:** as before.
- **Deliverables:** loop KPIs report; performance report.
- **Challenges:** loop quality is subjective; convergence on sparse networks.
- **Acceptance:** loop KPIs in section 16 met; blind test where runners prefer or equal-rate the app's loops against a competitor's in at least half of trials.

### Phase 8: Testing, deployment and production readiness

- **Tasks:** field runs of 10 generated routes with a GPS watch; load test; monitoring, error tracking and backups; weekly graph build with regression gate; privacy policy; OSM attribution; closed beta with a run club.
- **Technologies:** Docker Compose on a VPS, a managed Postgres or self-hosted with backups, uptime and error monitoring.
- **Deliverables:** production deployment, runbook, beta feedback log.
- **Challenges:** discovering data errors only in the field; support load.
- **Acceptance:** 30 beta users, 100 or more generated routes, at least 20 routes run and rated, no route with an access violation.

## 16. Testing and validation strategy

Test the solver as a library against fixed scenarios on a pinned graph build, so every algorithm or data change produces a KPI report before it ships.

### Scenarios around Calicut

Coordinates are fixtures in `tests/fixtures/places.json` (OSM place nodes; the start south of Kadalundi is 11.05, 75.86). Scenarios 5, 7, 10, 12 and 13 and new scenario 15 were revised after Phase 2 measured the worked example (see Phase 2 amendments). Expected values in fixtures come from running the engine on the pinned graph, never from this table.

| # | Scenario | Setup | What it proves |
| --- | --- | --- | --- |
| 1 | 5 km loop | Kozhikode Beach | Short loops in a dense grid bounded by the sea on one side |
| 2 | 10 km loop | Mananchira, city centre | Loop scaling; avoidance of trunk roads |
| 3 | 10 km out-and-back | Along the beach road, heading north | Exact halving; coastal single-road case |
| 4 | 25 km towards Calicut | A start south of Kadalundi | Truncation, endpoint choice, direction adherence |
| 5 | **28 km** with Kadalundi, Chaliyam, Beypore | Same start, ferries excluded | Ordering, bridges, remainder allocation |
| 6 | Same as 5, ferries allowed | Same | Preference changes the endpoint; ferry metres reported separately; warning shown |
| 7 | 15 km with the same three stops | Same, under both ferry settings | Infeasible either way; explanation with correct savings |
| 8 | 50 km towards Kannur | Kozhikode | Long distance; many river crossings; latency |
| 9 | Changed destination | Scenario 4, then "towards Feroke" | Re-solve keeps start, distance and preferences |
| 10 | Changed distance | Scenario 5, then **32 km** | Endpoint moves; stops and order unchanged |
| 11 | Target nearer than budget | 25 km towards a place 12 km away | Case B options offered |
| 12 | Ambiguous place | A name with several matches in Kerala | Picker shown; no silent guess. **Phase 4** (the solver takes coordinates) |
| 13 | Hilly point-to-point | A ghat-road start in Wayanad | Climb and descent reported from elevation. The hills preference is unsupported in the MVP |
| 14 | Sparse network | A coastal village with one through road | Loop fallback to out-and-back |
| 15 | **25 km** with Kadalundi, Chaliyam, Beypore | Same start as 4, ferries excluded | Infeasible: the stops alone exceed the budget; "allow ferries" is offered as a fix |

Multiply scenarios by preference sets and random nearby starts to reach 200 or more fixtures.

### KPIs

| KPI | Definition | Target |
| --- | --- | --- |
| Distance accuracy, point-to-point | Absolute deviation of geometry length from target | Median under 0.5%; p95 under 1.5% |
| Distance accuracy, loops | Same | p90 under 3%; none above 5% |
| Length consistency | Engine-reported length against a spherical measurement of the same geometry (amended after Phase 2) | Within 0.1% or 2 m, whichever is larger, on every route |
| Feasibility | Routes with any edge lacking pedestrian access, or an unrequested ferry | 0 |
| Infeasibility handling | Infeasible fixtures that return a conflict object with correct numbers | 100% |
| Latency | Time to first set of alternatives | p50 under 2 s; p95 under 5 s point-to-point, under 8 s loops |
| Duplication | Share of length on repeated edges, excluding out-and-back | Median under 2%; none above 10% |
| Spurs | Dead-end excursions over 100 m per route | 0 for loops |
| Direction adherence | Share of length where network distance to the target increases | Under 15% |
| Endpoint bearing | Angle between requested bearing and start-to-end bearing | Within 30 degrees where the network permits |
| Checkpoint compliance | Mandatory stops within 50 m of the geometry | 100% |
| Road suitability | Share of length on trunk and motorway roads in the "recommended" alternative (Phase 3 amendment 18; primary reported as information) | Under 10%, or the stretch carries the national-highway flag |
| Alternative diversity | Edge-set overlap between returned options | Under 60% |
| Parse accuracy | Slot-level accuracy on the golden utterance set | 95% or better |

### Validating distance against geometry

1. **Engine length:** the summary length from the route response.
2. **Geodesic length:** decode the polyline at full precision and sum segment lengths on the WGS84 ellipsoid with pyproj, and again with `ST_Length(geom::geography)` in PostGIS. The two should agree to within metres.
3. **Compare 1 and 2.** A gap above 0.5% indicates simplified geometry, a decoding precision error, or a truncation bug.
4. **Slope correction:** 3D length exceeds 2D length by only about 0.5% on a sustained 10% grade, so ignore it on the coast and report it on hilly routes.
5. **Cross-engine check:** route the same via-points in GraphHopper. Differences above 1% usually expose a data or access-rule difference worth inspecting.
6. **Field truth:** run or cycle 10 routes with a GPS watch. Consumer GPS itself errs by 1% or more, so treat agreement within 2% as a pass and look for gross errors: blocked paths, private roads, missing bridges.
7. **Reference course:** measure one route with a calibrated bicycle or measuring wheel to anchor the whole chain.

### Other tests

- Property tests: the route starts at the start; stops appear in the declared order; a patch that changes nothing returns the same route.
- Regression gate on every weekly graph build.
- Load test at 5 concurrent solves on the production server size.

## 17. Cost and infrastructure estimation

A self-hosted MVP for one region should cost about 40 to 100 USD per month. These are planning estimates, not quotes; confirm server sizing in Phase 2.

| Item | MVP setup | Monthly estimate (USD) |
| --- | --- | --- |
| Application server | One VPS, 4 vCPU and 8 GB RAM, running Valhalla, GraphHopper, Photon, FastAPI, PostgreSQL and Redis in Docker. Measured on the development laptop (2026-11-18): the containers use 3.7 GiB with all of them up, GraphHopper 2.1 GiB of it ([docs/reports/phase4/memory.md](reports/phase4/memory.md)) | 20 to 50 |
| Database | PostgreSQL with PostGIS on the same VPS with nightly off-site backups, or a small managed instance | 0 to 25 |
| Basemap tiles | Self-hosted vector tiles on object storage, or a hosted tile plan's free tier | 0 to 10 |
| Front end hosting | Vercel or similar free tier | 0 |
| LLM | A small model; a few hundred tokens per message | 5 to 15 at beta volume |
| Domain, monitoring, email |  | 5 to 10 |
| Routing and geocoding API fees | None: self-hosted | 0 |

### How cost scales

- The engine is CPU-bound. One generation uses 5 to 30 engine calls, each tens of milliseconds, so a 4 vCPU server should handle several generations per second. Measure before trusting this.
- Covering all of India needs more disk and build time, not a different architecture. Global coverage needs a larger machine for tile builds or prebuilt tiles.
- The hosted alternative from section 5 costs roughly 800 to 1,000 USD per month at 1,000 generations a day, against a flat server fee.

### One-off and hidden costs

- Apple and Google developer accounts when a native app arrives.
- Your time maintaining the weekly data build and fixing OSM errors.
- Legal review of terms, privacy policy and location-data handling before a paid launch.

## 18. Risks and mitigation strategies

The twelve engineering challenges all have workable answers; the risks that could sink the product are about data quality and demand, not algorithms.

### Engineering challenges

| # | Challenge | Solution | Fallback |
| --- | --- | --- | --- |
| 1 | Landing close to exactly 25 km | Point-to-point: cut the path at the exact distance. Loops: iterate via-point radius against the measured length. | Show the deviation; offer "trim" or a short out-and-back tail to make up the difference |
| 2 | Unexpected engine distances | Re-measure every geometry independently; reject gaps over 0.5%; pin the graph build per route | Cross-check with a second engine in tests; flag the route to the user |
| 3 | Endpoint in a preferred direction | Truncate the path towards the named place; for a bare bearing, sample the isodistance contour inside a sector | Widen the sector step by step; then report that no endpoint lies that way |
| 4 | Multiple mandatory stops | Network matrix, open-path TSP, feasibility gate before any routing | Ask the user to fix the order or make a stop optional |
| 5 | Repeated roads | Edge-reuse metric from engine attributes; `through` vias; penalise and reject | Offer out-and-back explicitly, where repetition is expected |
| 6 | Loops and backtracking | Spur detection; backtrack share against the target; monotone-progress tie-break in ordering | Show the offending segment and let the user accept it |
| 7 | Straight-line versus network distance | Network distances for every decision; haversine only as a pre-filter and lower bound | None needed; this is a rule, enforced by code review and tests |
| 8 | Pedestrian-restricted and unsuitable roads | Pedestrian costing excludes no-access edges; default penalty on trunk and primary; report road-class mix | Name unavoidable segments (bridges) in the card |
| 9 | Bridges, ferries, rivers, disconnected networks | Ferries off by default; matrix gaps detected as disconnection; bridges treated as ordinary edges, which naturally constrain ordering | Offer the ferry as an explicit opt-in with a service warning |
| 10 | Missing or wrong OSM data | Tag-coverage audit; weekly rebuild with regression gate; fix OSM upstream; in-app "report a problem" | Local override file of blocked or corrected edges applied at build time |
| 11 | Ambiguous place names | Bias geocoding to the start; rank by importance and distance; picker on ties; remember the user's choice | Let the user drop a pin |
| 12 | Speed and cost | Self-hosted engine; concurrent calls; cache matrices and contours by request hash; cap candidates; 10 s budget returning best-so-far | Reduce alternatives from 3 to 2 under load |

### Product and business risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| The headline feature is a niche | Medium | High | Phase 1 interviews with a stated kill criterion; keep loops in scope |
| "Quiet" and "safe" disappoint because tags are sparse | High | High | Label them as road-type based; never claim safety; collect post-run ratings to build your own signal |
| An incumbent ships constraint-based generation | Medium | Medium | Move fast on regional depth and checkpoint logic; incumbents optimise for dense markets |
| Routes send someone somewhere unsafe | Low | Very high | Conservative defaults, visible disclaimers, problem reporting, terms of use, daylight and traffic cautions |
| Solo-developer overload from running data infrastructure | Medium | Medium | One region only; automate the build; keep the hosted openrouteservice API as an emergency fallback |
| Loop quality judged worse than Strava's | High | Medium | Do not lead with loops; compete on control and honesty |
| Licence misstep with OSM or a tile provider | Low | Medium | Attribution from day one; separate user data; read tile-provider terms |
| LLM misparse causes a wrong route | Medium | Low | Chips make the parse visible; the solver validates everything |

## 19. Future enhancements and business strategy

Earn the right to monetise by proving that runners finish the routes and rate them well; until then, growth through run clubs matters more than pricing.

### Future enhancements

- **More sports:** cycling (road, gravel), trail running and hiking profiles with surface and difficulty preferences.
- **Own quality signal:** post-run ratings and imported GPX tracks become a popularity layer for regions where heatmaps are thin.
- **Optional stops:** "pass a water point every 8 km" solved as an orienteering problem.
- **Native app:** live navigation in the background with audio cues, offline maps, watch sync (foreground Follow on the web: Phase 5d).
- **Integrations:** push routes to Garmin, Coros and Strava; pull training plans to pre-fill the distance.
- **Time-aware routing:** shade, lighting after dark, heat and rain warnings.
- **Own graph search:** a purpose-built loop algorithm in the style of the jogging-routes research once the engine-as-oracle approach limits quality.
- **Groups and events:** shared plans with meeting points, pacing groups and aid-station planning for clubs and race organisers.

### Target market and personas

| Persona | Need | Fit |
| --- | --- | --- |
| Marathon trainee | Weekly long run of an exact distance, new scenery, water stops | Core |
| Run-club organiser | Group route past agreed meeting points, shareable | Core; also a distribution channel |
| Travelling runner | A safe-enough route in an unfamiliar city | Good, once coverage widens |
| Endurance cyclist | 80 to 150 km towards a town via cafes | Strong later fit: point-to-point is natural on a bike |
| Trail runner and hiker | Loops by time and climb | Later; needs better trail data |

### Positioning

"Tell it the run you want; get a route that actually matches, or a clear reason why not." Compete on control, honesty and regional depth. Do not compete on social features or training analytics.

### Monetisation

- **Freemium:** free planning with a monthly cap on saved routes and exports; paid tier for unlimited saves, natural-language editing, advanced preferences and device sync.
- **Price anchors:** competitors charge about 24 to 60 USD a year for planning-focused tiers (section 3). Indian pricing would need to sit well below that.
- **Clubs and events:** a paid organiser plan for shared routes and branded share pages is a plausible second line.
- **Avoid for now:** ads, and selling location data.

### Partnerships and scale

Start with two or three Kozhikode running groups as design partners in Phase 1 and beta users in Phase 8. Expand region by region, because each new extract needs a data audit. The architecture scales by adding engine instances per region.

## 20. Final technical recommendations

1. **Validate demand before code.** Spend two weeks testing competitors in Calicut and interviewing runners. Proceed only if the distance-first, checkpoint problem shows up unprompted.
2. **Self-host Valhalla on OSM.** Use the hosted openrouteservice API only to prototype in the first weeks.
3. **Build the solver as a library first.** No API or UI until it passes the point-to-point KPIs on fixtures.
4. **Make truncation the core trick.** For "N km towards X", route to X and cut at N. It is exact, cheap and geographically sensible.
5. **Gate feasibility before routing.** One matrix call decides whether the stops fit and powers the explanation.
6. **Never show a number the engine did not produce,** and re-measure every geometry independently.
7. **Exclude ferries and highways by default.** Make exceptions explicit opt-ins with warnings.
8. **Ship the form before the chat.** Both edit the same request object; the LLM returns patches, not routes.
9. **Be honest about data.** Label "quieter" as road-type based, drop "safer" until you have evidence, and collect ratings to build a signal of your own.
10. **Stay in one region until KPIs hold,** then expand extract by extract.

### Open questions for Phase 1 and 2

- [ ] Does the open-source GraphHopper build include a matrix endpoint, or only the hosted API?
- [ ] What are current HERE and TomTom free tiers and pedestrian routing terms?
- [ ] What does RouteSpinner actually offer today?
- [ ] What is the measured sidewalk, surface and lighting tag coverage in Kozhikode district?
- [ ] What are the real network distances for the worked example in section 8?
- [ ] Is the Chaliyam to Beypore ferry running, and how is it tagged in OSM?
- [ ] How much memory and build time does a South India Valhalla graph need?

## Sources

Pages consulted in November 2026. Vendor pricing changes often; re-check before committing.

**Routing engines and APIs**

- [Valhalla route API reference](https://valhalla.github.io/valhalla/api/route/api-reference/) (read in part: location parameters and pedestrian costing overview)
- [GraphHopper Routing API: calculate a route](https://docs.graphhopper.com/openapi/routing/postroute)
- [GraphHopper pricing](https://www.graphhopper.com/pricing/)
- [GraphHopper forum: round trip heading reports](https://discuss.graphhopper.com/t/rund-trip-idea/9842)
- [openrouteservice plans](https://openrouteservice.org/plans/) and [API restrictions](https://openrouteservice.org/restrictions/)
- [Google Maps Platform pricing categories](https://developers.google.com/maps/billing-and-pricing/pricing-categories), [India price list](https://developers.google.com/maps/billing-and-pricing/pricing-india), [global price list](https://developers.google.cn/maps/billing-and-pricing/pricing)
- [Mapbox pricing summary (third-party, read 23 Oct 2026)](https://superdupr.com/blog/mapbox-pricing)

**Data and licensing**

- [OSM Foundation licence and legal FAQ](https://osmfoundation.org/wiki/Licence_and_Legal_FAQ)
- [OSM Foundation attribution guidelines](https://osmfoundation.org/wiki/Attribution)
- [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/) and [summary of its limits](https://moltchat-agent-commons.onrender.com/wiki/Nominatim_geocoding_usage_policy_and_rate_limits)
- [Copernicus DEM GLO-30 terms](https://developers.google.com/earth-engine/datasets/catalog/COPERNICUS_DEM_GLO30_2024_1)
- [Global evaluation of SRTM, NASADEM and GLO-30](https://katalog.lib.cas.cz/KNAV/EdsRecord/8gh,181153872)

**Algorithms**

- [Gemsa, Pajor, Wagner, Zündorf: Efficient Computation of Jogging Routes (2013)](https://i11www.iti.kit.edu/extra/publications/gpwz-ecjr-13.pdf)
- [Verbeeck, Vansteenwegen, Aghezzaf: arc orienteering problem and cycle trip planning (2014)](https://www.econbiz.de/Record/an-extension-of-the-arc-orienteering-problem-and-its-application-to-cycle-trip-planning-verbeeck-cedric/10010404550)

**Competitors**

- Strava: [subscriber features](https://www.endurancesportswire.com/strava-unveils-suite-of-new-subscriber-features/), [plain-language search](https://www.wareable.com/sport/strava-update-route-discovery-mapping-tools-offline-route-navigation-subscribers), [pricing mention](https://pipedot.org/6XED9), [Instant Workouts review](https://pipedot.org/730HG)
- Komoot: [running routes](https://www.komoot.com/running-app/create-running-routes), [ChatGPT integration](https://www.bike-magazin.de/en/tours/tour-tips/komoot-with-ai-route-planning-with-chatgpt-how-it-works/), [Premium pricing](https://dcrainmaker.com/2025/03/komoots-expanded-paywalls-trying-to-make-sense-of-it.html)
- Garmin: [round-trip course manual](https://www8.garmin.com/manuals/webhelp/GUID-3B607AEB-9EB5-4BF3-A38D-1F9926BB9F65/EN-US/GUID-D39D8539-1FE6-492E-B9F2-7B71DA432E8E.html)
- Footpath: [FAQ](https://footpathapp.com/support/faq/), [App Store listing](https://apps.apple.com/lk/app/id634845718?l=en-gb)
- Plotaroute: [membership comparison](https://www.plotaroute.com/subscribe)
- Runplanner: [launch post](https://runplannerapp.pages.dev/blog/welcome-to-runplanner.html)
- Bikemap: [loop planner](https://help.bikemap.net/hc/en-us/articles/14336111632796)

**Test region**

- [Chaliyam geography](https://ipfs.ssi.eecc.de/ipns/en.wikipedia-on-ipfs.org/wiki/Chaliyam)
- [Onmanorama: Beypore to Chaliyam jetty restoration and the 8 km detour](https://www.onmanorama.com/news/kerala/2025/08/29/kadalundi-jetty-restoration.amp.html)
- [Onmanorama: Ro-Ro service suspended on day one](https://www.onmanorama.com/news/kerala/2025/12/28/beypore-ro-ro-service-suspension-jhankar-docking-problems.html)
