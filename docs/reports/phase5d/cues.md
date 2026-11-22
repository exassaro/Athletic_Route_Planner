# Phase 5d step 3: Follow cues (A15)

Measured 2026-11-22 on the development laptop, Valhalla 3.9.2 in Docker called from the host, by `uv run python api/scripts/measure_cues.py`. Every value and every cue of the four tracks: [cues_data.json](cues_data.json).

## The rule

1. A bend is a bearing change over 35° within 20 m, found in the geometry.
2. It is a cue if a junction (another walkable edge meets ours, from Valhalla `map_snap`) is within 15 m along the line. A turnaround is always a cue.
3. The road is the edge's name after the turn, read before the next turn. It is left out for the road the runner is already on and for a bare class of road ("MDR").
4. Cues under 50 m apart are merged; the later turns follow in `then`.
5. Without Valhalla every bend is a cue, with no names.

## Cue counts

| Route | Cues without Valhalla | **Cues with junctions** | Per km | Turns inside them | Turns with a road name |
|---|--:|--:|--:|--:|--:|
| A01 recommended, 25.0 km | 45 | **35** | 1.4 | 47 | 13 |
| S02 loop, 10.0 km | 39 | **37** | 3.7 | 45 | 18 |
| A01 shortest, 25.1 km | 27 | **22** | 0.9 | 28 | 10 |
| A01 half, out and back, 25.0 km | 23 | **21** | 0.8 | 33 | 11 |

The planning spike's 55 cues on A01 were bends grouped by distance alone, before cues were merged.

## Against Valhalla's own turn instructions

Recall: Valhalla's left, right and sharp turns that have a step of the same side within 30 m. Precision: steps that have a turn-like Valhalla instruction within 30 m. Valhalla's instructions are a reference made independently of this rule, not the truth on the ground.

| Set | Rule | Recall | Precision |
|---|---|--:|--:|
| 54 seeded OD routes | geometry only | 880/883 (99.7 %) | 1068/2051 (52.1 %) |
| | junction within 5 m | 852/883 (96.5 %) | 923/987 (93.5 %) |
| | junction within 10 m | 871/883 (98.6 %) | 953/1034 (92.2 %) |
| | **junction within 15 m** | **877/883 (99.3 %)** | **986/1088 (90.6 %)** |
| | junction within 20 m | 878/883 (99.4 %) | 1014/1128 (89.9 %) |
| | junction within 25 m | 878/883 (99.4 %) | 1031/1162 (88.7 %) |
| A01 recommended | **15 m** | 32/32 | 43/47 |
| S02 loop | **15 m** | 37/37 | 40/45 |
| A01 shortest | **15 m** | 21/21 | 26/28 |
| A01 half, out and back | **15 m** | 22/22 | 32/33 |

15 m, because a missed turn is worse than an extra cue: 5 m loses 25 more turns, and beyond 15 m one more turn is found at the cost of extra cues.

## Every stored route

A throwaway, read-only run over the 638 distinct geometries in the development database (377 GraphHopper, 261 Valhalla):

- none failed, and every one was matched in full;
- the metres at the last vertex equal the solver's stored length to 0.0000 m;
- time per route, matching included: p50 0.16 s, p95 0.34 s, worst 0.67 s;
- cues per km: p50 1.1, p95 3.2. Merged cues: 2 turns 2,414 times, 3 turns 222, 4 turns 32, 5 turns 7, 7 turns twice.

## Found while measuring, fixed

- `walk_or_snap` returns no matched points when the line is exactly Valhalla's, so every cue vanished on the 54 OD routes. `map_snap` is used.
- An out-and-back matched as one trace runs 387 m long at the turn. It is matched in pieces between turnarounds.
- A01 has a 164° corner that a 2 m tolerance took for a turnaround. A turnaround now needs the line back on itself within 0.5 m.

## Limits

- A turn under 35° (a slight fork) has no cue.
- **Most turns have no road name, because OSM has none:** 29 of A01's 47 turns and 24 of S02's 45 are onto unnamed roads. Those say "turn left".
- Names are OSM's as written: spelling, capitals and "Vattampoyil Railway gate" as a road included.
- Merged cues can be long (up to 7 turns): the screen and the voice should say the first two.
- Nothing was checked on the ground.
