/** The logo on screen (blueprint Phase 5b amendments 23 to 28): top bar, About, icons, manifest, OpenGraph. */
import { expect, test } from "@playwright/test";
import { THEME_KEY } from "../src/theme/theme";
import { planA01Base } from "./helpers";

for (const theme of ["light", "dark"] as const) {
  test(`top bar, About and the icons, ${theme}`, async ({ page }) => {
    await page.addInitScript(([key, value]) => localStorage.setItem(key!, value!), [THEME_KEY, theme]);
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(page.getByTestId("splash")).toHaveCount(0, { timeout: 20_000 });    // gone once the map has drawn
    const mark = page.locator(".topbar-brand svg.wordmark");
    await expect(mark).toHaveAttribute("height", "27");
    const bar = (await page.locator(".topbar").boundingBox())!;
    await page.screenshot({ path: test.info().outputPath(`topbar-${theme}.png`), clip: { ...bar, height: bar.height + 4 } });

    await page.goto("/about");
    await expect(page.locator(".about-mark svg.wordmark")).toBeVisible();
    await page.screenshot({ path: test.info().outputPath(`about-${theme}.png`) });

    const manifest = await (await page.request.get("/manifest.webmanifest")).json();
    expect([manifest.name, manifest.short_name]).toEqual(["GATHO", "GATHO"]);
    expect(manifest.icons.map((i: { purpose: string }) => i.purpose)).toContain("maskable");
    await page.evaluate(async (icons: { src: string }[]) => {
      document.body.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:24px;padding:24px">${icons
        .map((i) => `<img src="${i.src}" width="160" height="160" style="image-rendering:pixelated">`).join("")}</div>`;
      await Promise.all([...document.images].map((i) => i.decode()));
    }, manifest.icons);
    await page.screenshot({ path: test.info().outputPath(`manifest-icon-${theme}.png`) });
  });
}

test("every icon is served, and the OpenGraph image is on / and on a share page", async ({ page }) => {
  for (const path of ["/favicon.ico", "/icons/icon.svg", "/icons/icon-512.png", "/icons/icon-maskable-512.png",
    "/icons/icon-192.png", "/icons/icon-180.png", "/icons/icon-32.png"]) {
    expect((await page.request.get(path)).status(), path).toBe(200);
  }
  const og = await (await page.request.get("/brand/og.png")).body();
  expect([og.readUInt32BE(16), og.readUInt32BE(20)]).toEqual([1200, 630]);
  await planA01Base(page);
  const image = page.locator('meta[property="og:image"]').first();
  expect(await image.getAttribute("content")).toMatch(/^https?:\/\/.+\/brand\/og\.png$/);
  await page.getByTestId("route-name").fill("Brand test");
  await page.getByTestId("save").click();
  await page.goto((await page.getByTestId("share-link").getAttribute("href"))!);
  expect(await image.getAttribute("content")).toMatch(/\/brand\/og\.png$/);
  expect(await page.locator('meta[property="og:description"]').getAttribute("content"), "the numbers, as before").toContain("km");
});
