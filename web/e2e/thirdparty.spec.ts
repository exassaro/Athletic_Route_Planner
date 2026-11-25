/**
 * No third-party requests (Step 9 item 8, "nothing loaded from anyone else"): every page, with a route on the map,
 * may talk only to its own origin and to the API (E2E_API; in production the API and the basemap share
 * api.gatho.shahinsha.xyz). Records every request the browser makes, including fonts, tiles and workers.
 */
import { expect, test, type Page } from "@playwright/test";
import { actAs, API, savedA01 } from "./savedApi";

function recordOrigins(page: Page): Set<string> {
  const seen = new Set<string>();
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.protocol === "http:" || u.protocol === "https:") seen.add(u.origin);
  });
  return seen;
}

test("every page loads only from GATHO's own origins", async ({ page, request, baseURL }) => {
  const { token, saved } = await savedA01(request, "Privacy check");
  await actAs(page, token);
  const seen = recordOrigins(page);

  await page.goto(`/?edit=${saved.saved_id}`);
  await page.locator(".pin-start").waitFor();
  await page.waitForTimeout(3000);                         // tiles, glyphs, sprites, the elevation chart
  await page.goto("/routes");
  await page.locator(".saved-card").first().waitFor();
  await page.getByTestId("link-open").click();
  await page.getByRole("img", { name: "QR code of the link below" }).waitFor();
  await page.goto("/about");
  await page.goto("/link");
  await page.getByTestId("link-no-code").waitFor();
  await page.goto(`/s/${saved.share_slug}`);
  await page.locator(".pin-start").waitFor();
  await page.waitForTimeout(3000);

  const own = new Set([new URL(baseURL!).origin, new URL(API).origin]);
  expect([...seen].filter((o) => !own.has(o)), `requests to ${[...seen].join(", ")}`).toEqual([]);
  expect(seen.size).toBeGreaterThan(0);
});
