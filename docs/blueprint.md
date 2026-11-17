# Intelligent Athletic Route Planner: Research & Development Blueprint

Nov 16, 2026 · @Azzm

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

**Web, PWA or native?** Start with a responsive web app installable as a PWA. Planning happens before the run, on a large map, and GPX export hands navigation to Garmin, Coros or Strava. Background GPS in an iOS PWA is unreliable, so live turn-by-turn navigation is deliberately out of the MVP and is the trigger for a native app.

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
  created_at  timestamptz NOT NULL DEFAULT now()
);
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
| `GET /v1/places/search?q=&lat=&lon=&limit=` | Geocoding through Photon, biased to (lat, lon), Kerala only | Ranked candidates with `place_id` (`osm:node/…`), label, district, kind, lon, lat; `ambiguous` with reasons. Never picks. 503 if Photon is down |
| `GET /v1/places/reverse?lat=&lon=` | Name for a point | 503 if Photon is down |
| `POST /v1/plans` | Create a plan: body `{request: RouteRequest, source}` | Solves; returns version 1 |
| `PATCH /v1/plans/{id}?source=form` | Body: RFC 6902 patch on the latest stored request, defaults filled in (`application/json-patch+json`; plain JSON is accepted too) | Re-solves; returns the new version with its diff. Optional `If-Match: "v<n>"`. Undo: `replace` at path `""` with an earlier request |
| `GET /v1/plans/{id}` | Latest version, list of version numbers, and `status` (`ready` or `solving`) | |
| `GET /v1/plans/{id}/versions/{n}` | Any earlier version, in full | |
| `GET /v1/routes/{id}` | One route as a GeoJSON Feature | LineString with Z; properties are the Candidate's stats, stops and flags |
| `GET /v1/routes/{id}/elevation` | Profile `[[distance_m, height_m], …]` every 30 m, plus the solver's gain and loss | |
| `GET /v1/routes/{id}/gpx` | GPX 1.1 course | Track with `ele`; waypoints for start, checkpoints, end |
| `POST /v1/routes/{id}/save` | Save under a name | Returns `{saved_id, share_slug, share_url}`; saving again renames it and keeps the slug |
| `GET /v1/me/routes` | This client's saved routes | |
| `GET /v1/share/{slug}` | Public read-only route | No token needed |
| `GET /v1/share/{slug}/gpx` | The shared route as GPX | No token needed. Added in Phase 4 so a share page can offer the download |
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
| 504 | `solve_timeout` | Over the 15 s budget. `detail` has `plan_id`, `status: "solving"`, `elapsed_ms` and the URL to poll |

### Operational rules

- Solves run in a worker thread, with at most 2 at once; extra requests wait up to 10 s for a slot, and each solve has a 15 s budget (amendments 3, 12, 13).
- Results are cached by the canonical request, both engine build ids and the solver hash for 24 h (amendments 5 and 14). Identical requests already in flight share one solve.
- Rate limits are per client and per IP (amendment 22).

## 13. UI/UX architecture

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
|  | Native app with live navigation and offline maps |
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

- **Tasks:** Planner screen, chips, stops list with reorder, route cards, elevation chart, place picker, saved routes, share page, PWA manifest.
- **Technologies:** Next.js, TypeScript, MapLibre GL JS, a charting library, vector tiles.
- **Deliverables:** deployed web app usable on a phone.
- **Challenges:** bottom-sheet and map gesture conflicts on mobile; drawing several routes legibly.
- **Acceptance:** a first-time user completes the section 13 journey without help in a hallway test with five runners.

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
- **Native app:** live navigation with audio cues, offline maps, watch sync.
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
