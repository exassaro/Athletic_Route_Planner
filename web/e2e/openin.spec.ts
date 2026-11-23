/**
 * "Open in..." (blueprint Phase 5d amendments 1 to 3): the GPX first, Google Maps as an overview with the API's
 * points, its fallback, and the steps for My Maps. Google is intercepted, so no coordinates leave this machine;
 * whether Google draws the route is not tested here.
 */
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { checkNumbers, planA01Base, recordApi, strayNumbers } from "./helpers";

const text = (p: readonly number[]) => `${p[1]!.toFixed(6)},${p[0]!.toFixed(6)}`;
const shownOverlap = (pct: number) => (pct > 95 ? "over 95%" : `${Math.floor(pct)}%`);
const NOTE = "Google may re-route between points, so the path and distance can differ. Our route: ";

async function openSheet(page: Page) {
  await page.getByTestId("open-in").first().click();
  await expect(page.getByTestId("open-google")).toBeVisible();
  await expect(page.getByTestId("open-share")).toBeEnabled();
}

const googleHref = async (page: Page) => (await page.getByTestId("open-google").getAttribute("href"))!;
const closeSheet = (page: Page) => page.getByTestId("open-in-sheet").getByRole("button", { name: "Done" }).click();
const overviewAnswer = (page: Page) => page.waitForResponse((r) => r.url().includes("/overview-points") && r.ok());

/** Every control in the sheet is at least 44 px tall and nothing runs off the side. */
async function checkLayout(page: Page) {
  const sheet = page.getByTestId("open-in-sheet");
  const small = await sheet.locator("button, a.btn, summary").evaluateAll((els) => els
    .filter((e) => e.getClientRects().length && e.getBoundingClientRect().height < 44).map((e) => e.textContent));
  expect(small, "under 44 px").toEqual([]);
  expect(await sheet.evaluate((d) => d.scrollWidth - d.clientWidth), "runs off the side").toBeLessThanOrEqual(0);
}

test.beforeEach(async ({ context }) => {
  await context.route(/^https:\/\/(www\.)?google\.com\//, (route) => route.fulfill({ contentType: "text/html", body: "<p>intercepted</p>" }));
});

test("the result, a saved route and its share page: the GPX, and Google Maps with the API's three points", async ({ page, context }) => {
  await page.addInitScript(() => {
    // what Chromium does with a .gpx: canShare says yes, share refuses
    Object.defineProperty(navigator, "canShare", { configurable: true, value: () => true });
    Object.defineProperty(navigator, "share", { configurable: true, value: () => Promise.reject(new DOMException("Permission denied", "NotAllowedError")) });
  });
  const bodies = recordApi(page);
  await planA01Base(page);
  const marks = page.waitForResponse((r) => r.url().endsWith("/elevation") && r.ok());
  const overview = overviewAnswer(page);
  await openSheet(page);
  const elevation = await (await marks).json();
  const answer = await overview;
  expect(new URL(answer.url()).searchParams.get("max"), "a mobile browser").toBe("3");
  const { points, overlap_pct: overlap } = await answer.json();
  await expect(page.getByTestId("open-google")).toHaveAttribute("data-points", "smart");

  const href = await googleHref(page);
  const query = new URL(href).searchParams;
  expect(query.get("travelmode")).toBe("walking");
  expect(query.get("origin")).toBe(text(elevation.points[0]));
  expect(query.get("destination")).toBe(text(elevation.points.at(-1)));
  expect(points.length).toBeLessThanOrEqual(3);
  expect(query.get("waypoints")!.split("|")).toEqual(points.map((p: { lon: number; lat: number }) => text([p.lon, p.lat])));

  const note = page.getByTestId("open-google-note");
  await expect(note).toContainText(NOTE);
  await expect(note).toContainText(`Estimated overlap: ${shownOverlap(overlap)} (tested with our router, not Google).`);
  await expect(page.locator(".open-in button").first()).toHaveText("Get GPX (exact route)");
  await expect(page.getByTestId("open-in-sheet").locator(".btn-primary")).toHaveCount(1);
  await expect(page.getByTestId("open-mymaps")).not.toHaveAttribute("open");
  expect(await checkNumbers(page, bodies)).toBeGreaterThan(1);
  expect(await strayNumbers(page)).toEqual([]);
  await checkLayout(page);

  await page.screenshot({ path: test.info().outputPath("sheet-light.png") });
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  await page.screenshot({ path: test.info().outputPath("sheet-dark.png") });
  await page.evaluate(() => { document.documentElement.dataset.theme = "light"; });

  const [tab] = await Promise.all([context.waitForEvent("page"), page.getByTestId("open-google").click()]);
  await tab.waitForLoadState();
  expect(tab.url()).toBe(href);
  await tab.close();

  for (const button of ["open-share", "open-download"]) {
    const [file] = await Promise.all([page.waitForEvent("download"), page.getByTestId(button).click()]);
    expect(file.suggestedFilename()).toMatch(/\.gpx$/);
    expect(readFileSync(await file.path(), "utf8"), button).toContain("<trkpt");
  }
  await expect(page.getByTestId("open-message")).toContainText("downloaded instead");
  await expect(page.getByTestId("open-message")).toContainText("open or share it with Organic Maps or OsmAnd");
  await page.getByTestId("open-message").scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath("sheet-downloaded.png") });

  await page.getByTestId("open-mymaps").locator("summary").click();
  await expect(page.getByTestId("open-mymaps")).toContainText("This needs a computer");
  await expect(page.getByTestId("open-mymaps-help")).toBeVisible();
  await checkLayout(page);
  await page.getByTestId("open-mymaps-help").scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath("sheet-mymaps.png") });
  await closeSheet(page);

  await page.getByTestId("route-name").fill("Open in test");
  await page.getByTestId("save").click();
  await expect(page.getByTestId("share-link")).toBeVisible();
  const share = (await page.getByTestId("share-link").getAttribute("href"))!;
  const facesWest = await page.locator(".pin-start-flip.west").count();
  await page.goto("/routes");
  await page.getByRole("button", { name: /^More for/ }).click();      // Phase 5c: in the card's menu
  await page.getByRole("menuitem", { name: /^Open in/ }).click();
  await expect(page.getByTestId("open-google")).toHaveAttribute("data-points", "smart");
  expect(await googleHref(page)).toBe(href);
  await expect(page.getByTestId("open-google-note")).toContainText("Estimated overlap");
  await page.screenshot({ path: test.info().outputPath("sheet-saved.png") });

  // the share page has the same points, so the same link, and the pin faces the same way
  await page.goto(share);
  await expect(page.locator(".pin-start")).toHaveCount(1);
  expect(await page.locator(".pin-start-flip.west").count(), "faces as in the planner").toBe(facesWest);
  const visitor = page.waitForRequest((r) => /\/v1\/share\/.+\/overview-points/.test(r.url()));
  await openSheet(page);
  expect((await visitor).headers()["x-client-token"], "public: no token").toBeUndefined();
  await expect(page.getByTestId("open-google")).toHaveAttribute("data-points", "smart");
  const shared = new URL(await googleHref(page)).searchParams;
  expect(shared.get("waypoints")).toBe(query.get("waypoints"));
  for (const key of ["origin", "destination"]) {
    const [a, b] = [shared.get(key)!, query.get(key)!].map((v) => v.split(",").map(Number));
    a!.forEach((n, i) => expect(n, key).toBeCloseTo(b![i]!, 5));
  }
  await expect(page.getByTestId("open-google-note")).toContainText(`Estimated overlap: ${shownOverlap(overlap)}`);
  await page.screenshot({ path: test.info().outputPath("sheet-share.png") });
  const [file] = await Promise.all([page.waitForEvent("download"), page.getByTestId("open-download").click()]);
  expect(readFileSync(await file.path(), "utf8")).toContain("<trkpt");
});

test("without overview points: evenly spaced points, no estimate, no error", async ({ page }) => {
  await page.route(/\/overview-points/, (route) => route.fulfill({ status: 503, contentType: "application/json",
    body: JSON.stringify({ error: "engine_unavailable", message: "Valhalla is not answering.", detail: null }) }));
  await planA01Base(page);
  const marks = page.waitForResponse((r) => r.url().endsWith("/elevation") && r.ok());
  const failed = page.waitForResponse((r) => r.url().includes("/overview-points"));
  await openSheet(page);
  expect((await failed).status()).toBe(503);
  const given = (await (await marks).json()).km_marks.map((m: { lon: number; lat: number }) => text([m.lon, m.lat]));
  await expect(page.getByTestId("open-google")).toHaveAttribute("data-points", "even");
  const via = new URL(await googleHref(page)).searchParams.get("waypoints")!.split("|");
  expect(via).toHaveLength(3);
  for (const point of via) expect(given).toContain(point);
  await expect(page.getByTestId("open-google-note")).toContainText(NOTE);
  await expect(page.getByTestId("open-google-note")).not.toContainText("overlap");
  await expect(page.getByTestId("open-in-sheet").getByRole("alert")).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("sheet-fallback.png") });
});

test("a tap never waits for the overview points", async ({ page, context }) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route(/\/overview-points/, async (route) => {
    await held;
    await route.continue();
  });
  await planA01Base(page);
  await openSheet(page);
  await expect(page.getByTestId("open-google")).toHaveAttribute("data-points", "even");
  const before = await googleHref(page);
  const [tab] = await Promise.all([context.waitForEvent("page"), page.getByTestId("open-google").click()]);
  await tab.waitForLoadState();
  expect(tab.url()).toBe(before);
  await tab.close();
  release();
  await expect(page.getByTestId("open-google")).toHaveAttribute("data-points", "smart");
  expect(await googleHref(page)).not.toBe(before);
});

test("the sheet's contents failing to load leaves the planner working", async ({ page }) => {
  await planA01Base(page);
  await page.route(/\/_next\/static\/chunks\//, (route) => route.abort("internetdisconnected"));
  await page.getByTestId("open-in").first().click();
  const sheet = page.getByTestId("open-in-sheet");
  await expect(sheet.getByRole("alert")).toContainText("didn't load");
  await closeSheet(page);
  await expect(sheet).not.toBeVisible();
  await expect(page.getByTestId("route-name")).toBeVisible();
});

test.describe("on a computer", () => {
  test.use({ viewport: { width: 1366, height: 800 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1,
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36" });

  test("up to nine points", async ({ page }) => {
    await planA01Base(page);
    const overview = overviewAnswer(page);
    await openSheet(page);
    const answer = await overview;
    expect(new URL(answer.url()).searchParams.get("max")).toBe("9");
    const { points } = await answer.json();
    expect(points.length).toBeLessThanOrEqual(9);
    await expect(page.getByTestId("open-google")).toHaveAttribute("data-points", "smart");
    const href = await googleHref(page);
    expect(new URL(href).searchParams.get("waypoints")?.split("|") ?? []).toHaveLength(points.length);
    expect(href.length).toBeLessThan(2048);
    await checkLayout(page);
    await page.screenshot({ path: test.info().outputPath("sheet-desktop.png") });
  });
});
