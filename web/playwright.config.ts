/**
 * End-to-end tests against the live stack (Phase 5 acceptance): the web app on E2E_BASE (default
 * http://localhost:3000, `npm run build && npm start`), the containerised API on :8000 with every engine, Photon
 * and the OSM features loaded. Raise the API's session limit first (each test is a new browser, so a new client):
 *
 *   ATHLETE_RATE_SESSION_PER_IP_HOUR=1000 docker compose --profile api up -d api
 *   npx playwright test                 (journeys, phone viewport)
 *   npx playwright test --project=screens   (screenshots for docs/reports/phase5/screenshots/)
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
  use: { baseURL: base, trace: "retain-on-failure", screenshot: "only-on-failure", acceptDownloads: true },
  projects: [
    { name: "phone", testMatch: /journeys\.spec\.ts/, use: { ...devices["Pixel 7"], browserName: "chromium" } },
    { name: "screens", testMatch: /screens\.spec\.ts/, use: { browserName: "chromium" } },
  ],
});
