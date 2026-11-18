# Phase 5b baseline: the Phase 5 UI before the redesign

Measured on 2026-11-18 on the development laptop (Windows 11, i5 10th gen, 16 GB), not on a target server. The code is the last Phase 5 UI (commit `447c61f`; `web/src` unchanged since `d5f8ede`).

## How it was measured

The `next start` server that was already running is the LAN build (`NEXT_PUBLIC_API_BASE=same-origin`, built 12:49 for the phone check). It talks to the API only through Caddy, so everything here is measured **through Caddy on the LAN address**, `https://10.141.255.68` (`tls internal`). That is the origin the phone uses. The "after" numbers will be measured the same way.

- Stack: the containerised API, Valhalla, GraphHopper, Photon, Postgres and Redis, all running (docker compose, profiles `api`, `web`, `geocode`).
- Screenshots: `npx playwright test --project=screens` with `E2E_BASE=E2E_API=https://10.141.255.68`, `E2E_INSECURE=1` and `SHOTS_DIR=../docs/reports/phase5b/before/screenshots`. Both tests (phone and desktop) passed, in 3.3 min.
- Lighthouse 13.0.1, default mobile profile (simulated throttling: Moto G Power, 4× CPU slowdown, slow 4G), Playwright's Chromium 1255, headless, `--ignore-certificate-errors` (Caddy's local CA). Three runs per page; the table gives the median.

## Lighthouse (median of 3)

| Page | Performance | Accessibility | Best practices | SEO | FCP | LCP | TBT | CLS | Speed index | Main-thread work |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Planner `/` | **68** | **100** | 100 | 100 | 0.91 s | 2.02 s | 3.76 s | 0 | 3.82 s | 6.59 s |
| Share page `/s/qwI4HRq1jxzS` | **67** | **100** | 100 | 100 | 0.91 s | 2.03 s | 4.75 s | 0 | 4.27 s | 8.57 s |

Each run:

| Run | Planner perf / LCP / TBT | Share perf / LCP / TBT |
| --- | --- | --- |
| 1 | 68 / 2.05 s / 3.87 s | 67 / 2.03 s / 4.87 s |
| 2 | 68 / 2.02 s / 3.76 s | 56 / 3.80 s / 4.75 s |
| 3 | 68 / 1.96 s / 3.72 s | 67 / 2.02 s / 4.67 s |

Share run 2's LCP (3.8 s) is an outlier; its other numbers match runs 1 and 3. Reports: [lighthouse/](lighthouse/).

**Compared with Phase 5's 63:** that was one run against `http://localhost:3000` with the default API base, not through Caddy. The methods differ, so the two numbers are not comparable. The Phase 5b before-and-after comparison uses only the numbers above.

As in Phase 5, almost all the blocking time is MapLibre on the main thread (parsing the library, creating the WebGL context, building the style). The share page also draws its route and pins.

**Start pin cost:** not applicable before. The Phase 5 start pin is a plain HTML marker with no animation. After the redesign, the hopping sneaker's main-thread time is measured separately (Performance trace with and without the pin) and included in the Lighthouse runs.

## Screenshots

[screenshots/](screenshots/): 34 images, the 17 screens at 390 × 844 (`phone-*`) and 1440 × 900 (`desktop-*`), the same list as Phase 5's summary. Screens 14 to 17 (loading, 429 busy, engines down, 504 timeout) are mocked: the test intercepts the API's answer.

## Rerun

```
cd web
$env:E2E_BASE="https://10.141.255.68"; $env:E2E_API="https://10.141.255.68"; $env:E2E_INSECURE="1"
$env:SHOTS_DIR="../docs/reports/phase5b/before/screenshots"; npx playwright test --project=screens
$env:CHROME_PATH="$env:LOCALAPPDATA\ms-playwright\chromium-1255\chrome-win64\chrome.exe"
npx lighthouse@13.0.1 https://10.141.255.68/ --chrome-flags="--headless=new --ignore-certificate-errors" --output=json --output=html --output-path=<file>
```
