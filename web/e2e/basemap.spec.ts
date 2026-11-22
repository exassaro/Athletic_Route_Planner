/**
 * The saved-route map on an iPhone 16 viewport (blueprint Phase 5b amendment 12), in Chromium, whose cache had the
 * bug. Two normal loads passed even before the fix, so the cache's trigger is tested too: overlapping Range requests,
 * some aborted, every body compared with the file. Needs the live stack, like the journeys.
 */
import { createHash } from "node:crypto";
import { closeSync, openSync, readFileSync, readSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

const API = process.env.E2E_API ?? "http://localhost:8000";
const WEB = fileURLToPath(new URL("..", import.meta.url));
const PMTILES = "**/basemap/kerala.pmtiles";
let sharePath = "";

test.beforeAll(async ({ playwright }) => {
  test.setTimeout(120_000);
  const api = await playwright.request.newContext({ ignoreHTTPSErrors: process.env.E2E_INSECURE === "1" });
  const session = await api.post(`${API}/v1/session`);
  expect(session.ok(), await session.text()).toBe(true);
  const headers = { "X-Client-Token": (await session.json()).token };
  const example = JSON.parse(readFileSync(join(WEB, "..", "api", "athlete_api", "examples", "request_A01.json"), "utf8"));
  const plan = await api.post(`${API}/v1/plans`, { headers, data: example.value, timeout: 60_000 });
  expect(plan.ok(), await plan.text()).toBe(true);
  const routeId = (await plan.json()).candidates[0].route_id;
  const saved = await api.post(`${API}/v1/routes/${routeId}/save`, { headers, data: { name: "Basemap test" } });
  expect(saved.ok(), await saved.text()).toBe(true);
  sharePath = `/s/${(await saved.json()).share_slug}`;
  await api.dispose();
});

function consoleErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  return errors;
}

/** Waits until the basemap's own features are on screen, and the canvas fills its box. */
async function expectBasemap(page: Page) {
  await page.waitForFunction(() => {
    const map = (window as unknown as { athleteMap?: import("maplibre-gl").Map }).athleteMap;
    return !!map?.isStyleLoaded() && map.queryRenderedFeatures().some((f) => f.source === "protomaps");
  }, null, { timeout: 30_000 });
  const [box, canvas] = await page.evaluate(() => [".map-box", ".map-box canvas"].map((s) => {
    const el = document.querySelector(s)!;
    return [el.clientWidth, el.clientHeight];
  }));
  expect(box![1]).toBeGreaterThan(100);
  expect(canvas).toEqual(box);
}

test("a saved route draws its basemap cold, then warm", async ({ page }) => {
  const errors = consoleErrors(page);
  await page.addInitScript(() => {
    const original = window.fetch;
    const modes: string[] = [];
    Object.assign(window, { pmtilesModes: modes });
    window.fetch = (input, init) => {
      if (String(input).includes(".pmtiles")) modes.push(init?.cache ?? "default");
      return original(input, init);
    };
  });
  for (const load of ["cold", "warm"]) {
    if (load === "cold") await page.goto(sharePath);
    else await page.reload();
    await expectBasemap(page);
    await expect(page.getByTestId("map-failed")).toHaveCount(0);
    expect(errors.filter((e) => /magic number/i.test(e)), load).toEqual([]);
    const modes = await page.evaluate(() => (window as unknown as { pmtilesModes: string[] }).pmtilesModes);
    expect(new Set(modes), load).toEqual(new Set(["no-store"]));
  }
});

test("overlapping, aborted Range requests never get wrong bytes", async ({ page, baseURL }) => {
  test.skip(!!baseURL?.startsWith("https") && process.env.E2E_INSECURE === "1", "Chromium caches nothing over an untrusted certificate");
  const ranges = [[0, 16383], [1448, 10698], [249, 917], [30000, 70000], [9000, 60000], [3144000, 3150000]] as const;
  const file = openSync(join(WEB, "public", "basemap", "kerala.pmtiles"), "r");
  const expected = new Map(ranges.map(([from, to]) => {
    const bytes = Buffer.alloc(to - from + 1);
    readSync(file, bytes, 0, bytes.length, from);
    return [`${from}-${to}`, createHash("sha256").update(bytes).digest("hex")];
  }));
  closeSync(file);
  await page.goto("/about");
  let checked = 0;
  const wrong: string[] = [];
  for (let round = 0; round < 120; round++) {
    if (round % 20 === 19) await page.reload();
    const got = await page.evaluate(async ({ ranges, round }) => Promise.all(ranges.map(async ([from, to], i) => {
      const abort = new AbortController();
      if ((round + i) % 3 === 0) setTimeout(() => abort.abort(), 1 + (round % 11));
      try {
        // the default cache mode on purpose: this is the server header's half of the fix
        const response = await fetch("/basemap/kerala.pmtiles", { headers: { range: `bytes=${from}-${to}` }, signal: abort.signal });
        const digest = await crypto.subtle.digest("SHA-256", await response.arrayBuffer());
        return { range: `${from}-${to}`, sha: [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("") };
      } catch {
        return null; // aborted
      }
    })), { ranges, round });
    for (const g of got) {
      if (!g) continue;
      checked++;
      if (g.sha !== expected.get(g.range)) wrong.push(g.range);
    }
  }
  expect(wrong).toEqual([]);
  expect(checked).toBeGreaterThan(200);
});

test("one failure is retried without a message", async ({ page }) => {
  let calls = 0;
  await page.route(PMTILES, (route) => (++calls === 1 ? route.fulfill({ status: 500 }) : route.continue()));
  await page.goto(sharePath);
  await expectBasemap(page);
  await expect(page.getByTestId("map-failed")).toHaveCount(0);
});

test("tiles that keep failing show Reload map and keep the OSM credit", async ({ page }) => {
  await page.route(PMTILES, (route) => route.fulfill({ status: 500 }));
  await page.goto(sharePath);
  await expect(page.getByTestId("map-failed")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".maplibregl-ctrl-attrib")).toContainText("OpenStreetMap contributors");
  const button = await page.getByTestId("map-reload").boundingBox();
  expect(button!.height).toBeGreaterThanOrEqual(44);
  await page.unroute(PMTILES);
  await page.getByTestId("map-reload").click();
  await expectBasemap(page);
  await expect(page.getByTestId("map-failed")).toHaveCount(0);
});
