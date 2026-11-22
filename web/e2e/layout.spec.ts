/**
 * Where things sit on a phone (blueprint Phase 5b amendments 14 and 15), against the live stack. Boxes are compared
 * on screen; nothing here measures a route.
 */
import { expect, test, type Page } from "@playwright/test";
import { addStop, planA01Base, PLACES, waitVersion } from "./helpers";

type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

async function snapTo(page: Page, state: "peek" | "half" | "full") {
  const sheet = page.locator(".sheet");
  for (let i = 0; i < 3 && (await sheet.getAttribute("data-snap")) !== state; i++) await page.locator(".sheet-handle").click();
  await expect(sheet).toHaveAttribute("data-snap", state);
  await page.waitForTimeout(400); // the sheet's settle
}

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
