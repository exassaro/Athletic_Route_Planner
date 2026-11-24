# Phase 5d step 1: smart waypoints against even spacing

**The gate of amendment 2 tripped: the greedy rule does not always deviate less than even spacing at the same N. Decided 2026-11-22: the three recommendations at the end are accepted.** It fails only at N = 1 and 2. The web app asks only for 3 (mobile browsers) and 9 (elsewhere), and there it wins on every track measured.

Measured 2026-11-22 on the development laptop, Valhalla 3.9.2 in Docker called from the host, by `uv run python api/scripts/measure_overview.py` (every value: [overview_data.json](overview_data.json); two runs gave identical rows). Valhalla stands in for Google. **Nothing here was measured on Google Maps.**

Tracks: the committed A01 "recommended" and S02 loop, A01 "shortest" (to see the bias of Valhalla judging its own route), and a built out-and-back (A01's first half and back).

## At the two limits the app uses

Deviation is the worst straight-line distance between our line and Valhalla's path, leg by leg. Overlap is by leg. Length drift is the length of Valhalla's path minus ours, both measured from the geometry.

| Track | N | Deviation, even | Deviation, smart | Overlap, even | Overlap, smart | Drift, even | Drift, smart |
|---|--:|--:|--:|--:|--:|--:|--:|
| A01 recommended | 3 | 2,017 m | 1,078 m | 64.5 % | 78.9 % | −978 m | −664 m |
| A01 recommended | 9 | 479 m | 18 m | 86.3 % | 100 % | −271 m | +8 m |
| S02 loop | 3 | 524 m | 433 m | 23.4 % | 43.4 % | −1,554 m | −298 m |
| S02 loop | 9 | 360 m | 4 m | 71.2 % | 100 % | −623 m | 0 m |
| A01 shortest | 3 | 2,014 m | 253 m | 65.6 % | 97.6 % | −1,326 m | −76 m |
| A01 shortest | 9 | 609 m | 14 m | 91.4 % | 100 % | −197 m | −35 m |
| Out-and-back | 3 | 334 m | 9 m | 96.3 % | 100 % | −988 m | +11 m |
| Out-and-back | 9 | 334 m | 9 m | 96.3 % | 100 % | −988 m | +11 m |

Over all 36 rows (four tracks, N = 1 to 9), smart is closer to our length in 36, overlaps more in 35 and deviates less in 32.

## Where it fails

| Track | N | Deviation, even | Deviation, smart | |
|---|--:|--:|--:|---|
| S02 loop | 1 | 1,337 m | 1,337 m | tie |
| S02 loop | 2 | 1,061 m | 1,111 m | worse (overlap too: 13.8 % against 21.1 %) |
| Out-and-back | 1 | 2,863 m | 2,863 m | tie |
| Out-and-back | 2 | 2,673 m | 2,863 m | worse |

## An alternative, tried and not recommended

The best N points out of "smart at 9 plus even at N" (exact, by dynamic programming; a throwaway script, not committed) never deviates more than either, but still ties in three of the four cases above. At N = 3:

| Track | Overlap, smart | Overlap, alternative | Drift, smart | Drift, alternative | Alternative, uncached |
|---|--:|--:|--:|--:|--:|
| A01 recommended | 78.9 % | 85.9 % | −664 m | −802 m | 66 calls, 5.2 s |
| S02 loop | 43.4 % | 51.9 % | −298 m | −1,344 m | 77 calls, 4.2 s |

It makes the distance worse, which is the problem this phase set out to fix, and it is much slower: greedy takes at most 16 calls and about 1 s for all of N = 1 to 9 on these tracks.

## Two defects in the approved wording

1. **"The share of our length within 30 m of the proxy path" over-reports.** A point counts when any leg passes it, even the wrong pass. The out-and-back at N = 2 scores 100 % while Valhalla's path is 1,883 m short; by leg it scores 65 %.
2. **"Expect small differences" is not true with 3 waypoints.** S02 keeps 43 % of its path and A01 comes out 664 m short.

## Recommended

1. Keep the greedy rule as specified. Require and test "deviates less than even" at N = 3 and N = 9 on A01 and S02, not at every N.
2. Compute `overlap_pct` leg by leg.
3. Change the note to "Google may re-route between points, so the path and distance can differ. Our route: <km>. Estimated overlap: <n>% (tested with our router, not Google)."
