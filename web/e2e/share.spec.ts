/** The share page, which is the saved-route view (blueprint Phase 5b amendment 21), against the live stack. */
import { expect, test, type Page } from "@playwright/test";
import { planA01Base } from "./helpers";

async function savedRoute(page: Page): Promise<string> {
  await planA01Base(page);
  await page.getByTestId("route-name").fill("Sheet test");
  await page.getByTestId("save").click();
  return (await page.getByTestId("share-link").getAttribute("href"))!;
}

test("opens at peek, the sheet moves, Map drops it back; the desktop panel collapses", async ({ page }) => {
  await page.goto(await savedRoute(page));
  const sheet = page.locator(".sheet");
  await expect(sheet).toHaveAttribute("data-snap", "peek");
  await expect(page.getByTestId("summary")).toBeVisible();
  const viewport = page.viewportSize()!;
  expect((await sheet.boundingBox())!.y, "the map is most of the screen").toBeGreaterThan(viewport.height * 0.7);
  await expect(page.getByTestId("to-map")).toBeHidden();
  await page.waitForFunction(() => (window as unknown as { athleteMap?: import("maplibre-gl").Map }).athleteMap?.loaded());
  await page.waitForTimeout(1200); // the fit
  await page.screenshot({ path: test.info().outputPath("share-peek.png") });

  for (const state of ["half", "full"]) {
    await page.locator(".sheet-handle").click();
    await expect(sheet).toHaveAttribute("data-snap", state);
    await expect(page.getByTestId("summary")).toBeVisible();
    await page.waitForTimeout(400);
    await page.screenshot({ path: test.info().outputPath(`share-${state}.png`) });
  }
  const button = (await page.getByTestId("to-map").boundingBox())!;
  expect(button.height).toBeGreaterThanOrEqual(44);
  await page.getByTestId("to-map").click();
  await expect(sheet).toHaveAttribute("data-snap", "peek");

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByTestId("panel-toggle").click();
  await expect(sheet).toBeHidden();
  await page.screenshot({ path: test.info().outputPath("share-collapsed.png") });
  await page.getByTestId("panel-toggle").click();
  await expect(sheet).toBeVisible();
});
