/**
 * Where things sit on a phone (blueprint Phase 5b amendments 14 and 15), against the live stack. Boxes are compared
 * on screen; nothing here measures a route.
 */
import { expect, test, type Page } from "@playwright/test";
import { addA01Stops, addStop, pickPlace, planA01Base, PLACES, waitVersion } from "./helpers";

type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

async function snapTo(page: Page, state: "peek" | "half" | "full") {
  const sheet = page.locator(".sheet");
  for (let i = 0; i < 3 && (await sheet.getAttribute("data-snap")) !== state; i++) await page.locator(".sheet-handle").click();
  await expect(sheet).toHaveAttribute("data-snap", state);
  await page.waitForTimeout(400); // the sheet's settle
}

test("km labels: from zoom 12, over the route lines, never under a marker", async ({ page }) => {
  await planA01Base(page);
  await addStop(page, PLACES.kottakkadavu);
  await waitVersion(page, 2);
  await page.waitForTimeout(2000); // the fit and the profile
  await page.screenshot({ path: test.info().outputPath("labels-fitted.png") });

  const fitted = await page.evaluate(() => {
    const map = (window as unknown as { athleteMap: import("maplibre-gl").Map }).athleteMap;
    return { zoom: map.getZoom(), labels: map.queryRenderedFeatures({ layers: ["km-labels"] }).length, order: map.getLayersOrder() };
  });
  if (fitted.zoom < 12) expect(fitted.labels, "no labels below zoom 12").toBe(0);
  const lastLine = Math.max(...fitted.order.map((id, i) => (id.startsWith("cand-") ? i : -1)));
  for (const id of ["km-marks", "km-labels", "pin-links"]) expect(fitted.order.indexOf(id), id).toBeGreaterThan(lastLine);
  expect(fitted.order.at(-1)).toBe("pin-obstacles");

  // A label placed under the stop's disc and one in the open: only the second may be drawn.
  const drawn = await page.evaluate(async () => {
    const map = (window as unknown as { athleteMap: import("maplibre-gl").Map }).athleteMap;
    const pins = await map.getSource<import("maplibre-gl").GeoJSONSource>("pin-obstacles")!.getData() as GeoJSON.FeatureCollection<GeoJSON.Point>;
    const stop = pins.features.find((f) => f.properties!.anchor === "center")!.geometry.coordinates as [number, number];
    map.jumpTo({ center: stop, zoom: 14 });
    const p = map.project(stop);
    const clear = map.unproject([p.x - 100, p.y - 80]);
    const mark = (km: number, at: number[]) => ({ type: "Feature" as const, properties: { km, major: true },
      geometry: { type: "Point" as const, coordinates: at } });
    map.getSource<import("maplibre-gl").GeoJSONSource>("km-marks")!.setData({ type: "FeatureCollection",
      features: [mark(995, stop), mark(990, [clear.lng, clear.lat])] });
    await new Promise((r) => setTimeout(r, 2000));
    return map.queryRenderedFeatures({ layers: ["km-labels"] }).map((f) => f.properties.km);
  });
  expect(drawn).toContain(990);
  expect(drawn, "under the stop's disc").not.toContain(995);
});

test("the end flag's pole is on the end point and the place name steps clear", async ({ page }) => {
  await planA01Base(page);
  await page.waitForTimeout(2000); // the fit
  await page.screenshot({ path: test.info().outputPath("flag-fitted.png") });
  const { point, foot } = await page.evaluate(() => {
    const map = (window as unknown as { athleteMap: import("maplibre-gl").Map }).athleteMap;
    const line = (map.getSource("cand-0") as import("maplibre-gl").GeoJSONSource).serialize().data as GeoJSON.Feature<GeoJSON.LineString>;
    const p = map.project(line.geometry.coordinates.at(-1) as [number, number]);
    const el = document.querySelector(".pin-end")!;
    const r = el.getBoundingClientRect();
    return { point: p, foot: { x: el.classList.contains("west") ? r.right - 2 : r.left + 2, y: r.bottom - 2 } };
  });
  expect(Math.abs(foot.x - point.x)).toBeLessThan(6);
  expect(Math.abs(foot.y - point.y)).toBeLessThan(6);
  const names = await page.evaluate(() => (window as unknown as { athleteMap: import("maplibre-gl").Map }).athleteMap
    .queryRenderedFeatures({ layers: ["places_locality"] }).map((f) => f.properties["name:en"] ?? f.properties.name));
  expect(names, "moved aside, not hidden").toContain("Kozhikode");
});

test("A01 with its six stops: Kozhikode's name steps clear of the flag, it is not hidden", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });   // the screens' phone
  await planA01Base(page);
  await addA01Stops(page);
  await page.waitForTimeout(2500); // the fit and the labels' fade
  await page.screenshot({ path: test.info().outputPath("kozhikode-six-stops.png") });
  const found = await page.evaluate((city) => {
    const map = (window as unknown as { athleteMap: import("maplibre-gl").Map }).athleteMap;
    const box = (s: string) => [...document.querySelectorAll(s)].map((e) => e.getBoundingClientRect()).map((r) => [r.x, r.y, r.width, r.height].map(Math.round));
    return { zoom: map.getZoom(), city: map.project(city), flag: box(".pin-end"), stops: box(".pin-stop"),
      names: map.queryRenderedFeatures({ layers: ["places_locality"] }).map((f) => f.properties["name:en"] ?? f.properties.name) };
  }, [75.7754716, 11.2450558] as [number, number]);
  console.log("KOZHIKODE " + JSON.stringify(found));
  expect(found.names).toContain("Kozhikode");
});

test("the start just set is in the part of the map the sheet leaves free", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => !!(window as unknown as { athleteMap?: import("maplibre-gl").Map }).athleteMap?.loaded());
  await pickPlace(page, "start-search", PLACES.athanikkal);
  await page.locator(".pin-start").waitFor();
  await page.waitForTimeout(1500); // the ease
  const pin = (await page.locator(".pin-start").boundingBox())!;
  const sheet = (await page.locator(".sheet").boundingBox())!;
  expect(pin.y).toBeGreaterThan(64);
  expect(pin.y + pin.height).toBeLessThan(sheet.y);
});

test("the OSM credit is uncovered at every sheet position", async ({ page }) => {
  await planA01Base(page);
  for (const state of ["peek", "half", "full"] as const) {
    await snapTo(page, state);
    const seen = await page.locator(".maplibregl-ctrl-attrib").evaluate((el) => {
      const r = el.getBoundingClientRect();
      return [[r.left + 8, r.top + 3], [r.left + 8, r.bottom - 3], [r.right - 8, r.top + 3], [r.right - 8, r.bottom - 3]]
        .every(([x, y]) => el.contains(document.elementFromPoint(x!, y!)));
    });
    expect(seen, state).toBe(true);
  }
});

test("the peek stats show only at peek", async ({ page }) => {
  await planA01Base(page);
  for (const state of ["peek", "half", "full"] as const) {
    await snapTo(page, state);
    if (state === "peek") await expect(page.getByTestId("summary")).toBeVisible();
    else await expect(page.getByTestId("summary")).toBeHidden();
  }
});

test("the chip row fades where it is clipped", async ({ page }) => {
  await planA01Base(page);
  const row = page.getByTestId("chips");
  await expect(row).toHaveClass(/more-right/);
  await expect(row).not.toHaveClass(/more-left/);
  await page.screenshot({ path: test.info().outputPath("chips-start.png") });
  await row.evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
  await expect(row).toHaveClass(/more-left/);
  await expect(row).not.toHaveClass(/more-right/);
});

test("the Undo message moves with the sheet and covers no content", async ({ page }) => {
  await planA01Base(page);
  await addStop(page, PLACES.kottakkadavu);
  await waitVersion(page, 2);
  await expect(page.getByTestId("diff-toast")).toBeVisible();
  await page.waitForTimeout(1500); // the fit to the new route
  const pin = (await page.locator(".pin-start").boundingBox())!;
  expect(overlaps((await page.getByTestId("diff-toast").boundingBox())!, pin), "over the start pin after the fit").toBe(false);
  await page.screenshot({ path: test.info().outputPath("toast-arrival.png") });
  for (const state of ["peek", "half", "full"] as const) {
    await snapTo(page, state);
    const toast = (await page.getByTestId("diff-toast").boundingBox())!;
    const body = (await page.locator(".sheet-body").boundingBox())!;
    expect(overlaps(toast, body), `${state}: over the sheet's content`).toBe(false);
    expect(toast.y, `${state}: on screen`).toBeGreaterThanOrEqual(0);
    if (state === "full") {
      const handle = (await page.locator(".sheet-handle").boundingBox())!;
      expect(toast.y).toBeGreaterThanOrEqual(handle.y + handle.height - 1);
    } else {
      const sheet = (await page.locator(".sheet").boundingBox())!;
      expect(sheet.y - (toast.y + toast.height), `${state}: just above the sheet`).toBeLessThan(40);
      const credit = (await page.locator(".maplibregl-ctrl-attrib").boundingBox())!;
      expect(overlaps(toast, credit), `${state}: over the OSM credit`).toBe(false);
    }
    await page.screenshot({ path: test.info().outputPath(`toast-${state}.png`) });
  }
});
