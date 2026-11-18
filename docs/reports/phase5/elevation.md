# Elevation: how it is smoothed, and how noisy the climb is

Phase 5 plan, step 3 (blueprint Phase 5 amendment 7, A7). Measured on the development laptop on 2026-11-18, on the pinned Kerala extract (2026-11-15), from the routes the Phase 4 latency run stored: 379 distinct route geometries from all 110 active fixtures and their patches. Script: `api/scripts/measure_climb.py --bridges`. Raw data: [climb_data.json](climb_data.json). **Nothing here changes the solver or the API.** The proposals at the end need decisions.

## How elevation is handled today

| Where | Source | Smoothing |
| --- | --- | --- |
| Solver `gain_m` / `loss_m` (cards, explanations, `routes.gain_m`) | Valhalla `/height`, samples every 30 m along the geometry | Moving average over 5 samples (150 m), then a 3 m hysteresis: a change counts only once it is 3 m from the last counted point (`scoring.climb`) |
| `GET /v1/routes/{id}/elevation` profile | The same 30 m samples, through the API's own `/height` call | **None.** Raw DEM heights, in whole metres |
| GPX `<ele>` and the GeoJSON Z | `/height` at every geometry vertex | **None.** Raw DEM heights |

The DEM is the `.hgt` tiles Valhalla downloads with `build_elevation` (1 arc-second, about 30 m; for Kerala they are SRTM-derived). SRTM is a radar **surface** model: it sees tree canopy, roofs and the water under bridges, not the road.

Check: recomputing the gain from the stored raw profiles with the solver's settings reproduces the solver's figure exactly (to 0.1 m) on **379 of 379** routes, so the table below compares like with like.

## What was measured

Routes are split by the median DEM height along them: **lowland** (median < 20 m, 317 routes: coastal Kozhikode, Kannur, Kovalam, Thrissur) and **upland** (62 routes: Wayanad, the ghat, inland Kozhikode).

| | Lowland | Upland |
| --- | --- | --- |
| Relief (max − min raw height), median | 24 m | 95.5 m |
| Jitter (SD of raw heights around a 270 m moving average), median | 1.16 m | 1.94 m |
| Bridge length on the route, median | 788 m | |

Gain per km (median and 90th percentile), and the share of the solver's current gain each setting keeps (median of per-route ratios). `wN` is the moving-average window in 30 m samples; `tN` the hysteresis threshold in metres. **w5 t3 is the solver today.**

| Setting | Lowland m/km p50 | p90 | kept | Upland m/km p50 | p90 | kept |
| --- | --- | --- | --- | --- | --- | --- |
| w1 t0 (raw, every step) | 13.5 | 17.9 | 3.31 | 20.5 | 24.3 | 1.98 |
| **w5 t3 (solver)** | **4.0** | **7.7** | 1.00 | **11.0** | **13.3** | 1.00 |
| w5 t5 | 2.9 | 6.4 | 0.74 | 9.1 | 12.1 | 0.85 |
| w9 t3 | 2.8 | 5.9 | 0.71 | 8.1 | 11.7 | 0.75 |
| w9 t5 | 1.9 | 4.7 | 0.48 | 6.8 | 10.3 | 0.64 |
| w13 t8 | 1.1 | 3.3 | 0.29 | 4.7 | 9.2 | 0.40 |
| w17 t10 | 0.6 | 2.5 | 0.15 | 3.5 | 8.6 | 0.32 |

**Bridges.** On a bridge the DEM gives the water or the river bed, so every crossing shows as a dip and a climb. Replacing the heights over each bridge (positions from Valhalla `trace_attributes`, `edge.bridge`) with a straight line between its ends, then smoothing as the solver does:
- lowland routes keep 0.912 of their gain (median), upland routes 0.983;
- A01 "recommended": 120.1 m becomes 106.5 m (6 bridges, 769 m of bridge). A01 "shortest": 110.7 m becomes 94.9 m (8 bridges, 1,365 m).

**Examples.** A01 "recommended" (25.0 km, heights 4 to 59 m): 120.1 m now, 61 m at w9 t5, 17 m at w13 t8. S02 loop 1 (heights 7 to 31 m): 78.4 m now, 48.0 m at w9 t5. Ninety-three lowland routes show 110 to 176 m, the range reported.

## What the numbers say

1. **Short-scale jitter is small** (about 1.2 m SD on the coast), and the 150 m window with a 3 m threshold already removes most of it: raw step-counting would give 3.3 times the current lowland figure.
2. **What remains varies over hundreds of metres**, and larger smoothing removes it from upland routes almost as much as from lowland ones. At w9 t5, lowland keeps 48% and upland 64%. At w13 t8, the figures are 29% and 40%. So smoothing cannot be shown to remove noise rather than real climb. Patches of canopy (coconut groves against open paddy) and real laterite hillocks both look like 5 to 15 m rises over 200 to 500 m. **Without ground truth, no smoothing setting can be justified from this data.**
3. **Bridges are a real, known error** that can be corrected without a tuning parameter: about 9% of lowland climb, 2% upland.

## Proposals

| # | What | Where | Effect | Recommendation |
| --- | --- | --- | --- | --- |
| P1 | The elevation endpoint also returns the profile smoothed exactly as the solver smooths it (5-sample moving average), so the chart's curve and the climb figure come from the same series | API (A7) | Display only; raw heights stay available | **Do it** |
| P2 | Flag `climb_approximate` when the route's median DEM height is under 20 m (lowland). The card shows "approx." and a note: "From a satellite surface model that includes trees and buildings; on flat coastal ground most of this may not be real climbing." | API (A7) | 84% of fixtures flagged, every coastal Kozhikode route | **Do it** (rule is simple and measured; revisit with P5) |
| P3 | Bridge correction in the solver's `climb`: heights over bridge edges interpolated between the bridge ends before smoothing | **Solver** | Lowland gain −8.8% (median), upland −1.7%; A01 120.1 → 106.5 m. `gain_m` is not used in scoring, so no route changes | Recommended, **needs your decision** (solver change) |
| P4 | Larger smoothing (e.g. w9 t5) | **Solver** | Lowland −52%, upland −36% | **Not now**: no evidence it removes noise rather than climb |
| P5 | Ground truth: export 3 to 5 of your own recorded runs on coastal Kozhikode roads from a watch with a barometric altimeter (FIT or GPX from Garmin Connect or Strava). A script compares the barometric gain with the DEM gain on the same tracks under each setting | Measurement | Gives a basis for P4 | Recommended before any smoothing change |
| P6 | GPX keeps raw DEM `<ele>` by default; `?ele=false` is offered in the UI as "let the app use its own elevation" | API (done, A2) | Apps that compute climb from `<ele>` may show more than the card. Check during the manual Garmin and Strava import | Keep |

Decisions needed: P1 and P2 (API, A7), P3 (solver), P5 (whether you can supply recorded runs).
