/**
 * The Phase 5 acceptance journeys on a phone viewport, against the live stack: A01 (with over_budget, a fix,
 * undo, save, share, GPX and the share page logged out), the S02 loop and the G01 conflict.
 */
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { A01_STOPS, addA01Stops, addStop, checkNumbers, checkNumbersEverySnap, PLACES, pickPlace, planA01Base, recordApi, setDistance,
  setupRun, waitVersion } from "./helpers";

test("A01: 25 km towards Kozhikode through six stops, then 20 km, a fix, undo, save, share, GPX", async ({ page, browser }) => {
  const api = recordApi(page);
  await planA01Base(page);
  await addA01Stops(page);

  // 25.0 km and the stops in order
  await expect(page.getByTestId("summary")).toContainText("25.0 km");
  await expect(page.getByTestId("card-recommended-main").locator("[data-field=foot_m]").first()).toHaveText("25.0 km");
  const order = await page.locator("[data-testid=stop-list] li[data-stop]").evaluateAll((els) => els.map((e) => e.getAttribute("data-stop")));
  expect(order).toEqual(A01_STOPS);
  // the timeline: every stop with its distance mark, in the order the route meets them
  const marks = await page.locator("[data-testid=stop-list] li[data-stop] [data-field='stops.at_m']")
    .evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-value"))));
  expect(marks).toHaveLength(A01_STOPS.length);
  expect([...marks].sort((a, b) => a - b)).toEqual(marks);
  await expect(page.getByTestId("elevation-chart")).toBeVisible();
  await checkNumbersEverySnap(page, api);

  // 20 km: over budget, with the full route, the cut and the savings
  await setDistance(page, 20);
  await waitVersion(page, 8);
  const outcome = page.getByTestId("outcome");
  await expect(outcome).toHaveAttribute("data-outcome", "over_budget");
  await expect(outcome).toContainText("doesn't shorten the run");
  await expect(page.getByTestId("card-recommended-full_route")).toBeVisible();
  await expect(page.getByTestId("card-recommended-cut_at_target")).toBeVisible();
  await checkNumbersEverySnap(page, api);

  // a one-tap fix: the distance the stops need
  const fix = page.getByTestId("fix-set_distance");
  const needed = Number(await fix.locator("[data-value]").getAttribute("data-value"));
  await fix.click();
  await waitVersion(page, 9);
  await expect(page.locator('[data-chip="distance"] [data-value]')).toHaveAttribute("data-value", String(needed));
  await expect(page.getByTestId("diff-toast")).toBeVisible();
  await checkNumbersEverySnap(page, api);

  // undo: back to the 20 km request, over budget again
  await page.getByRole("button", { name: "Undo" }).click();
  await waitVersion(page, 10);
  await expect(page.locator('[data-chip="distance"] [data-value]')).toHaveAttribute("data-value", "20000");
  await expect(page.getByTestId("outcome")).toHaveAttribute("data-outcome", "over_budget");

  // save, share link, GPX
  await page.getByTestId("card-recommended-cut_at_target").getByRole("button").first().click();
  await page.getByTestId("route-name").fill("Coast run, 20 km");
  await page.getByTestId("save").click();
  const link = await page.getByTestId("share-link").getAttribute("href");
  expect(link).toMatch(/\/s\/[\w-]+$/);
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("gpx").click()]);
  const gpx = readFileSync(await download.path(), "utf8");
  expect(gpx).toContain('<gpx ');
  expect(gpx).toContain("<trkpt");
  expect(gpx).toContain("<ele>");

  // the share page, logged out (a new browser context: no token)
  const ctx = await browser.newContext({ ignoreHTTPSErrors: process.env.E2E_INSECURE === "1" });
  const share = await ctx.newPage();
  const shareApi = recordApi(share);
  const resp = await share.goto(link!);
  expect(resp?.status()).toBe(200);
  await expect(share.locator("h1")).toHaveText("Coast run, 20 km");
  await expect(share.getByTestId("share-summary")).toBeVisible();
  const shared = await (await share.request.get(`${process.env.E2E_API ?? "http://localhost:8000"}/v1/share/${link!.split("/s/")[1]}`)).json();
  shareApi.push(shared);
  await checkNumbers(share, shareApi);
  const gpxResp = await share.request.get(await share.getByTestId("share-gpx").getAttribute("href") as string);
  expect(gpxResp.status()).toBe(200);
  expect(await gpxResp.text()).toContain("<trk>");
  await ctx.close();
});

test("S02: a 10 km loop from Mananchira", async ({ page }) => {
  const api = recordApi(page);
  await setupRun(page, { start: PLACES.mananchira, km: 10, shape: "Loop" });
  await waitVersion(page, 1);
  await expect(page.getByTestId("card-loop_1-main")).toBeVisible();
  await expect(page.getByTestId("card-loop_2-main")).toBeVisible();
  await expect(page.getByTestId("summary")).toContainText("km");
  await checkNumbersEverySnap(page, api);
});

test("G01: a loop that cannot reach Feroke says why, keeps the map, and offers fixes", async ({ page }) => {
  const api = recordApi(page);
  await setupRun(page, { start: PLACES.kozhikode, km: 10, shape: "Loop" });
  await waitVersion(page, 1);
  await addStop(page, PLACES.feroke);
  await waitVersion(page, 2);
  await page.locator('[data-stop="Feroke"]').getByRole("button", { name: /^Options for/ }).click();
  await page.getByTestId("stop-options").getByRole("button", { name: /Must reach instead|Pass near instead/ }).click();
  await waitVersion(page, 3);
  const outcome = page.getByTestId("outcome");
  await expect(outcome).toHaveAttribute("data-conflict", "loop_stop_too_far");
  await expect(page.getByTestId("conflict-message")).toContainText("Feroke");
  expect(await page.locator(".pin").count()).toBeGreaterThanOrEqual(2);        // never a blank map
  await expect(page.getByTestId("fix-drop_checkpoint-Feroke")).toBeVisible();
  await checkNumbersEverySnap(page, api);
  // The fix sets the solver's estimate (there and back on foot). Measured 2026-11-18: the loop through Feroke
  // then needs 26.2 km, so the answer is over_budget with a full route and a cut, not the conflict again.
  await page.getByTestId("fix-set_distance").click();
  await waitVersion(page, 4);
  await expect(page.locator("[data-conflict=loop_stop_too_far]")).toHaveCount(0);
  await expect(page.locator(".route-card").first()).toBeVisible();
  await checkNumbersEverySnap(page, api);
});
