# Phase 3b status: routing-rule changes

The product owner's Phase 3 amendments (top of [docs/blueprint.md](../../blueprint.md)) are built into the solver. Measured on the development laptop (not the target server) on 2026-11-17, on the pinned Kerala extract (2026-11-15), with Valhalla 3.9.2 and GraphHopper 11.1 running together.

Full KPI table: [kpi.md](kpi.md). Spike: [rules_spike.md](rules_spike.md). Acceptance results: [acceptance_A01.json](acceptance_A01.json) and [acceptance_A02.json](acceptance_A02.json), maps in the matching `.geojson` files.

## Where things stand

| Step | What | Status |
| --- | --- | --- |
| 0 | Pinned extract backed up as GitHub release `osm-kerala-2026-11-15`, restore tested | Done |
| 1 | Decisions recorded (blueprint "Phase 3 amendments", CLAUDE.md) | Done |
| 2 | Rules spike: road priority (model R5), pass-near as walking distance | Done; decisions 10 to 17 accepted |
| 3 | Ferries always excluded, opt-in and ferry fixtures removed | Done |
| 4 | ±500 m tolerance, `over_budget` outcome, repetition and consistency rules | Done |
| 5 | GraphHopper "recommended" + Valhalla "shortest", national-highway flag, `paths` preference | Done |
| 6 | Pass-near checkpoints, `must_reach`, junction/bridge/road kinds, boundary fallback | Done |
| 7 | `via`, `avoid`, `must_use`; edits hold the distance | Done |
| 8 | Acceptance fixture and 10 fixtures outside Kozhikode | Done |
| – | Loops | Not started (waits for the point-to-point KPIs) |

Tests: 78 unit tests and 69 integration tests pass.

## Acceptance test

Athlete's request: from Athanikkal towards Kozhikode, 25 km, passing near Kottakkadavu, Kadalundi, Chaliyam, the Karuvanthuruthy bridge, Beypore and Kallai (fixture A01). Every place is pinned by OSM id. "Karuvanthuruthy bridge" is not named in OSM; the developer chose way 389396419.

| Check | "recommended" (GraphHopper, the default) |
| --- | --- |
| Outcome | `ok` |
| Measured length | **25,000 m**. The full corridor to the Kozhikode city node is 25,060 m, so the run ends about 60 m short of it, on Francis Road |
| Through all six stops | 22,258 m |
| Order | Kottakkadavu (2.3 km), Kadalundi (2.9 km), Chaliyam (6.0 km), Karuvanthuruthy bridge (7.2 km), Beypore (15.3 km), Kallai (22.3 km): the requested order, which the solver chose itself |
| Walking distance from each place to the route | 19, 215, 628, 218 and 459 m; the bridge is crossed |
| Spur into Chaliyam's beach end | None. The route passes 628 m from the Chaliyam node on foot, along the Chaliyam–Feroke road |
| Ferry | 0 m |
| Repeated road | 0.0% |
| Road classes | 17.6 km secondary, 4.7 km residential, 1.6 km primary (the Feroke bridge over the Chaliyar, and the approach into Kozhikode), 1.1 km unclassified; no trunk, no footpaths |

"shortest" (Valhalla) reaches Kozhikode in 24,072 m, which is 928 m short and beyond the tolerance. It is therefore a Case B result: it offers "end at Kozhikode" (24.07 km) or "continue past Kozhikode" (25.05 km).

**The same request at 20 km (A02)** returns `over_budget`:
- The shortest way through the six stops is 21,739 m: an overshoot of 1,739 m.
- Each alternative gives its full route (21.74 km and 22.26 km) and a "cut at target" run of exactly 20,000 m, which keeps every stop except Kallai.
- Savings: dropping Kallai saves 6.60 km and dropping Beypore 1.95 km. Both fit the budget, so both come with "drop" and "make optional" fixes. Dropping any of the first four saves nothing, because the route passes them anyway.
- The "set distance" fix is 21.8 km.

## KPIs: 74 fixtures, one decision open

| KPI | Target | Measured | Pass |
| --- | --- | --- | --- |
| Outcome classification | 100% | 74 / 74 | yes |
| Distance accuracy | median < 0.5%, p95 < 1.5% | median 0.00%, p95 0.35% | yes |
| Reported length matches re-measured geometry | every route | 160 / 160 | yes |
| Length consistency (engine's own radius, + 0.2 m per edge) | every route | 160 / 160 | yes |
| Access violations or any ferry | 0 | 0 | yes |
| Over-budget conflict objects (brute-force reference) | 100% | 2 / 2 | yes |
| Latency per solve | p50 < 2 s, p95 < 5 s | p50 1.96 s, p95 4.25 s | yes (just) |
| Duplication beyond what must_reach stops force | median < 2%, none > 10% | median 0.0%, max 2.9% | yes |
| Checkpoint compliance (must_reach 50 m, pass near 1 km on foot, bridge/road used) | 100% | 160 / 160 | yes |
| Spur to reach a pass-near stop | 0 | 0 | yes |
| Avoid list respected | every route | 160 / 160 | yes |
| Expected stop order (acceptance) | every route | 5 / 5 | yes |
| Edit invariants (incl. via, avoid, must_use) | all hold | 5 / 5 | yes |
| National-highway flag matches the measured trunk stretch | every route | 160 / 160 | yes |
| Alternative diversity | < 60% | max 59%; both alternatives returned on 58 of 74 | yes |
| **Direction adherence** | every route < 15% | 76 / 83; max 25.9% | **no** (decision 1) |
| Road suitability (trunk + motorway share, "recommended"; amended, decision 2) | < 10%, or flagged | 0 over 10% without the flag; median 0.0%, max 14.3% (the flagged ghat) | yes |
| (info) Main-road share incl. primary, "recommended" | – | median 4.4%, max 23.7% | – |

The 10 fixtures outside Kozhikode (X01 to X10) all solve without a problem.

## Decisions needed

### 1. "Trunk last" against the direction-adherence target

Under model R5 (trunk ×0.1), "recommended" avoids national highways even at a large detour, and on a few routes it then winds away from the target for more than 15% of its length:
- **Wayanad ghat** (S13 family, 6 fixtures): Lakkidi to Thamarassery is 17.5 km down NH 766 (12.4 km of it trunk). "recommended" takes 27.3 km on side roads instead, a 56% detour.
- **X10** (Mananthavady towards Kalpetta via Panamaram): 26% away after Panamaram.
- **E02** (avoid the Feroke new bridge): 15%, just over the limit.

Options:
- (a) Keep R5 and apply the direction KPI to "shortest" only, reporting "recommended" as information.
- (b) Cap the detour: when "recommended" is more than, say, 30% longer than "shortest", re-solve it with trunk ×0.3. The route would then use the highway and carry the national-highway flag.
- (c) Keep everything as is and accept the failures.

My recommendation was (b). **Measured before building it, it does not work** (blueprint Phase 3 amendment 20):

| Lifted penalty, S13 Lakkidi → Thamarassery | "recommended" vs "shortest" (17.5 km) | Trunk used |
| --- | --- | --- |
| R5 as built (trunk ×0.1) | +56% | 1.2 km |
| trunk ×0.3 | +46% | 1.8 km |
| trunk ×0.6 | +42% | 14.4 km |
| trunk ×1.0 | +34% | 18.1 km |
| trunk ×1.0 and paths ×1.0 | 0% (the same route) | 12.4 km |

"shortest" also takes 1.7 km of footpath shortcuts across the ghat's hairpins, which R5 avoids too. On X10 the detour (+12%) comes from avoiding 19 km of primary road; lifting the primary penalty brings it to +2%. Revised options:
- (b′) When "recommended" is over 30% longer than "shortest", re-solve it with **every** penalty eased step by step (trunk, paths, primary) until it is within 30%, and flag it. This fixes S13 but not X10 or E02, which are under 30%.
- (d) Judge direction adherence on "shortest" only, and report "recommended"'s as information: its detours are the rules working.
- (b′) and (d) together.

### 2. The road-suitability KPI and "primary, mild penalty" (decided 2026-11-17: option (a))

Section 16's KPI (trunk + primary under 10% "in the quieter variant") predates amendment 2, which asks only a *mild* penalty on primary roads. Under R5 (primary ×0.6), 11 "recommended" routes carry 10 to 24% main road. That is almost all primary: trunk share has a median of 0% and a maximum of 14% (the S13 ghat). Typical cases:
- 50 km Kozhikode → Kannur: 11 to 15%, against 80 to 96% for "shortest";
- the Kochi bridges to Ernakulam (X01): 24%.

Options:
- (a) Redefine the KPI as trunk/motorway share under 10%, or flagged, and show primary as information.
- (b) Penalise primary harder, for example ×0.4 (the spike's R3 used ×0.5 with little effect on primary).

My recommendation is (a), because it measures what the amendment asks for.

### 3. Defaults I chose during implementation (confirmed 2026-11-17)

Please confirm or change:
- **Junction checkpoints** pass through the junction itself (within 50 m, no spur). Bridge and named-road checkpoints, and `must_use`, mean the route uses one of the item's OSM ways (decision 17).
- **No spur-free pass point and no boundary:** the stop is passed with the shortest spur and flagged `pass_near_spur`, rather than returning a conflict (decision 16). It never happened on the 74 fixtures.
- **Outcome over both alternatives.** A pass-near plan depends on the engine, so neither alternative is the minimum by definition. On S15, GraphHopper passed all three stops in 22.5 km where Valhalla's plan needed 26.0 km. So `over_budget` means *every* alternative's way through the stops exceeds D + 500 m, and the conflict numbers come from the shorter plan. An alternative whose own way doesn't fit, while the other's does, is returned as its full route plus cut, flagged `alternative_over_budget` (X02).
- **Avoiding a place given only as a point** avoids a 300 m circle round it.
- **Brute-force references** only cover requests where every stop is `must_reach` (S05m, S07m, S15m and their variants). For pass-near, via, avoid and must_use requests, the harness checks the outcome against the measured lengths instead: over budget if and only if the full route exceeds D + 500 m, and the savings arithmetic.

## Findings worth knowing

- **A separately routed tail can begin with a U-turn** at a through via, which the one-request re-route then cannot repeat. Measured on S07-n2: the cut came out 2.4 km over. Every run is now cut from the whole route's own geometry, with the end measured from the start.
- **The forced-repetition rule missed a dead-end last stop.** It now also counts the out-and-back run around a turn at a stop the run must reach (a `must_reach` stop, or a flagged spur).
- **`geodesy.sample_every` was quadratic.** It took 4 s of a 50 km solve, and had been since Phase 3. It is now a single pass, with identical output to within 2×10⁻¹⁰ m.
- **GraphHopper geometry seldom follows Valhalla edges exactly** (99 of 160 routes need map matching instead of `edge_walk`). Where it can't, junctions are unknown, so the cut ends mid-road at the exact distance (flag `endpoint_mid_road`) rather than at a junction.
- **Valhalla exclusion limits** were raised in `engine/valhalla/overrides.json` (500 locations, 200 km of polygon perimeter, 5,000 vertices) so that a ward boundary can be avoided.
- **Over-budget savings for passed stops are often 0 m**, because the route passes them anyway. That is correct, but the explanation layer should say so ("dropping Kadalundi does not shorten the run").
- **"Thrissur" has no place node** in the pinned extract. Its fixtures start from Ollur and Pavaratty.

## Engine use per solve

Counted over all 74 fixtures, across both alternatives, which run in parallel:
- **Requests without stops:** median 37 engine calls, range 12 to 75.
- **Requests with stops:** median 80, range 19 to 123. A01 used 118 calls and about 4 s. One GraphHopper route takes about 50 ms; Valhalla's map matching of GraphHopper geometry is the largest single cost.
