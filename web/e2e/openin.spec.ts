/**
 * "Open in..." on a phone (blueprint Phase 5b amendment 20): the Google Maps link, the share fallback, the download.
 * Google is intercepted, so no coordinates leave this machine; whether Google draws the route is not tested here.
 */
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { planA01Base } from "./helpers";

async function openSheet(page: Page) {
  await page.getByTestId("open-in").first().click();
  await expect(page.getByTestId("open-google")).toBeVisible();
  await expect(page.getByTestId("open-share")).toBeEnabled();
}

test("the result and a saved route: Google Maps, share falling back to a download, download", async ({ page, context }) => {
  await context.route(/^https:\/\/(www\.)?google\.com\//, (route) => route.fulfill({ contentType: "text/html", body: "<p>intercepted</p>" }));
  await page.addInitScript(() => {
    // what Chromium does with a .gpx: canShare says yes, share refuses
    Object.defineProperty(navigator, "canShare", { configurable: true, value: () => true });
    Object.defineProperty(navigator, "share", { configurable: true, value: () => Promise.reject(new DOMException("Permission denied", "NotAllowedError")) });
  });
  await planA01Base(page);
  const marks = page.waitForResponse((r) => r.url().endsWith("/elevation") && r.ok());
  await openSheet(page);
  const elevation = await (await marks).json();
  await page.screenshot({ path: test.info().outputPath("open-in.png") });

  const href = (await page.getByTestId("open-google").getAttribute("href"))!;
  const query = new URL(href).searchParams;
  const text = (p: [number, number]) => `${p[1].toFixed(6)},${p[0].toFixed(6)}`;
  expect(query.get("origin")).toBe(text(elevation.points[0]));
  expect(query.get("destination")).toBe(text(elevation.points.at(-1)));
  const via = query.get("waypoints")!.split("|");
  expect(via).toHaveLength(3);                       // a mobile browser
  const given = elevation.km_marks.map((m: { lon: number; lat: number }) => text([m.lon, m.lat]));
  for (const point of via) expect(given).toContain(point);

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
  await page.getByTestId("open-in-sheet").getByRole("button", { name: "Done" }).click();

  await page.getByTestId("route-name").fill("Open in test");
  await page.getByTestId("save").click();
  await expect(page.getByTestId("share-link")).toBeVisible();
  await page.goto("/routes");
  await openSheet(page);
  expect(await page.getByTestId("open-google").getAttribute("href")).toBe(href);
});
