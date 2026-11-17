# Phase 3b rules spike: road priority and pass-near checkpoints

Spike for the Phase 3 amendments (top of [docs/blueprint.md](../../blueprint.md)). Measured 2026-11-17 on the development laptop (not the target server), on the pinned Kerala extract (2026-11-15), with Valhalla 3.9.2 and GraphHopper 11.1 running together. Ferries are excluded everywhere. Every length is the ellipsoid length of a returned geometry. Road classes, access, repetition and spurs come from matching onto Valhalla pedestrian edges.

Scripts: [08a_road_priority.py](../../../engine/experiments/08a_road_priority.py), [08b_pass_near.py](../../../engine/experiments/08b_pass_near.py), shared helpers [_rules.py](../../../engine/experiments/_rules.py). Fixture: [tests/fixtures/rules_places.json](../../../tests/fixtures/rules_places.json) (built by `engine/scripts/build_rules_fixtures.py`). Detail: [road_priority.md](road_priority.md); data and maps are the `pass_near_*` files in this folder (open the `.geojson` files in geojson.io).

## Decisions needed

1. **Road-priority model: R5** (primary ×0.6, trunk/motorway ×0.1, footway/path/track/steps ×0.1; ordinary roads 1.0). Section A.
2. **Measure "within 1 km" as walking distance, not straight line.** This replaces the default I proposed in the plan. A straight-line kilometre is met from the far bank of a river. Section B.
3. **When the national-highway flag fires.** Most trunk use left under R5 is a crossing of 125 m or less. Proposal: flag "uses a national highway; running there may be prohibited" at 200 m or more of trunk/motorway in one stretch. Shorter use gets the note "crosses a national highway". Section A.
4. **Order checkpoints on the Valhalla matrix.** On both tests it gives the same order as routing every pair in GraphHopper, which costs 56 calls and 2.7 s. Section C.
5. **No leg-by-leg routing for `must_reach` stops.** GraphHopper's `pass_through` does not block a required U-turn at a dead end. Section C.
6. **The engine consistency check uses each engine's own earth radius**: 6,371,000 m for GraphHopper. With it, all 54 pairs agree within 0.8 m. Section D.
7. **Keep the boundary fallback, but expect it rarely.** It is built, but no place tested here triggered it. Section B.

## Acceptance result

Request: from Athanikkal towards Kozhikode, 25 km, passing near Kottakkadavu, Kadalundi, Chaliyam, the Karuvanthuruthy bridge, Beypore and Kallai. Model R5, pass-near measured as walking distance (decision 2).

| Check | Result |
| --- | --- |
| Length through all six stops (L_min, to the Kallai pass point) | **22,258 m** |
| Full corridor to the Kozhikode city node | **25,060 m**: 60 m over, inside the ±500 m tolerance |
| Returned route (cut at 25 km, re-routed as one request) | **25,000 m**, outcome `ok`, ends about 60 m before the Kozhikode node |
| Stops in the requested order | Yes |
| Walking distance from each place to the route | Kottakkadavu 19 m, Kadalundi 215 m, Chaliyam 628 m, Beypore 155 m, Kallai 15 m |
| Bridge (way 389396419) | Used |
| Spur into Chaliyam's beach end | None. The route stays on the Chaliyam–Feroke road, 534 m from the Chaliyam node; spurs over 100 m: 0 |
| Ferry | 0 m |
| Repeated road | 0.0% |
| Trunk/motorway | 0 m (no national-highway flag) |
| Primary | 1,576 m: the Feroke bridge over the Chaliyar, plus the approach into Kozhikode |
| Footways and paths | 0 m |
| Solve time | 4.7 to 5.7 s over two runs, 26 engine calls (Section B) |

The route goes Athanikkal → Kottakkadavu → Kadalundi → up the Chaliyam–Feroke road east of Chaliyam → over the bridge → east to cross the Chaliyar at Feroke → west along the north bank to Beypore → Kallai → Kozhikode.

The request is not over budget, so `over_budget` does not apply to it. To exercise that outcome, the same request was run at 20 km:

- outcome `over_budget`, overshoot 2,258 m;
- the full route through all stops: 22,258 m;
- the ready "cut at target" candidate: exactly 20,000 m, keeping every stop except Kallai.

Valhalla's "shortest" alternative for the 25 km request is 24,072 m. It reaches Kozhikode 928 m short of the target. That is beyond the tolerance, so it is a Case B result: the target is nearer than the budget.

## A. Road priority (08a)

67 routes: the 59 Phase 3 spike pairs, plus the acceptance corridor leg by leg and end to end. "Extra" is the length against Valhalla's shortest.

GraphHopper got a new profile, `foot_rules`, carrying only the hard rules: pedestrian access (`foot=no` excluded, motorways not walkable unless tagged `foot=yes`), ferries at zero priority, and GraphHopper's exclusion of difficult hiking trails. It drops the stock `foot_priority`, which favours footways. Road-class priorities are sent with each request; landmarks stay valid because a request can only lower priorities. One-way restrictions do not apply to GraphHopper foot routing.

| | Shortest (Valhalla) | Phase 3 "fewer main roads" | R2 (0.6 / 0.2 / 0.1) | R3 (0.5 / 0.1 / 0.05) | **R5 (0.6 / 0.1 / 0.1)** |
| --- | --- | --- | --- | --- | --- |
| Trunk/motorway, all routes | 127.5 km | 1.1 km | 3.4 km | 1.3 km | **1.3 km** |
| Routes touching trunk | 28 | 12 | 20 | 14 | **14** |
| Primary, all routes | 129.8 km | 6.4 km | 24.8 km | 23.5 km | **27.7 km** |
| Footway/path/track/steps, all routes | 4.2 km | **19.1 km** | 0.4 km | 0.4 km | **0.4 km** |
| Extra length, median / p90 / max | – | +8.4% / +30.0% / +83.1% | +2.1% / +9.7% / +38.2% | +2.1% / +11.8% / +38.2% | **+2.1% / +10.8% / +38.2%** |
| Edge overlap with shortest, median | – | 19% | 42% | 39% | **39%** (45 of 67 below 60%) |
| Access violations (map_snap gap or OSM tags) | 3 map_snap gaps (known noise) | 0 | 0 | 0 | **0** |
| Ferry | 0 | 0 | 0 | 0 | 0 |

The ratios in the column headings are primary / trunk / paths. R1 (0.8 / 0.3 / 0.15) and R4 (R2 with paths ×0.02) are in [road_priority.md](road_priority.md). R4 is identical to R2: below ×0.1, the path weight no longer changes any route.

- **Why R5.** "Trunk last" needs about ×0.1. At ×0.2 (R2), five long pairs keep 350 to 540 m of NH 66 that ×0.1 avoids for 2 to 3.5 km more. "Primary, mild penalty" fits ×0.6. At ×0.5 (R3), primary barely drops while the p90 detour grows. At ×0.8 (R1), 69 km of primary remains.
- **The Phase 3 model is the wrong base.** It cut main roads hardest, but put 19.1 km on footways and paths, the opposite of rule 2(d), at a median +8.4% length.
- **Paths "only when nothing else connects".** Every route was re-routed with paths blocked. None needed a path: 0 routes failed or grew by more than 25%. Under R5 only two routes show 50 m or more of path (102 m and 275 m), and blocking paths changes neither route's length. That suggests Valhalla classifies those few edges as footways where GraphHopper sees a road; they are not detours onto paths.
- **The national-highway flag.** Under R5, 14 routes touch trunk:
  - 12 use 125 m or less, which is walking across NH 66 at a junction;
  - one uses 165 m;
  - one uses 487 m (pair 14, a 5.9 km route).

  Flagging every crossing as "running there may be prohibited" would be wrong and would teach users to ignore the flag (decision 3). Of the 11 trunk ways used, 10 carry an NH ref. No primary way used carries one, so trunk plus the `ref` name is a sound basis.
- **Service roads beside highways** are ordinary roads (priority 1.0) as decided. GraphHopper's `road_class` does not separate driveways and parking aisles from other service roads. No problem showed up in these routes.

## B. Pass-near checkpoints (08b)

**Method tested.** For each stop, in order, with the previous pass point as anchor A and the next stop as B:
1. Route A → B. If it already passes within 1 km of the place, its nearest point becomes the pass point, a through via that adds 0 m.
2. Otherwise, take candidate points within 1 km: a ring grid (16 bearings, out to 950 m) snapped with Valhalla `locate`.
3. Keep the best 8 by straight-line A–P–B, a pre-filter only.
4. Route A → P → B as through vias in the same engine and measure it.
5. Pick the candidate with the least added routed length and no spur.
6. If none qualifies, fall back to candidates inside the place's own OSM boundary, with a flag.

A bridge (`must_use`) becomes two through vias at its ends, nearer end first. The whole run is then routed as one request.

**Straight line versus walking distance.** Both definitions were run on the same cases.

| Stop (final route) | Straight-line definition: straight / on foot | Walking definition: straight / on foot |
| --- | --- | --- |
| Kallai (acceptance) | 907 m / **1,322 m** | 35 m / 15 m |
| Beypore (acceptance) | 619 m / 928 m | 127 m / 155 m |
| Chaliyam harbour (harbour test) | 785 m / **1,491 m**, pass point on the far bank | 598 m / 754 m |
| Acceptance outcome | Case B, 24,298 m to Kozhikode (702 m short) | `ok`, 25,000 m (corridor to Kozhikode 25,060 m) |

Under the straight-line rule, the harbour "passes" through a point on the other side of the river. The runner never sets foot in Chaliyam, and Kallai is "passed" 1.3 km away on foot. Measured on foot, each stop is reached the way a local would expect, at a small cost: +641 m for Kallai, +67 m for Beypore.

Walking distance comes from the Valhalla pedestrian matrix, from the place to sample points every 100 m along the route; the straight-line 1 km serves only as a pre-filter. It is a decision rule, not a route distance shown to the user.

**Results with walking distance, model R5** (data: [pass_near_network_data.json](pass_near_network_data.json)):

| Case | Recommended | Shortest (Valhalla, same method) |
| --- | --- | --- |
| Acceptance, 25 km | ok, 25,000 m, 0 spurs, 0.0% repeated | Case B, 24,072 m |
| Acceptance at 20 km | over_budget +2,258 m; cut candidate 20,000 m | over_budget +1,739 m; cut 20,000 m |
| Chaliyam harbour + Beypore, 25 km | ok, 25,000 m, 0 spurs, 0.4% repeated | ok, 25,000 m, 0 spurs, 0.7% repeated |
| Scenario 5 stops, 28 km | ok, 28,000 m, 0 spurs | ok, 28,000 m |
| Scenario 15 stops, 25 km | ok, 25,000 m: pass-near makes this fit | over_budget +1,023 m |

Every stop is within 1 km on foot on every returned route, in order, with no spur over 100 m and no ferry.

Scenario 15 changes outcome. With `must_reach` stops it was infeasible: 25.89 km through the stops, measured in Phase 2. With pass-near stops, the recommended route fits at 25,000 m. The Chaliyam dead end that forced 10.6% repetition in Phase 3 is no longer entered.

**The boundary fallback never triggered.** Even with the radius cut to 300 m for the harbour (a test of the mechanism, not the rule), both engines found a pass point 62 m from it on a loop road at the tip of the spit, with no spur over 100 m. The "shortest" route did repeat 4.0% of its length there ([data](pass_near_network_harbour-pass-near_300m_data.json)). The fallback is implemented, but nothing tested here exercises it.

Boundary coverage for the acceptance places:
- Every place lies inside an admin level 8 or 10 boundary.
- A name match works for Chaliyam (ward "Chaliyam Angadi"), Kadalundi (the whole panchayat, which also contains Chaliyam: too coarse), Beypore ("Beypore Port") and Kozhikode.
- It fails for Kallai, whose ward is spelled "Kallayi", and for Kottakkadavu, whose ward is "Kaithavalappu".

**Speed.** Pass-near solves took 2.4 to 7.5 s across the runs, with 13 to 26 engine calls, against a p50 target of 2 s. Two costs dominate:
- routing and Valhalla-measuring up to 8 candidates per stop;
- the matrix calls for walking distance.

In the solver, candidates can be ranked by the routed GraphHopper length alone (about 50 ms each), with Valhalla measuring only the winner until one passes the spur check. That should cut most of the cost; I have not measured it yet. One "shortest" run stalled for 994 s on a single Valhalla call and is excluded; a re-run of the same case took 2.9 s.

## C. Ordering and dead ends

- **Ordering.** On the acceptance stops and the scenario 5 stops, four methods all return your order: Valhalla matrix or GraphHopper pairwise routing, each scored as an open path or as a path ending at the target. The Valhalla matrix is one call. GraphHopper needs 56 routes (2.7 s) for 8 points.
- **must_reach at a dead end** (Kadalundi → Chaliyam harbour → Beypore). One request with `pass_through` on, one with it off, and two legs joined all give the same route: 15,016 m, a 1,153 m spur and 15.4% repetition. That spur is forced, and is what `must_reach` asks for. GraphHopper relaxes `pass_through` where a U-turn is unavoidable, so mixed requests need no leg-by-leg routing. Under amendment 8 this repetition is "forced by must_reach stops" and does not count against the limit.

## D. Length consistency for GraphHopper

GraphHopper's reported length is consistently 0.11% below our spherical measurement (median 0.111%, max 0.137% on the 54 pairs). It sums haversine segments on a sphere of radius 6,371,000 m; our check uses 6,378,137 m. Measured on GraphHopper's own radius, the median gap is 0.0014%, the maximum 0.80 m, and 0 of 54 pairs fail the 0.1% / 2 m rule. The check should use each engine's own radius (decision 6). Lengths shown to users stay ellipsoid geometry lengths, as now.

## Other findings

- **Re-routing "shortest" with through vias can drift.** In the straight-line run, Valhalla's re-routed scenario 5 and 15 routes came out 327 m and 405 m over the cut. GraphHopper's re-routes were exact in every case. The solver should re-measure after the re-route and correct the cut once, as Phase 3 does with the `reroute_mismatch` flag.
- **Kallai's name.** OSM spells it "Kallai" (a suburb) and its ward "Kallayi". A second Kallayi is near Thalassery. Phase 4 geocoding must match both spellings, and still ask when the place is ambiguous.
- **The Karuvanthuruthy bridge is not named in OSM.** You chose way 389396419 ("Chaliyam - Feroke Road"). The fixture records that choice. If the bridge has a name locally, adding `bridge:name` in OSM would let users find it.
- **Kadalundi's boundary is the whole panchayat**, which also contains Chaliyam. For the fallback, the most local boundary named after the place (the ward) should win, as the prototype does.

## What changed in the repository

- `engine/graphhopper/`: new profile `foot_rules` ([rules_base.json](../../../engine/graphhopper/custom_models/rules_base.json)) with landmarks. It adds one profile to the import (the graph cache was rebuilt).
- `engine/scripts/build_rules_fixtures.py` → `tests/fixtures/rules_places.json`: acceptance places by OSM id, with their containing boundaries.
- `engine/experiments/08a_road_priority.py`, `08b_pass_near.py` and `_rules.py`: spike code only. The solver is unchanged.

Next, after your decisions: implementation steps 3 to 9 of the Phase 3b plan.
