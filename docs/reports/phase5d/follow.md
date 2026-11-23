# Phase 5d step 5: the Follow logic under simulated GPS

**Simulated on the development laptop on 2026-11-22. Nothing here was measured on a phone or on the ground.** `cd web; npm run sim:follow` (about 10 minutes) runs the modules that ship (`web/src/follow/`) and writes every value to [follow_sim_data.json](follow_sim_data.json).

GPS models: **clean** is independent noise of 5 m sigma; **drift** is correlated noise (5 m, 20 s), closer to a phone; **poor** is correlated, 10 m sigma. Accuracy is reported as 1.5 sigma. Routes: A01, S02 and the out-and-back. A lock covers 0 to 4 m/s, then the runner moves on at 1.5 to 4 m/s.

## The two rules that were untested

| Rule | Measure | Clean | Drift | Poor |
|---|---|--:|--:|--:|
| **Hold when standing** (locked long enough at a loop's start that the window holds the finish, then 5 min standing) | Jumped, S02 | 0 of 500 | 0 of 500 | **4 of 500** |
| | Jumped, out-and-back | 0 of 500 | 0 of 500 | 0 of 500 |
| | Found after setting off | 100 % | 100 % | 99.2 % to 100 % |
| | Seconds after setting off, median | 11 | 11 | 16 |
| **Rejoin further ahead** (shortcuts skipping 300, 1,000 and 2,000 m; 1,634 per model) | Found | 100 % | 100 % | 100 % |
| | Jumped too far | 0 | 0 | 0 |
| | Seconds after rejoining, median | 3 to 10 | 5 to 11 | 7 to 13 |
| | Seconds, 95th percentile, worst case | 211 | 221 | 220 |

The slow tail is the approved formula: a runner who skips 2,000 m over a short straight line waits for the window to grow that far.

## Everything else

| Test | Clean | Drift | Poor |
|---|--:|--:|--:|
| Whole runs more than 100 m out at any moment (120 each) | 0 | 0 | 2 (worst 103 m) |
| Whole runs reaching 100 % | 120 | 120 | 117 |
| Whole runs with a false banner | 0 | 0 | 0 |
| Standing 5 min: progress added, median / worst | 15 / 34 m | 11 / 28 m | 22 / 81 m |
| After a lock of 15 s to 15 min, wrong pass (6,000 each) | 0 | 0 | 3 |
| After a lock, decided at the first fix, worst route and lock | 77.2 % | 77.2 % | 76.8 % |
| After a lock, wait when held, 99th percentile, worst case | 20 s | 24 s | 59 s |
| After a lock, standing on two passes: still held after 2 min | up to 7 % | up to 7 % | up to 7.2 % |
| Crossing a later part of the route: jumped (750 each) | 9 | 7 | 8 |
| 60 m detour: banner shown | 100 % | 100 % | 100 % |
| 60 m detour: seconds to the banner, median / 95th percentile | 11 / 11 | 11 / 11 | 11 / 19 |
| Back 100 m for water: false banner, or not found again | 0 | 0 | 0 |

## Real stored routes

Throwaway, read-only runs on the development database's geometries (not committed):

- **All 638 distinct routes, a whole run:** all reach 100 % with and without noise, none is ever 100 m out (worst 77 m at 5 m sigma), no false banner, and a fix costs under 0.4 ms.
- **40 of them, the full test list at fewer trials:**
  - 0 wrong passes in 12,000 locks and 0 jumps in 480 loop-start holds;
  - rejoins found in 2,589 of 2,592, the other 3 (one shortcut in each model) jumped too far;
  - 1 jump in 1,200 crossings;
  - 2 of 80 whole runs with poor GPS passed 100 m out, at one fix a second.

## Resuming after a refresh (2026-11-23)

A tab keeps only the metres done, the start time and the pauses, so the tracker does not know when it last matched. It assumes the earliest time those metres could have been reached. Throwaway simulation on this laptop with the modules that ship: A01, S02 and the out-and-back, drift and poor GPS, 800 trials a case. The cases are a refresh of 2 to 20 s moving, the same standing, and 1 to 15 minutes away.

| Measure | Time of the last match known | From the three kept values |
|---|--:|--:|
| Wrong pass (14,400 each) | 1 | 4 |
| False banner | 0 | 0 |
| Out-and-back, refresh while moving: decided at the first fix | 98.8 to 99.8 % | 54.8 to 55.6 % |
| Out-and-back, refresh while moving: wait, 95th percentile | 0 s | 16 to 25 s |
| Out-and-back, refresh while standing: still waiting after 2 min | 0.9 to 1.6 % | 44.5 to 44.8 % (until the runner moves) |
| A01 and S02, refresh while moving: wait, 95th percentile | 0 s | 0 to 11 s |

The three values are enough to resume. Storing the time of the last match would remove most of the out-and-back's wait; it is not approved and not stored.

## Bugs the simulation found, fixed

| Bug in the first version | Before | After |
|---|--:|--:|
| Crossing a later part of the route while lost moved progress there | 100 % | about 1 % |
| Standing just before a turnaround crept onto the way back | 248 m | 36 m |
| A loop's start jumped to the finish with poor GPS, because the finish alone was within reach of a noisy fix | 3.6 % | 0.8 % |
| Two followed passes that met tied for ever and froze progress | up to 8 % of rejoins never found | 0 |

Each has a unit test. Sixteen deliberately broken copies of the logic are all caught by the tests.

## Rules added to the amendments (*defaults*)

1. A fix on another pass of the route is never "off the route": the banner judges the nearest place on the whole route. Progress and cues wait.
2. A rejoin beyond the normal window counts after 40 m along the route, so a crossing moves nothing. After a lock a single fitting pass is taken at once.
3. Direction decides after 20 m of movement, or 2.5 times the accuracy if that is more. A pass the runner could have walked back to is a candidate, and never lowers progress.
4. A jump beyond the expected progress is refused while the pass just behind explains the fix as well (standing before a turnaround).
5. Fixes worse than 50 m only move the dot. From 30 to 50 m progress follows, "GPS is weak" shows and no banner is guessed.
6. Within 15 m of the end is the end.

## Limits

- **Standing where two passes meet stays "Finding you..." until the runner moves 20 to 40 m.** That is the approved rule: nothing can tell the passes apart.
- **A loop finished while locked**, when the lock was long enough to cover the whole loop, is held the same way: the summary then shows the progress from before the lock.
- A shortcut counts as distance done, because progress is the position along the route.
- Standing adds a little progress, because progress never goes backwards and noise does go forwards.
- Pace is the time over that progress, so it inherits all three.
- Real phones differ: bursts of bad fixes, silence while standing, and accuracy figures that are not 1.5 sigma.
