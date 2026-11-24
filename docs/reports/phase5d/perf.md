# Phase 5d step 9: Lighthouse through Caddy

**Measured on the development laptop on 2026-11-23, not on a phone or the target server.** Lighthouse 13.0.1, its default mobile profile (simulated throttling, 4× CPU slowdown), in headless Chrome for Testing 159, three runs per page and build. Every figure below is the median of the three runs, taken for each metric on its own; the performance score of each run is in brackets. The reports are in [lighthouse/](lighthouse/) (`before` is `main`, `after` is this branch).

The stack was isolated, as in Phase 5c: a copy of the development database, the branch's API on port 8100, and the two production builds (`next start`), this branch on 3100 and `main` (36a0c43, before Phase 5d) on 3101. A throwaway Caddy (`caddy:2.10.2`, `tls internal`) served them on the LAN address, `https://172.24.255.68:8443` (branch) and `:8444` (main). The engines, Postgres and Redis servers were shared. The runs alternated between the two builds, so a change in the laptop's load hits both. Lighthouse's benchmark index still ranged from 928 to 1,427 across runs.

## Result

| Page | Build | Performance | Accessibility | FCP | LCP | TBT | CLS | Speed index | Main-thread work |
|---|---|--:|--:|--:|--:|--:|--:|--:|--:|
| Planner `/` | main | 69 (69, 68, 69) | 100 | 0.92 s | 1.93 s | 4.67 s | 0 | 3.15 s | 8.64 s |
| | **Phase 5d** | **68** (68, 68, 68) | **100** | 1.07 s | 2.13 s | 4.56 s | 0 | 3.31 s | 8.45 s |
| Share `/s/…` | main | 67 (67, 66, 67) | 100 | 0.92 s | 2.07 s | 3.94 s | 0 | 4.46 s | 10.51 s |
| | **Phase 5d** | **67** (68, 67, 66) | **100** | 0.91 s | 2.08 s | 3.83 s | 0 | 4.26 s | 10.33 s |
| Follow `/follow?share=…` | **Phase 5d** (new) | **61** (49, 61, 64) | **100** | 0.92 s | 3.29 s | 3.08 s | 0 | 4.00 s | 8.73 s |

- **Accessibility is 100 on all three pages** (gate: 95), with no failing audit.
- **The planner is one point lower and its first paint 0.15 s later.** Its HTML and CSS grew slightly (the head script of Phase 5e and the Follow, Open-in and restore rules). All its first-load JavaScript is within the 5 KB budget: 187.25 KB gzip against 182.91 KB at the Phase 5b-fix baseline.
- **The share page is unchanged.**

## A regression found and fixed

The first measurement had the planner at **55** (55, 55, 67), its LCP at 4.18 s against 1.92 s on `main`.

The largest paint was the same element in both builds, the setup's "Where do you start?". On this branch it was painted about 350 ms after the first paint, because the restore code of step 7b remounted the setup after hydration on every load, even when nothing was restored. The heading the server sent was thrown away and drawn again, so Lighthouse counted every script loaded by then, MapLibre included, as part of the largest paint.

The setup is now remounted only when a stored step or draft comes back. A browser test (`restore`, "a fresh tab keeps the server's step 1") marks the server's heading and fails if it is replaced: it failed on the old build and passes now. In the browser at 4× CPU slowdown, the first paint and the largest paint are now the same moment (244 to 260 ms, against 288 to 428 ms for the largest paint before the fix). The first measurement's reports are not kept; its figures are above.

## Follow

There is no earlier figure: the page is new. Its largest paint is the start screen's text, which waits for the route (one API read). Lighthouse counts what starts in the same moment, and the map code (293 KB) and the route's corridor of tiles (about 30 range reads) start with the route on purpose, so that nothing is fetched during a run (Phase 5d amendment 7). That is the 3.29 s, and the wide spread between runs.

**Option, not built:** showing the start screen's fixed text before the route arrives (the lock line and why the location is asked for) would make that text the largest paint at about the first paint. The name, the distance and the Follow button would still wait for the route.

## First-load JavaScript

Gzip, from the production build, every script tag of the page:

| Page | main (Phase 5b-fix baseline) | Phase 5d |
|---|--:|--:|
| `/` | 182.91 KB | 187.25 KB |
| `/routes` | 151.86 KB | 157.03 KB |
| `/s/[slug]` | not measured | 176.63 KB |
| `/follow` | (new) | 171.95 KB |

The Follow code (screen, logic, voice) is in `/follow` only, and "Open in..." loads when its sheet opens.
