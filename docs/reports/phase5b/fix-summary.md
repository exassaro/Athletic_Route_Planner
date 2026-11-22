# Phase 5b-fix summary

Bugs, small features and the final logo, on top of the Phase 5b redesign ([summary.md](summary.md)). Decisions: blueprint Phase 5b amendments 12 to 28. No solver change. One additive API change, A9 (km marks in the share response).

Measured on 2026-11-22 on the development laptop (Windows 11, i5 10th gen, 16 GB), not on a target server.

## The blank map: root cause

**Chrome on Windows returns zero-filled bodies for cached Range responses after overlapping requests have been aborted** (a reload, a map move). The response looks right (206, the right `Content-Range` and length) and its bytes are zeros, so pmtiles reports "Wrong magic number for PMTiles archive".

pmtiles works around this with `cache: "no-store"`, but only when the user agent contains "Windows". iPhone emulation in DevTools removes that word, so the workaround switched itself off. That is why desktop view worked.

Evidence (22 s of overlapping Range requests, about 30 % aborted, every body compared with the file):

| Setup | Wrong bodies | Correct |
| --- | ---: | ---: |
| Chromium, `next start`, before | **263** | 2,701 |
| Chrome 157, before | **473** | 4,469 |
| Chromium, `next dev`, before | **165** | 1,403 |
| Chromium, before, nothing aborted | 0 | 6,120 |
| Server header `no-cache` | **271** | 2,830 |
| Server header `no-store` | 0 | 5,251 |
| Fetch with `cache: "no-store"`, Chromium | 0 | 6,028 |
| Fetch with `cache: "no-store"`, Chrome | 0 | 6,011 |

- **Range handling was correct:** `next dev`, `next start` and Caddy answer `bytes=0-16383` with 206, `Content-Range` and `Content-Length: 16384`. A 200 with the whole file was never seen.
- **The container was not the cause:** it had a height, and MapLibre's own ResizeObserver followed resizes at the three sizes tried. No second observer was added; the test checks that the canvas fills its box.
- **The fix:** always fetch with no-store; serve the file with no-store; retry once; then "Reload map", with the OSM credit still visible.
- **An already poisoned browser recovers:** a profile poisoned under the old headers drew the map after the fix, with no error.
- **The test:** two normal loads passed even before the fix, so `e2e/basemap.spec.ts` also exercises the trigger. All four of its tests fail on the old build, and pass on the new one under `next start` and `next dev`.

## Before and after, by item

Screens before: [after/screenshots/](after/screenshots/) (the Phase 5b build). Screens now: [fix/screenshots/](fix/screenshots/).

| Item | Before | After | See |
| --- | --- | --- | --- |
| 1 Blank map | Blank, error in the console, OSM credit gone, 404 for the worker's .map | Draws cold and warm; on failure "Reload map" with the credit; .map served | `basemap` tests |
| 2 Undo message | Over the route card at half | Above the sheet and credit, moves with it; at full its own row | screens 08, 09 |
| 3 Km labels | Collided; "10 km" read "0 km" under the route line | From zoom 12, over the lines, hidden under markers. Below zoom 12 only the 5 km dots show | screen 08 |
| 4 End flag | On "Kozhikode" | Pole on the end point, flying away from the route; the name steps aside | screen 08 |
| 5 Duplicate numbers | Peek bar and card both showed them | Peek bar only at peek | screen 08 |
| 6 Chip row | Clipped with no hint | Fades at the clipped edge, snaps | screen 08 |
| 7 Pin hop | Looped for ever, about 2 % of the main thread | 3 hops, 1 per tap, then rest at no cost | pincost, below |
| 8 Runner | Pixel runner | Sneaker mascot (93 px), 4-frame sneaker loading cycle | [fix/mascot/](fix/mascot/) |
| 9 Directions | N, NE, ... and "Heading 135°" | Full words, where each lies on the map, dial, "Heading south-east" | screens 05, 06 |
| 10 Compass | MapLibre's | 48 px pixel compass, faces north on a tap, marks the picked direction | screen 05 |
| 11 Open in | GPX download only | Google Maps, share or download the GPX, Garmin and Strava help | screen 19 |
| 12 Share facing | Could face the other way from the planner | Same way (A9) | `openin` test |
| 13 Saved-route view | Map 45 % of the screen, its own panel | The planner's sheet at peek, "Map" button, collapsible panel on desktop | `share` test |
| 14 Saved-route pin | Still | 3 hops on open, 1 per tap | `pin` test |
| Brand | Wordmark in Silkscreen, sneaker icons | Drawn wordmark, O icons, OpenGraph image | [fix/brand/](fix/brand/) |

Found and fixed on the way:

- A tap on a button in a peeked sheet was lost, because the sheet opened under the finger.
- During setup the start pin was under the sheet, so its hops were never seen.
- At full, the OSM credit was under the top bar.
- The first fix for item 4 hid "Kozhikode" in A01 with six stops. The screenshots showed it; a test now covers that case.

## Where the build differs from the request

Approved on 2026-11-22 before building:

- **Google Maps:** 3 waypoints in mobile browsers (Google's limit), 8 elsewhere, chosen from the API's km marks. A9 therefore returns every km mark, not only the first.
- **Share GPX:** Chromium on desktop and Android refuses `.gpx` in Web Share even when `canShare` says yes, so there it downloads and says so.
- **Strava:** no upload link, which would always fail (no timestamps in a course). A link to Strava's route-import help instead.
- **Direction to a place:** the UI works out the bearing for that label only.
- **Logo:** backed by the surface token in the light theme; OpenGraph background #FBF8F1; maskable icon on 11 × 11; the dot on the green tile is exempt from the contrast rule.
- **Mascot:** 93 px (the sprite is 31 × 17, at whole pixels). "2-hop idle that rests after 3 hops" was built as three hops.

Decided while building:

- **The 180 px Apple icon is a full square:** iOS paints transparent corners black.
- **Below zoom 12 only the 5 km dots show:** once drawn above the line, every dot beaded it.
- **Item order:** the share page's "Open in..." landed with item 12, which supplies its points.

## The start pin's cost

`npx playwright test --project=pincost` through Caddy on the final build: phone viewport, CPU 4× slower, 5 s windows, median of five alternating rounds.

| State | Main-thread time | Style recalculations | Layouts |
| --- | ---: | ---: | ---: |
| Pin at rest | **52 ms** (44 to 57) | 0 | 0 |
| Pin removed | **56 ms** (28 to 181) | 0 | 0 |
| Three hops, once | 174 ms | 20 | 2 |
| Phase 5b, hopping for ever | about 160 ms in every 5 s | 22 to 32 | 0 |

Amendment 10 as reworded ("no main-thread cost at rest") is met.

## Tests on the final build

- **Through Caddy** (`https://172.24.255.68`): A01, S02, G01 and 21 further checks pass (24 in all). The cache-trigger test cannot run over an untrusted certificate, so it ran on `http://127.0.0.1:3000` against the same build, twice: pass.
- **Web:** 134 unit tests (85 before), typecheck, lint, stale-type check and build pass.
- **Python:** 213 unit and API tests and the 7 live API integration tests pass; the OpenAPI export is current.
- **Untouched:** `solver/`, `engine/`, migrations and scenario fixtures.

## Lighthouse

13.0.1 mobile through Caddy, median of three runs ([fix/lighthouse/](fix/lighthouse/)).

| Page | | Performance | Accessibility | FCP | LCP | TBT | CLS | Speed index | Main-thread work |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Planner | Phase 5b | 70 | 100 | 0.91 s | 1.94 s | 3.08 s | 0 | 2.40 s | 5.69 s |
| | **now** | **69** | **100** | 0.91 s | 1.96 s | 3.82 s | 0 | 2.97 s | 7.32 s |
| Share | Phase 5b | 69 | 100 | 0.91 s | 1.96 s | 3.17 s | 0 | 2.90 s | 6.85 s |
| | **now** | **68** | **100** | 0.92 s | 2.03 s | 3.27 s | 0 | 4.06 s | 9.91 s |

Accessibility passes its gate (95). **Performance is one point lower on both pages, and main-thread work is up by about 1.6 s and 3.1 s at 4× slowdown.** The cause was not isolated. Candidates: the share map is now full-screen rather than 45 % high, label placement has more work, and the laptop's load differed between the two days.

## Not tested

- **A real iPhone, Safari, or an Android phone.** Everything ran in desktop Chromium with phone viewports. The root cause was also reproduced in Chrome 157, headless. The DevTools device toolbar itself was not driven.
- **Whether Google Maps draws the route.** The URL and the new tab were tested with Google intercepted, so no coordinates left the laptop.
- **A successful share of a GPX.** The refusal and fallback were tested with a stubbed `navigator.share`; Chrome's real refusal was seen once, headless.
- **Garmin Connect and Strava imports.** No Garmin app and no Strava subscription. Whether Strava's route import needs a subscription could not be confirmed.
- **Garmin's steps.** Its help site refused automated reading (403), so the app only links to it. A search summary of that page says "Training & Planning > Courses > Import", not "Training > Courses > Import"; check it in a browser.
- **Installed icons** on iOS and Android, and how chat apps render the OpenGraph card.
- **CI on Linux:** the branch has not been pushed. The solver KPI harness and the solver's own integration tests were not re-run (no solver change).
- **The hallway test:** still open from Phase 5b.

## Left open

- The zoom buttons stay white in the dark theme.
- The route line still crosses some place names.
- Blueprint Phase 4 says Strava imports the GPX "as routes". That is true only through its route builder, and is unverified here.
- `NEXT_PUBLIC_SITE_URL` must be set at build for a deployment, or OpenGraph links point at `http://localhost:3000`.

## Sources

- Google Maps URLs, waypoint limits: https://developers.google.com/maps/documentation/urls/get-started
- Chromium's shareable file types: [desktop](https://chromium.googlesource.com/chromium/src/+/main/chrome/browser/webshare/share_service_impl.cc), [Android](https://chromium.googlesource.com/chromium/src/+/main/components/browser_ui/webshare/android/java/src/org/chromium/components/browser_ui/webshare/ShareServiceImpl.java)
- Web Share: https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share
- Strava, time information missing: https://support.strava.com/en-us/articles/15402153-why-does-strava-say-time-information-is-missing-from-my-file
- Strava, a route from a GPX: https://support.strava.com/en-us/articles/15402061-how-do-i-create-a-route-from-a-gpx-file
- Garmin, "Importing a Third-Party Course into Garmin Connect" (linked, not readable): https://support.garmin.com/en-US/?faq=wKuZXCaZRP4mWPX5aRz5h5
