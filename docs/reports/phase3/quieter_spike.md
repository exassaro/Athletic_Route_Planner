# Phase 3 spike: how to build the "fewer main roads" alternative

Decision needed: which engine produces the second MVP alternative. Measured 2026-11-16 on the development laptop, on the pinned Kerala extract (2026-11-15), with ferries excluded everywhere. Full tables: [quieter_spike_measurements.md](quieter_spike_measurements.md). Script: `engine/experiments/07_quieter_spike.py`.

## Recommendation

**Option (b), GraphHopper's foot profile with a custom model, as the generator for "fewer main roads".** It removes almost all main-road walking, it never used a way that pedestrians may not use, and it is the fastest of the three. Its cost is a second engine to build and keep in sync, which is modest at Kerala scale (below).

Option (a), Valhalla bicycle costing, should not be used. Its worst failure is on the product's showcase leg: from Chaliyam to Beypore it crosses the Feroke Old Bridge, which is tagged `foot=no`, producing a route 1.8 km shorter than any legal walking route. A walkability re-check can catch this, but then the alternative simply fails on that leg.

## What was compared

59 routes: the 54 fixed Phase 2 pairs (0.8 to 40 km) and 5 named pairs (worked-example legs and Kozhikode to Thamarassery). Baseline is Valhalla pedestrian ("direct").

- **(a)** Valhalla `bicycle` costing, `use_roads: 0`, `bicycle_type: Hybrid`, then re-checked as walkable with pedestrian costing.
- **(b)** GraphHopper 11.1 `foot` custom model, plus `road_class == TRUNK || PRIMARY` priority × 0.2 and ferries blocked. Landmarks prepared, no contraction hierarchies, so the weighting stays changeable per request.

Every geometry was measured with one yardstick: matched onto Valhalla pedestrian edges for road class, ellipsoid length of its own geometry for distance.

## Results

| | Baseline (Valhalla pedestrian) | (a) Valhalla bicycle | (b) GraphHopper foot + custom model |
| --- | --- | --- | --- |
| Trunk + primary share, median route | 14.9% | 2.0% | **0.0%** |
| Trunk + primary metres, all 59 routes | 244.0 km | 81.5 km (−67%) | **5.8 km (−98%)** |
| Routes with > 200 m of main road in the baseline: main road at least halved | – | 28 of 42 | **41 of 42** |
| Extra length against baseline, median / p90 / max | – | +5.7% / +16.8% / +48.7% | +6.8% / +24.5% / +51.0% |
| Edge overlap with baseline, median (kept as an alternative only below 60%) | – | 37% (44 of 59 below 60%) | **18% (46 of 59 below 60%)** |
| Pedestrian-access violations (OSM tags) | 0 | **2** | 0 |
| Latency p50 / p95 per route | 53 / 89 ms | 176 / 231 ms (route + re-check) | **13 / 42 ms** |
| Routes not found | 0 | 0 | 0 |

**Access violations, in detail.** Both violations by (a) are the Feroke Old Bridge ([way 155988679](https://www.openstreetmap.org/way/155988679), `highway=secondary`, `foot=no`, `sidewalk=no`), on Chaliyam → Beypore and on Start → Kozhikode. Neither Valhalla pedestrian nor GraphHopper foot ever used it.

How to re-check walkability, tested directly on that bridge:
- Pedestrian `edge_walk` is **not** an access check: it accepted the bicycle route across the bridge.
- Pedestrian `map_snap` left 302 m of it unmatched, so a coverage check catches it. That check is noisy, though: it also flagged 3 of Valhalla's own pedestrian routes and 3 harmless (a) routes, where matching covered more than the geometry.
- The OSM tag check had no false positives once `highway=corridor` (covered footbridges) was counted as walkable.

**Extra length** is similar for both options. (b) has a longer tail: 51% on the worst route, a 1.4 km pair where avoiding a primary road means a long detour. The solver budgets distance anyway, so a longer path to the target only changes where the cut lands. The diversity filter and the "unavoidable main road" flag handle the rest.

**Unavoidable main road.** On Chaliyam → Beypore, (b) still uses 644 m of primary road: the crossing of the Chaliyar at Feroke. On Start → Kozhikode it uses 748 m. These are the bridges the blueprint expects the card to name.

## Cost of running GraphHopper as a second engine

| Item | Measured |
| --- | --- |
| Import of the pinned Kerala extract, both profiles, landmarks | 185 s |
| Peak memory during import (Java heap capped at 3 GB) | 1.9 GiB |
| Graph on disk | 202 MB |
| Memory while serving | about 1.9 GiB (heap not returned after import; a serve-only restart would use less, not measured) |
| Image | `eclipse-temurin:21-jre` + GraphHopper 11.1 release jar (`engine/graphhopper/`) |

Valhalla used about 160 MiB at the same time. Both fit on this laptop and on the 8 GB VPS assumed in section 17. The weekly data build gains one step, the same pinned extract feeds both engines, and the regression gate must cover both.

## Cross-engine length check (the blueprint's deferred 50-pair comparison)

GraphHopper's plain foot profile against Valhalla pedestrian, both on the same extract: the median length difference is 5.1% (p90 17.6%, max 38.2%). These are path choices, not measurement errors. GraphHopper's stock foot profile already avoids main roads through `foot_priority`: 0.5% median main-road share against Valhalla's 14.9%, at a median 4.2% more length. The "direct" alternative therefore depends on which engine produces it, and should stay on Valhalla, which takes the shortest path.

## If you choose (b): how it fits the solver

- **Generation:** "fewer main roads" calls GraphHopper for the route to the target (and between checkpoints), cuts at the remainder exactly as "direct" does, then re-routes the whole run through GraphHopper.
- **Measurement and checks:** stay on one yardstick. Lengths come from the geometry. Road classes, checkpoints and the access check go through Valhalla matching plus the OSM tag check, as in the KPI harness.
- **Untested variant (b′):** take a few shaping points from the GraphHopper geometry and replay them in Valhalla as `through` vias. Every returned route would then be a Valhalla pedestrian route, at the price of one more call and some fidelity to the GraphHopper path. Worth a short test only if a second engine in production is unwelcome.

## Decision needed

Choose (b), (b′), or something else. Until then the solver returns only "direct", and the KPI report marks alternative diversity "n/a".
