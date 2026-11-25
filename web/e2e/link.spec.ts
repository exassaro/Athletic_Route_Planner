/**
 * "Use on another device" (Step 9) with two browsers: A saves a route and shows a link, B opens it and sees A's
 * saved routes; A still works; the link works once; share links and GPX are unchanged; the code is never in a
 * request's address. Needs the live stack (A01 is planned through the API).
 */
import { devices, expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { PREVIOUS_TOKEN_KEY, TOKEN_KEY } from "../src/plan/planClient";
import { API, savedA01 } from "./savedApi";

const phone = devices["Pixel 7"];

async function contextAs(browser: Browser, token: string | null): Promise<BrowserContext> {
  const ctx = await browser.newContext({ ...phone, baseURL: test.info().project.use.baseURL,
    ignoreHTTPSErrors: process.env.E2E_INSECURE === "1" });
  if (token) await ctx.addInitScript(([key, value]) => localStorage.setItem(key!, value!), [TOKEN_KEY, token]);
  return ctx;
}

/** A's saved-routes page with the dialog open; returns the link it shows. */
async function linkFrom(page: Page): Promise<string> {
  await page.goto("/routes");
  await page.getByTestId("link-open").click();
  const dialog = page.getByTestId("link-dialog");
  await expect(dialog.getByRole("img", { name: "QR code of the link below" })).toBeVisible();
  await expect(page.getByTestId("link-countdown")).toContainText(/Works for [45]:\d\d/);
  const url = await page.getByTestId("link-url").inputValue();
  expect(new URL(url).pathname).toBe("/link");
  expect(new URL(url).search).toBe("");
  expect(new URL(url).hash.length).toBeGreaterThan(20);
  return url;
}

const token = (page: Page, key = TOKEN_KEY) => page.evaluate((k) => localStorage.getItem(k), key);
const cards = (page: Page) => page.locator(".saved-card").evaluateAll((els) => els.map((e) => e.getAttribute("data-saved-id")));

test("B joins A with the link: same saved routes, A still works, the link works once", async ({ browser, request }) => {
  const a = await savedA01(request, "Linked coast");
  const ctxA = await contextAs(browser, a.token);
  const pageA = await ctxA.newPage();
  const url = await linkFrom(pageA);
  const code = new URL(url).hash.slice(1);
  await pageA.screenshot({ path: test.info().outputPath("link-dialog.png") });

  const ctxB = await contextAs(browser, null);
  const pageB = await ctxB.newPage();
  const addresses: string[] = [];
  pageB.on("request", (r) => addresses.push(r.url()));
  await pageB.goto(new URL(url).pathname + new URL(url).hash);
  await pageB.waitForURL("**/routes");
  await expect(pageB.getByTestId("linked")).toContainText("Linked. Your saved routes are here.");
  await expect.poll(() => cards(pageB)).toEqual([a.saved.saved_id]);
  await pageB.screenshot({ path: test.info().outputPath("linked-b.png") });
  expect(addresses.filter((u) => u.includes(code)), "the code is in no request's address").toEqual([]);
  expect(await pageB.evaluate(() => window.location.hash)).toBe("");
  const tokenB = await token(pageB);
  expect(tokenB).not.toBeNull();
  expect(tokenB).not.toBe(a.token);
  expect(await token(pageB, PREVIOUS_TOKEN_KEY)).toBeNull();            // B had none of its own

  // A still works, with its own token.
  await pageA.getByTestId("link-close").click();
  await pageA.reload();
  await expect.poll(() => cards(pageA)).toEqual([a.saved.saved_id]);
  expect(await token(pageA)).toBe(a.token);

  // A change from B is A's too.
  const renamed = await request.patch(`${API}/v1/me/routes/${a.saved.saved_id}`,
    { headers: { "X-Client-Token": tokenB! }, data: { name: "Renamed on B" } });
  expect(renamed.ok()).toBe(true);
  await pageA.reload();
  await expect(pageA.locator(".saved-name")).toHaveText("Renamed on B");

  // Share link and GPX are what they were.
  const share = await request.get(`${API}/v1/share/${a.saved.share_slug}`);
  expect(share.ok()).toBe(true);
  const shared = await share.json();
  expect([shared.name, shared.is_owner]).toEqual(["Renamed on B", false]);
  expect((await request.get(new URL(shared.gpx_url, API).toString())).ok()).toBe(true);
  const gpxA = await request.get(`${API}/v1/routes/${a.saved.route_id}/gpx`, { headers: a.headers });
  const gpxB = await request.get(`${API}/v1/routes/${a.saved.route_id}/gpx`, { headers: { "X-Client-Token": tokenB! } });
  expect(gpxA.ok() && gpxB.ok()).toBe(true);
  expect(await gpxB.text()).toBe(await gpxA.text());

  // The same link a second time: used.
  const ctxC = await contextAs(browser, null);
  const pageC = await ctxC.newPage();
  await pageC.goto(new URL(url).pathname + new URL(url).hash);
  await expect(pageC.getByTestId("link-invalid")).toContainText("expired or was already used");
  expect(await token(pageC)).toBeNull();
  await Promise.all([ctxA.close(), ctxB.close(), ctxC.close()]);
});

test("a browser with saved routes of its own is warned, and Cancel keeps them", async ({ browser, request }) => {
  const a = await savedA01(request, "A's route");
  const b = await savedA01(request, "B's own route");
  const pageA = await (await contextAs(browser, a.token)).newPage();
  const url = await linkFrom(pageA);

  const ctxB = await contextAs(browser, b.token);
  const pageB = await ctxB.newPage();
  await pageB.goto(new URL(url).pathname + new URL(url).hash);
  await expect(pageB.getByTestId("link-confirm")).toContainText("1 saved route of its own");
  expect(await pageB.evaluate(() => window.location.hash)).toBe("");
  await pageB.screenshot({ path: test.info().outputPath("link-confirm.png") });
  await pageB.getByTestId("link-cancel").click();
  await pageB.waitForURL("**/routes");
  await expect.poll(() => cards(pageB)).toEqual([b.saved.saved_id]);
  expect(await token(pageB)).toBe(b.token);

  // Not used by the cancel: "Link anyway" from a fresh open of the same link works, and keeps B's token aside.
  await pageB.goto(new URL(url).pathname + new URL(url).hash);
  await pageB.getByTestId("link-anyway").click();
  await pageB.waitForURL("**/routes");
  await expect.poll(() => cards(pageB)).toEqual([a.saved.saved_id]);
  expect(await token(pageB, PREVIOUS_TOKEN_KEY)).toBe(b.token);
  // B's own route was not deleted: its old token still lists it.
  const own = await request.get(`${API}/v1/me/routes`, { headers: b.headers });
  expect((await own.json()).map((r: { saved_id: string }) => r.saved_id)).toEqual([b.saved.saved_id]);
  await ctxB.close();
});

test("the menu opens the dialog on the saved-routes page", async ({ browser, request }) => {
  const a = await savedA01(request);
  const page = await (await contextAs(browser, a.token)).newPage();
  await page.goto("/routes#another-device");
  await expect(page.getByTestId("link-dialog")).toBeVisible();
  expect(await page.evaluate(() => window.location.hash)).toBe("");
});
