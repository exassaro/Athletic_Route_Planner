/**
 * The start pin's hop rule (blueprint Phase 5b amendment 13): three hops on a new route or a new start, one per tap,
 * none replayed by zooming or a theme change, none with reduced motion, and nothing animating at rest.
 */
import { expect, test, type Page } from "@playwright/test";
import { pickPlace, planA01Base, PLACES } from "./helpers";

async function countHops(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { hops: number };
    w.hops = 0;
    const count = (e: AnimationEvent) => { if (e.animationName === "shoe-hop") w.hops++; };
    document.addEventListener("animationstart", count, true);
    document.addEventListener("animationiteration", count, true);
  });
}

const hops = (page: Page) => page.evaluate(() => (window as unknown as { hops: number }).hops);
const reset = (page: Page) => page.evaluate(() => { (window as unknown as { hops: number }).hops = 0; });

/** Waits until the hop has ended and the class is gone. */
async function rested(page: Page) {
  await expect(page.locator(".pin-start")).toHaveCount(1);
  await expect(page.locator(".pin-start.hop")).toHaveCount(0, { timeout: 15_000 });
}

test("three hops, then rest; one per tap; zoom and theme do not replay it", async ({ page }) => {
  await countHops(page);
  await page.goto("/");
  await pickPlace(page, "start-search", PLACES.athanikkal);
  await page.locator(".pin-start.hop").waitFor();
  await rested(page);
  expect(await hops(page), "the start was set").toBe(3);

  await planA01Base(page);
  await rested(page);
  await page.waitForTimeout(1000);
  const running = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running")
    .map((a) => (a as CSSAnimation).animationName ?? "transition"));
  expect(running, "nothing animates at rest").toEqual([]);

  await reset(page);
  await page.evaluate(() => {
    const map = (window as unknown as { athleteMap: import("maplibre-gl").Map }).athleteMap;
    map.jumpTo({ zoom: map.getZoom() + 1 });
  });
  await page.waitForTimeout(1500);
  expect(await hops(page), "zoom").toBe(0);

  await page.getByTestId("menu-open").click();
  await page.getByTestId("menu").getByText(/^Dark$/).click();
  await page.waitForTimeout(1500);
  expect(await hops(page), "theme").toBe(0);
  await page.keyboard.press("Escape");

  await page.locator(".pin-start").dispatchEvent("click");
  await page.locator(".pin-start.hop").waitFor();
  await rested(page);
  expect(await hops(page), "one tap").toBe(1);
});

test("no hop with reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await countHops(page);
  await planA01Base(page);
  await page.waitForTimeout(2000);
  expect(await hops(page)).toBe(0);
});
