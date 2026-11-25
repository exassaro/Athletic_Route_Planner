/**
 * End-to-end tests against the live stack (Phase 5 acceptance): the web app on E2E_BASE (default
 * http://localhost:3000, `npm run build && npm start`), the containerised API on :8000 with every engine, Photon
 * and the OSM features loaded. Raise the API's session limit first (each test is a new browser, so a new client):
 *
 *   ATHLETE_RATE_SESSION_PER_IP_HOUR=1000 docker compose --profile api up -d api
 *   npx playwright test --project=phone     (journeys, phone viewport; without --project every project runs)
 *   npx playwright test --project=basemap   (saved route on an iPhone 16 viewport: cold, warm, failing tiles)
 *   npx playwright test --project=screens   (screenshots; set SHOTS_DIR, or the committed ones are overwritten)
 *   npx playwright test --project=unreachable   (the API out of reach: needs no API, writes nothing)
 *   E2E_BASE=https://<LAN IP> E2E_API=https://<LAN IP> E2E_INSECURE=1 npx playwright test --project=phone
 *     (through Caddy on the LAN address, web built with NEXT_PUBLIC_API_BASE=same-origin)
 */
import { defineConfig, devices } from "@playwright/test";

const base = process.env.E2E_BASE ?? "http://localhost:3000";

export default defineConfig({
  testDir: "e2e",
  timeout: 240_000,
  expect: { timeout: 60_000 },
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  outputDir: "test-results",
  use: { baseURL: base, trace: "retain-on-failure", screenshot: "only-on-failure", acceptDownloads: true,
    // E2E_INSECURE=1: through Caddy's local CA (https://<LAN IP>), which this Chromium does not trust
    ignoreHTTPSErrors: process.env.E2E_INSECURE === "1" },
  projects: [
    // Step 9: two browsers, A saves and shows a link, B claims it (live stack; the API must have migration 0006)
    { name: "link", testMatch: /link[.]spec[.]ts/, use: { ...devices["Pixel 7"], browserName: "chromium" } },
    // Step 9 item 8: no request leaves GATHO's own origins (live stack)
    { name: "privacy", testMatch: /thirdparty[.]spec[.]ts/, use: { ...devices["Pixel 7"], browserName: "chromium" } },
    { name: "phone", testMatch: /(journeys|sr01)\.spec\.ts/, use: { ...devices["Pixel 7"], browserName: "chromium" } },
    { name: "screens", testMatch: /screens\.spec\.ts/, use: { browserName: "chromium" } },
    { name: "basemap", testMatch: /basemap\.spec\.ts/, use: { ...devices["iPhone 16"], browserName: "chromium" } },
    { name: "layout", testMatch: /layout[.]spec[.]ts/, use: { ...devices["Pixel 7"], browserName: "chromium" } },
    { name: "pin", testMatch: /pin[.]spec[.]ts/, use: { ...devices["Pixel 7"], browserName: "chromium" } },
    { name: "direction", testMatch: /direction[.]spec[.]ts/, use: { ...devices["Pixel 7"], browserName: "chromium" } },
    { name: "openin", testMatch: /openin[.]spec[.]ts/, use: { ...devices["Pixel 7"], browserName: "chromium" } },
    { name: "share", testMatch: /share[.]spec[.]ts/, use: { ...devices["Pixel 7"], browserName: "chromium" } },
    { name: "brand", testMatch: /brand[.]spec[.]ts/, use: { ...devices["Pixel 7"], browserName: "chromium" } },
    { name: "editing", testMatch: /editing[.]spec[.]ts/, use: { ...devices["Pixel 7"], browserName: "chromium" } },
    { name: "saved", testMatch: /saved[.]spec[.]ts/, use: { ...devices["Pixel 7"], browserName: "chromium" } },
    { name: "owner", testMatch: /owner[.]spec[.]ts/, use: { ...devices["Pixel 7"], browserName: "chromium" } },
    { name: "errors", testMatch: /savedErrors[.]spec[.]ts/, use: { ...devices["Pixel 7"], browserName: "chromium" } },
    { name: "screens5c", testMatch: /savedScreens[.]spec[.]ts/, use: { browserName: "chromium" } },
    { name: "unreachable", testMatch: /unreachable[.]spec[.]ts/, use: { ...devices["Pixel 7"], browserName: "chromium" } },
    { name: "follow", testMatch: /follow[.]spec[.]ts/, use: { ...devices["Pixel 7"], browserName: "chromium" } },
    { name: "restore", testMatch: /restore[.]spec[.]ts/, use: { ...devices["Pixel 7"], browserName: "chromium" } },
    { name: "pincost", testMatch: /pincost\.spec\.ts/, use: { ...devices["Pixel 7"], browserName: "chromium" } },
  ],
});
