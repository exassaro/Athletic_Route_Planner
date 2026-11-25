/**
 * Screenshots of every screen and state (Phase 5b): phone (390 × 844) in light and dark, desktop (1440 × 900) in
 * light. Live stack, except the states marked "mocked": loading, busy (429), engines down and timeout (504)
 * intercept the API's answer, because the live stack does not produce them on demand.
 *
 *   SHOTS_DIR=../docs/reports/phase5b/after/screenshots npx playwright test --project=screens
 *   SHOTS_ONLY=01,02,08 (with it) writes only those screens; the steps still all run.
 */
import { expect, test, type Page } from "@playwright/test";
import { addA01Stops, addStop, PLACES, pickPlace, setDistance, setupRun, waitVersion } from "./helpers";

const OUT = process.env.SHOTS_DIR ?? "../docs/reports/phase5b/after/screenshots";
const ONLY = process.env.SHOTS_ONLY?.split(",");
const wanted = (name: string) => !ONLY || ONLY.includes(name.slice(0, 2));
const SIZES = [{ name: "phone", width: 390, height: 844, mobile: true }, { name: "desktop", width: 1440, height: 900, mobile: false }];

async function setTheme(page: Page, theme: "light" | "dark") {
  await page.evaluate((t) => {
    localStorage.setItem("gatho-theme", t);
    document.documentElement.dataset.theme = t;
    window.dispatchEvent(new Event("gatho-theme"));
  }, theme);
}

/** One screen: light, and on the phone dark as well (switched in place; the basemap swaps too). */
async function shot(page: Page, vp: { name: string; mobile: boolean }, name: string, focus?: string) {
  if (focus) await page.locator(focus).first().scrollIntoViewIfNeeded();
  if (!wanted(name)) return;
  await page.waitForTimeout(800);
  if (!vp.mobile) return void await page.screenshot({ path: `${OUT}/${vp.name}-${name}.png` });
  await page.screenshot({ path: `${OUT}/${vp.name}-${name}-light.png` });
  await setTheme(page, "dark");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/${vp.name}-${name}-dark.png` });
  await setTheme(page, "light");
  await page.waitForTimeout(1200);
}

async function snap(page: Page, state: "peek" | "half" | "full") {
  const s = page.locator(".sheet");
  if (!(await page.locator(".sheet-handle").isVisible())) return;   // desktop: a side panel
  for (let i = 0; i < 3 && (await s.getAttribute("data-snap")) !== state; i++) await page.locator(".sheet-handle").click();
  await page.waitForTimeout(400);
}

const next = (page: Page) => page.getByTestId("setup-next").click();

for (const vp of SIZES) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.mobile ? 2 : 1, isMobile: vp.mobile,
      hasTouch: vp.mobile });

    test(`screens ${vp.name}`, async ({ page, browser }) => {
      test.setTimeout(1_200_000);
      await page.goto("/");
      await page.waitForTimeout(3000);
      await shot(page, vp, "01-setup-start");
      await page.getByTestId("start-search").getByRole("searchbox").fill("Kadalundi");
      await expect(page.locator(".picker-title")).toBeVisible();
      await shot(page, vp, "02-place-picker", ".picker");
      await page.getByTestId("start-search").getByRole("searchbox").fill("");

      // the setup steps (A01's answers)
      await pickPlace(page, "start-search", PLACES.athanikkal);
      await expect(page.locator(".setup")).toHaveAttribute("data-step", "2");
      await setDistance(page, 25);
      await shot(page, vp, "03-setup-distance");
      await next(page);
      await shot(page, vp, "04-setup-shape");
      await next(page);
      await pickPlace(page, "towards-search", PLACES.kozhikode);
      await shot(page, vp, "05-setup-towards");
      await next(page);
      await shot(page, vp, "06-setup-stops");
      await page.getByTestId("plan-button").click();
      await waitVersion(page, 1);
      await addA01Stops(page);

      // A01's results
      await snap(page, "peek");
      await shot(page, vp, "07-results-peek");
      await snap(page, "half");
      await page.locator(".sheet-body").evaluate((e) => e.scrollTo(0, 0));
      await shot(page, vp, "08-results-half-cards");
      await snap(page, "full");
      await shot(page, vp, "09-stops-timeline", "#stops-panel");
      await page.getByTestId("elevation-chart").scrollIntoViewIfNeeded();
      const box = (await page.getByTestId("elevation-chart").boundingBox())!;
      await page.mouse.move(box.x + box.width * 0.45, box.y + box.height / 2);
      await shot(page, vp, "10-route-detail-chart");
      await page.locator('[data-stop="Chaliyam"]').getByRole("button", { name: /^Options for/ }).click();
      await shot(page, vp, "11-stop-options");
      await page.keyboard.press("Escape");
      await snap(page, "half");
      await page.locator(".sheet-body").evaluate((e) => e.scrollTo(0, 0));
      await page.locator('[data-chip="distance"] button').click();
      await shot(page, vp, "12-chip-editor-distance");
      await page.keyboard.press("Escape");
      await page.getByTestId("menu-open").click();
      await shot(page, vp, "13-menu");
      await page.keyboard.press("Escape");
      await page.getByTestId("top-search-open").click();
      await pickPlace(page, "top-search-box", PLACES.beypore);
      await shot(page, vp, "14-place-search-actions");
      await page.keyboard.press("Escape");

      // over budget, a fix, the Undo message
      await setDistance(page, 20);
      await waitVersion(page, 8);
      await page.locator(".sheet-body").evaluate((e) => e.scrollTo(0, 0));
      await shot(page, vp, "15-over-budget", "[data-testid=outcome]");
      await page.getByTestId("fix-set_distance").click();
      await waitVersion(page, 9);
      await page.locator(".sheet-body").evaluate((e) => e.scrollTo(0, 0));
      await shot(page, vp, "16-after-fix-undo-message");

      // save, share page, saved routes
      await page.getByTestId("route-name").fill("Coast run");
      await page.getByTestId("save").click();
      await expect(page.getByTestId("share-link")).toBeVisible();
      await shot(page, vp, "17-saved-share-link", "[data-testid=share-link]");
      const link = (await page.getByTestId("share-link").getAttribute("href"))!;
      const ctx = await browser.newContext({ ignoreHTTPSErrors: process.env.E2E_INSECURE === "1", viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.mobile ? 2 : 1,
        isMobile: vp.mobile, hasTouch: vp.mobile });
      const share = await ctx.newPage();
      await share.goto(link);
      await share.waitForTimeout(3500);
      await shot(share, vp, "18-share-page");
      await ctx.close();
      await page.goto("/routes");
      await expect(page.locator(".saved-card").first()).toBeVisible();
      await shot(page, vp, "19-saved-routes");

      // S02 loop and G01 conflict
      await setupRun(page, { start: PLACES.mananchira, km: 10, shape: "Loop" });
      await waitVersion(page, 1);
      await snap(page, "half");
      await page.locator(".sheet-body").evaluate((e) => e.scrollTo(0, 0));
      await shot(page, vp, "20-loop-s02");

      await setupRun(page, { start: PLACES.kozhikode, km: 10, shape: "Loop" });
      await waitVersion(page, 1);
      await addStop(page, PLACES.feroke);
      await waitVersion(page, 2);
      await page.locator('[data-stop="Feroke"]').getByRole("button", { name: /^Options for/ }).click();
      await page.getByTestId("stop-options").getByRole("button", { name: /Must reach instead|Pass near instead/ }).click();
      await waitVersion(page, 3);
      await snap(page, "half");
      await page.locator(".sheet-body").evaluate((e) => e.scrollTo(0, 0));
      await shot(page, vp, "21-conflict-g01");

      // mocked states, on top of this plan
      const planUrl = /\/v1\/plans\/[^/]+$/;
      await page.route(planUrl, async (route) => {
        if (route.request().method() !== "PATCH") return route.fallback();
        await new Promise((r) => setTimeout(r, 6000));
        await route.fulfill({ status: 429, headers: { "Retry-After": "30", "Content-Type": "application/json" },
          body: JSON.stringify({ error: "solver_busy", message: "No solve slot.", detail: null }) });
      });
      await setDistance(page, 23);
      await expect(page.getByTestId("status")).toHaveAttribute("data-state", "solving");
      await page.locator(".sheet-body").evaluate((e) => e.scrollTo(0, 0));
      await page.waitForTimeout(300);
      if (wanted("22")) await page.screenshot({ path: `${OUT}/${vp.name}-22-loading-mocked${vp.mobile ? "-light" : ""}.png` });
      await expect(page.getByTestId("status")).toHaveAttribute("data-state", "busy", { timeout: 20000 });
      await shot(page, vp, "23-busy-429-mocked");
      await page.unroute(planUrl);
      await page.reload();
      await page.waitForTimeout(1500);

      await page.route("**/v1/health", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({
        status: "down", features: { planning: false, search: true, recommended: false },
        map: { osm: "0123456789abcdef", valhalla: null, graphhopper: null } }) }));
      await page.reload();
      await expect(page.getByTestId("health-banner")).toBeVisible();
      await shot(page, vp, "24-engines-down-mocked");
      await page.unroute("**/v1/health");

      await page.route("**/v1/plans", (route) => route.fulfill({ status: 504, contentType: "application/json",
        body: JSON.stringify({ error: "solve_timeout", message: "The solve took longer than 15 s.", detail: { plan_id: "00000000-0000-0000-0000-000000000000", status: "solving", poll: "/v1/plans/00000000-0000-0000-0000-000000000000" } }) }));
      await page.route("**/v1/plans/00000000-0000-0000-0000-000000000000", (route) => route.fulfill({ status: 200,
        contentType: "application/json", body: JSON.stringify({ plan_id: "00000000-0000-0000-0000-000000000000", status: "solving", versions: [], latest: null, error: null }) }));
      await setupRun(page, { start: PLACES.mananchira });
      await expect(page.getByTestId("status")).toHaveAttribute("data-state", "waiting", { timeout: 15000 });
      await shot(page, vp, "25-timeout-504-polling-mocked");
    });
  });
}
