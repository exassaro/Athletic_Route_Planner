/** Directions in words on a phone (blueprint Phase 5b amendment 18), against the live stack. */
import { expect, test } from "@playwright/test";
import { pickPlace, PLACES } from "./helpers";

test("a direction is picked in words, and the hint follows the map as it turns", async ({ page }) => {
  await page.goto("/");
  await pickPlace(page, "start-search", PLACES.athanikkal);
  await page.getByTestId("setup-next").click();
  await page.getByTestId("setup-next").click();
  await page.getByRole("tab", { name: "A direction" }).click();
  await page.getByRole("button", { name: "South-east, down and right on the map" }).click();
  await expect(page.getByTestId("direction-current")).toContainText("Heading south-east");
  await expect(page.getByTestId("direction-dial")).toHaveAttribute("data-point", "3");
  for (const option of await page.locator(".direction-option").all()) {
    const box = (await option.boundingBox())!;
    expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
    expect(await option.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), "fits its button").toBe(true);
  }
  await page.screenshot({ path: test.info().outputPath("direction-picker.png") });
  await page.waitForFunction(() => (window as unknown as { athleteMap?: import("maplibre-gl").Map }).athleteMap?.loaded());
  await page.evaluate(() => (window as unknown as { athleteMap: import("maplibre-gl").Map }).athleteMap.jumpTo({ bearing: 90 }));
  await expect(page.getByRole("button", { name: "East, up on the map", exact: true })).toBeVisible();
});
