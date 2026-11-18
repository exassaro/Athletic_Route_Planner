/**
 * Screenshots of every screen and state, phone (390x844) and desktop (1440x900), for docs/reports/phase5/.
 * Live stack, except the states marked "mocked": the busy (429), still-solving (409), timeout (504), loading and
 * engines-down screens intercept the API's answer, because the live stack does not produce them on demand.
 */
import { expect, test, type Page } from "@playwright/test";
import { addA01Stops, addStop, PLACES, pickPlace, planA01Base, setDistance, waitVersion } from "./helpers";

const OUT = "../docs/reports/phase5/screenshots";
const SIZES = [{ name: "phone", width: 390, height: 844, mobile: true }, { name: "desktop", width: 1440, height: 900, mobile: false }];

async function shot(page: Page, vp: string, name: string, focus?: string) {
  if (focus) await page.locator(focus).first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/${vp}-${name}.png` });
}

async function sheet(page: Page, state: "half" | "full") {
  const s = page.locator(".sheet");
  for (let i = 0; i < 3 && !(await s.getAttribute("class"))?.includes(state); i++) await page.locator(".sheet-handle").click();
}

for (const vp of SIZES) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.mobile ? 2 : 1, isMobile: vp.mobile,
      hasTouch: vp.mobile });

    test(`screens ${vp.name}`, async ({ page, browser }) => {
      await page.goto("/");
      await page.waitForTimeout(2500);
      await shot(page, vp.name, "01-planner-empty");
      await page.getByTestId("start-search").getByRole("searchbox").fill("Kadalundi");
      await expect(page.locator(".picker-title")).toBeVisible();
      if (vp.mobile) await sheet(page, "full");
      await shot(page, vp.name, "02-place-picker", ".picker");
      await page.getByTestId("start-search").getByRole("searchbox").fill("");

      await planA01Base(page);
      await addA01Stops(page);
      await sheet(page, "half");
      await page.locator(".sheet-body").evaluate((e) => e.scrollTo(0, 0));
      await shot(page, vp.name, "03-results-a01");
      await shot(page, vp.name, "04-stops-list", "[data-testid=stop-list]");
      if (vp.mobile) await sheet(page, "full");
      await page.getByTestId("elevation-chart").scrollIntoViewIfNeeded();
      const box = (await page.getByTestId("elevation-chart").boundingBox())!;
      await page.mouse.move(box.x + box.width * 0.45, box.y + box.height / 2);
      if (vp.mobile) await sheet(page, "half");
      await page.getByTestId("elevation-chart").scrollIntoViewIfNeeded();
      await page.mouse.move(box.x + box.width * 0.45, box.y + box.height / 2);
      await shot(page, vp.name, "05-route-detail-chart");

      await setDistance(page, 20);
      await waitVersion(page, 8);
      await page.locator(".sheet-body").evaluate((e) => e.scrollTo(0, 0));
      await shot(page, vp.name, "06-over-budget", "[data-testid=outcome]");
      if (vp.mobile) await sheet(page, "full");
      await shot(page, vp.name, "07-over-budget-savings", ".savings");
      await sheet(page, "half");
      await page.getByTestId("fix-set_distance").click();
      await waitVersion(page, 9);
      await page.locator(".sheet-body").evaluate((e) => e.scrollTo(0, 0));
      await shot(page, vp.name, "08-after-fix-diff");

      // save and share
      await page.getByTestId("route-name").fill("Coast run");
      await page.getByTestId("save").click();
      await expect(page.getByTestId("share-link")).toBeVisible();
      await shot(page, vp.name, "09-saved-share-link", ".keep");
      const link = (await page.getByTestId("share-link").getAttribute("href"))!;
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.mobile ? 2 : 1 });
      const share = await ctx.newPage();
      await share.goto(link);
      await share.waitForTimeout(3000);
      await shot(share, vp.name, "10-share-page");
      await ctx.close();
      await page.goto("/routes");
      await expect(page.locator(".saved-list li").first()).toBeVisible();
      await shot(page, vp.name, "11-saved-routes");

      // S02 loop and G01 conflict
      await page.goto("/");
      await pickPlace(page, "start-search", PLACES.mananchira);
      await page.getByLabel("Loop").check();
      await setDistance(page, 10);
      await page.getByTestId("plan-button").click();
      await waitVersion(page, 1);
      await page.locator(".sheet-body").evaluate((e) => e.scrollTo(0, 0));
      await shot(page, vp.name, "12-loop-s02");

      await page.goto("/");
      await pickPlace(page, "start-search", PLACES.kozhikode);
      await page.getByLabel("Loop").check();
      await setDistance(page, 10);
      await page.getByTestId("plan-button").click();
      await waitVersion(page, 1);
      await addStop(page, PLACES.feroke);
      await waitVersion(page, 2);
      await page.locator('[data-stop="Feroke"]').getByRole("button", { name: /Pass near|Must reach/ }).click();
      await waitVersion(page, 3);
      await page.locator(".sheet-body").evaluate((e) => e.scrollTo(0, 0));
      await shot(page, vp.name, "13-conflict-g01");

      // mocked states, on top of this plan
      const planUrl = /\/v1\/plans\/[^/]+$/;
      await page.route(planUrl, async (route) => {
        if (route.request().method() !== "PATCH") return route.fallback();
        await new Promise((r) => setTimeout(r, 4000));
        await route.fulfill({ status: 429, headers: { "Retry-After": "30", "Content-Type": "application/json" },
          body: JSON.stringify({ error: "solver_busy", message: "No solve slot.", detail: null }) });
      });
      await setDistance(page, 23);
      await expect(page.getByTestId("status")).toHaveAttribute("data-state", "solving");
      await shot(page, vp.name, "14-loading-old-route-dimmed-mocked");
      await expect(page.getByTestId("status")).toHaveAttribute("data-state", "busy", { timeout: 15000 });
      await shot(page, vp.name, "15-busy-429-mocked");
      await page.unroute(planUrl);
      await page.reload();
      await page.waitForTimeout(1500);

      await page.route("**/v1/health", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({
        status: "down", builds: { osm: "2026-11-15T00:15:25Z", valhalla: null, graphhopper: null, graphhopper_data: null, solver: "x" },
        services: { valhalla: { ok: false, ms: 3000, build: null, detail: "ConnectTimeout" }, graphhopper: { ok: false, ms: 3000, build: null, detail: "ConnectTimeout" },
          photon: { ok: true, ms: 10, build: "photon", detail: null }, postgres: { ok: true, ms: 3, build: "pg", detail: null },
          redis: { ok: true, ms: 1, build: "redis", detail: null }, osm_features: { ok: true, ms: 2, build: "osm", detail: null } } }) }));
      await page.reload();
      await expect(page.getByTestId("health-banner")).toBeVisible();
      await shot(page, vp.name, "16-engines-down-mocked");
      await page.unroute("**/v1/health");

      await page.route("**/v1/plans", (route) => route.fulfill({ status: 504, contentType: "application/json",
        body: JSON.stringify({ error: "solve_timeout", message: "The solve took longer than 15 s.", detail: { plan_id: "00000000-0000-0000-0000-000000000000", status: "solving", poll: "/v1/plans/00000000-0000-0000-0000-000000000000" } }) }));
      await page.route("**/v1/plans/00000000-0000-0000-0000-000000000000", (route) => route.fulfill({ status: 200,
        contentType: "application/json", body: JSON.stringify({ plan_id: "00000000-0000-0000-0000-000000000000", status: "solving", versions: [], latest: null, error: null }) }));
      await pickPlace(page, "start-search", PLACES.mananchira);
      await page.getByTestId("plan-button").click();
      await expect(page.getByTestId("status")).toHaveAttribute("data-state", "waiting", { timeout: 15000 });
      await shot(page, vp.name, "17-timeout-504-polling-mocked");
    });
  });
}
