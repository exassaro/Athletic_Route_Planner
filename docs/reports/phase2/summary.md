# Phase 2 summary: data and routing engine experiments

Valhalla 3.9.2 on the Kerala OSM extract dated 2026-11-15, pedestrian costing. Everything was measured on the development laptop (Windows 11, Intel i5 10th gen, Docker Desktop on WSL2) on 2026-11-16. Every distance below comes from the engine or from measuring returned geometry.

## Acceptance (blueprint section 15)

| Criterion | Result | Evidence |
| --- | --- | --- |
| All four primitives work | **Pass** | [primitives.md](primitives.md) |
| A 25 km pedestrian route returns in under 300 ms | **Pass on the laptop**: p95 80 ms over 120 warm requests on four routes of 24.8 to 25.2 km; 314 ms for the first request after a restart. Not measured on the target server. | [latency.md](latency.md) |
| Engine and geometry lengths agree within 0.5% | **Pass, with a caveat**: largest gap 0.487% over 54 routes, and the gap is a one-sided bias (finding 3) | [length_check.md](length_check.md) |

## Goals

| # | Goal | Status |
| --- | --- | --- |
| 1 | Valhalla in Docker on an extract covering Kozhikode district, with elevation | Done. Kerala extract (179 MB), build about 6.5 minutes, 386 MiB peak. [engine_build.md](engine_build.md) |
| 2 | Script testing the four primitives | Done. `engine/experiments/01_primitives.py` |
| 3 | Length check within 0.5% | Done, passes. `02_length_check.py` and 54 integration tests |
| 4 | Latency of a ~25 km route under 300 ms | Done, passes on the laptop. `03_latency.py` |
| 5 | Tag-coverage report | Done. [tag_coverage.md](tag_coverage.md) |
| 6 | Real distances for the section 8 example, ferries excluded and allowed | Done. [worked_example.md](worked_example.md) |
| 7 | Photon running locally | Done, from the prebuilt India index (858 MB unpacked, 383 MiB container memory). [photon.md](photon.md) |

## Findings that affect the blueprint

### 1. The headline example does not fit in 25 km with ferries excluded

Measured geometry lengths for Start (11.05, 75.86), Kadalundi, Chaliyam, Beypore:

| | Ferry allowed | Ferry excluded |
| --- | --- | --- |
| Start to Kadalundi | 12.60 km | 12.60 km |
| Kadalundi to Chaliyam | 3.92 km | 3.92 km |
| Chaliyam to Beypore | 3.08 km, of which 622 m is ferry | 9.37 km by road |
| L_min (one route through the three stops) | 19.60 km | 25.89 km |
| Remainder at 25 km | 5.40 km | none: 0.89 km over |
| Beypore to Kozhikode | 9.21 km | 9.21 km |
| Outcome | Case A: end 5.40 km along the way to Kozhikode | Infeasible at 25 km, also beyond a 2% tolerance (25.5 km) |

So the blueprint's default (ferries off) turns the product's showcase request into an infeasibility message. Test scenario 5 ("25 km with the three stops, ferry excluded") is an infeasible case as written, and scenario 7 (15 km) is infeasible under both settings. The requested stop order is also the shortest order by matrix under both settings.

### 2. `use_ferry: 0` does not keep ferries out; `exclude_ferries` does

With `use_ferry: 0` alone the Start to Kozhikode route has no ferry. Add `shortest: true` or `use_lit: 1` and the same request crosses 340 m of ferry. With `exclude_ferries: true` no combination tested used a ferry ([quieter_probe.md](quieter_probe.md), ferry leak check; three integration tests guard it). The option is marked experimental in Valhalla's docs and needs `service_limits.allow_hard_exclusions`, which our config script switches on. Valhalla's default (`use_ferry: 0.5`) takes the Chaliyam–Beypore ferry.

No matrix cell was missing under any ferry setting. Chaliyam and Beypore stay connected by road, so section 8 step 3 (disconnection) does not apply to this pair and the section 13 message "no walking route between Chaliyam and Beypore with ferries off" would be wrong.

### 3. Valhalla's lengths run 0.1 to 0.5% long here because it measures on a sphere

The engine was longer than the WGS84 geodesic length of its own geometry on all 54 routes. Its length matches a spherical measurement of the same shape (median gap 0.017%), and the gap to the ellipsoid rises with the north-south share of the route (median 0.11% for mostly east-west routes, 0.48% for mostly north-south). On a 25 km route that is up to about 120 m.

Consequences: cut and report routes by geometry length on the ellipsoid, as section 8 step 11 already says; treat the 0.5% consistency rule as having almost no headroom at this latitude (a due-north route could exceed it with nothing wrong); remember that matrix distances carry the same bias when a feasibility decision is within 0.5% of the budget.

### 4. Pedestrian costing cannot produce a "quieter" alternative here

There is no pedestrian option that penalises trunk or primary roads. Across three pairs, the sidewalk, hill, lit, path and living-street options returned the default route or one sharing 77 to 100% of its edges, with one exception (Beypore to Kozhikode with paths preferred: 0 m on trunk and primary instead of 2,983 m, for 257 m more). Routing with bicycle costing set to avoid roads did change things: trunk and primary fell from 9,828 m to 4,361 m on the 29 km Start to Kozhikode route at almost the same length, with 40% edge overlap. That is a proxy with different access rules, not a pedestrian profile. The "direct, flatter, quieter" must-have needs a decision before Phase 3 (see below).

"Flatter" could not be tested meaningfully on the coast: `use_hills: 0` changed one route in three, by 65 m.

### 5. Sidewalk, surface and lighting tags are too sparse to drive any preference

In Kozhikode district (35,862 walkable ways, 11,439 km):

| Tag | Share of ways | Share of km | Note |
| --- | --- | --- | --- |
| sidewalk | 1.0% | 3.5% | 399 km of that is `sidewalk=no`; 2.9 km is tagged as having a sidewalk |
| surface | 5.0% | 12.2% | 86 to 95% on trunk and primary, 2 to 4% on residential and unclassified |
| lit | 0.1% | 0.1% | 7.9 km `lit=yes` |

This confirms the blueprint's risk: "quieter" and "safer" can only be road-class proxies, and surface mix can be shown only for main roads.

### 6. Ferry and bridge tagging

- Three `route=ferry` ways cross between Chaliyam and Beypore: way 173426286 (618 m, named "Ferry", no access tags; the one Valhalla uses between the two place nodes), way 155988683 (1,059 m, no tags beyond the route) and way 389395351 (338 m, `foot=yes`, `bicycle=yes`, `motor_vehicle=no`). None has `opening_hours`, `duration` or any tag saying whether it runs. OSM cannot answer whether the service operates today.
- Routes that use a ferry come back with the engine warning "Routing failed on first pass, retrying with relaxed restrictions".
- 57 bridge ways of 100 m or more sit on trunk, primary and secondary roads in the district. Those on trunk and primary roads are mostly tagged `sidewalk=no`; those on secondary roads mostly have no pedestrian tag at all. The engine treats them as ordinary walkable edges.

### 7. Smaller points for the solver

- **Stops should be `break` locations.** A `through` via at Kadalundi made the route 830 m longer than a `break` there (engine 17,411 m against 16,581 m), because the engine may not turn around at a through point. Keep `through` for shaping vias, as section 8 step 10 intends.
- **Place nodes are off-road.** Snap offsets were 2 to 54 m; Chaliyam's is 54 m, over the 50 m checkpoint rule. Measure compliance against the snapped point, or route to an address or road point.
- **Isodistance contours need re-routing.** Eight vertices sampled from the 5 km contour around Beypore were 1.7 to 5.0 km away by route. The contour is an outline, so each sampled endpoint must be routed and measured, as step 8 already says.
- **The matrix is asymmetric** where a ferry is involved (Chaliyam to Beypore 3.092 km, Beypore to Chaliyam 2.973 km).

### 8. Photon works for Latin-script names, not for Malayalam script

With the prebuilt India index, 8 of 9 expected places came back as the first result, each resolving to the same OSM place node the routing fixtures use. "Calicut" resolves to the Kozhikode city node, so the alias works. The Malayalam spelling കോഴിക്കോട് did not return the city in the top five (it returned a beach and a hospital whose names contain it). "Lakkidi" returned both villages of that name (Wayanad and Ottappalam), which is the case the place picker exists for. Median request time was 70 ms.

Section 10 expects Malayalam script to be normalised through the geocoder. The prebuilt index does not do that for place names; it would need an index built with Malayalam as a search language, which means the heavier own-import route. The index is also a different OSM snapshot (10 November) from the routing graph (15 November).

## Answers to the blueprint's open questions

| Question | Answer |
| --- | --- |
| Sidewalk, surface and lighting coverage in Kozhikode district | 3.5%, 12.2% and 0.1% of walkable km (finding 5) |
| Real network distances for the worked example | Finding 1 and [worked_example.md](worked_example.md) |
| Is the Chaliyam–Beypore ferry running, and how is it tagged | Tagging in finding 6. Whether it runs cannot be told from OSM |
| Memory and build time for a South India graph | Kerala only: 6.5 minutes, 386 MiB peak, 186 MB of tiles plus 371 MB of elevation. South India was not built |
| Does open-source GraphHopper include a matrix endpoint | Not checked; the GraphHopper comparison was deferred to Phase 3 |

## Not done in this phase

- GraphHopper comparison on 50 pairs (deferred to Phase 3 by decision).
- Latency on the target server; all timings are laptop timings.
- Visual inspection in QGIS. GeoJSON files for the routes and the contour are in this folder.
- The hilly control (Wayanad): elevation is loaded and returns 745 m at Vythiri, but no hill-preference test was run there.

## Decisions needed before Phase 3

1. **Ferry default against the showcase request.** Keep ferries off by default (the 25 km example then demonstrates the infeasibility explanation, with "allow the ferry" saving 6.29 km), or change the example and scenario 5 to a budget that fits, for instance by raising the distance above 25.9 km.
2. **How to get a "quieter" alternative.** Options: accept two alternatives (direct and flatter) for the MVP; use bicycle costing as a quiet-road proxy and verify pedestrian access on the result; or evaluate GraphHopper's custom model, which the blueprint names as the fallback for exactly this.
3. **Malayalam-script search.** Accept Latin-script search only for the MVP, or plan a custom Photon import (needs a Nominatim database, likely on a rented server rather than this laptop).
4. **The 0.5% consistency rule.** Keep it as is and accept occasional false alarms on north-south routes, or compare the engine against a spherical measurement for the bug-detection check and use ellipsoid geometry for every number shown.
