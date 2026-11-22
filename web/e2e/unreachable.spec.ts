/**
 * When the API can't be reached the app says so, and why: the wrong address (the same-origin build opened on :3000,
 * where /v1 is Next's own 404 page), a real rate limit, no network, a proxy with nothing behind it. Every /v1 call
 * the browser makes is answered here, so this runs against any build and writes nothing.
 */
import { expect, test, type Page } from "@playwright/test";

type Reply = { status: number; body: string; type?: string } | "offline";

async function apiAnswers(page: Page, reply: Reply) {
  await page.route("**/v1/**", (route) => (reply === "offline" ? route.abort("internetdisconnected")
    : route.fulfill({ status: reply.status, body: reply.body, contentType: reply.type ?? "text/html; charset=utf-8" })));
}

const NEXT_404: Reply = { status: 404, body: "<!DOCTYPE html><html><body>404</body></html>" };

function uncaught(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 120)));
  return errors;
}

const search = (page: Page) => page.getByTestId("start-search").getByRole("searchbox").fill("Athanikkal");

test("the wrong address: search and banner say so, no false 429, nothing uncaught", async ({ page }) => {
  const errors = uncaught(page);
  await apiAnswers(page, NEXT_404);
  await page.goto("/");
  await expect(page.getByTestId("health-banner")).toContainText("API isn't", { timeout: 10_000 });
  await search(page);
  await expect(page.getByTestId("start-search").getByRole("alert")).toContainText("API isn't", { timeout: 10_000 });
  await expect(page.locator("body")).not.toContainText("429");
  expect(errors).toEqual([]);
});

test("the wrong address: Plan my run gives the same reason", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 11.1209333, longitude: 75.8460689 });
  await apiAnswers(page, NEXT_404);
  await page.goto("/");
  test.skip(!(await page.evaluate(() => window.isSecureContext)), "location needs localhost or https");
  await page.getByRole("button", { name: "My location" }).click();
  for (let step = 3; step <= 5; step++) {
    await page.getByTestId("setup-next").click();
    await expect(page.locator(".setup")).toHaveAttribute("data-step", String(step), { timeout: 10_000 });
  }
  await page.getByTestId("plan-button").click();
  await expect(page.getByTestId("status").getByRole("alert")).toContainText("API isn't", { timeout: 10_000 });
});

test("a start can still be picked on the map", async ({ page }) => {
  const errors = uncaught(page);
  await apiAnswers(page, NEXT_404);
  await page.goto("/");
  await page.waitForFunction(() => !!(window as unknown as { athleteMap?: import("maplibre-gl").Map }).athleteMap?.loaded(),
    null, { timeout: 30_000 });
  await page.getByRole("button", { name: "Pick on the map" }).click();
  await page.waitForTimeout(500);
  await page.locator(".maplibregl-canvas").first().click({ position: { x: 150, y: 220 } });
  await expect(page.locator(".setup")).toHaveAttribute("data-step", "2", { timeout: 10_000 });
  expect(errors).toEqual([]);
});

test("the wrong address is not a deleted route, and not an empty list", async ({ page }) => {
  await apiAnswers(page, NEXT_404);
  await page.addInitScript(() => localStorage.setItem("athlete.token", "any"));
  await page.goto("/?edit=00000000-0000-0000-0000-000000000000");
  await expect(page.getByTestId("opening-note")).toHaveAttribute("data-state", "failed", { timeout: 10_000 });
  await page.goto("/routes");
  await expect(page.locator(".opening-note")).toContainText("API isn't", { timeout: 10_000 });
});

test("a real session limit keeps the API's own message", async ({ page }) => {
  await apiAnswers(page, { status: 429, type: "application/json",
    body: JSON.stringify({ error: "rate_limited", message: "Too many session requests for this ip: at most 10 every 3600 s." }) });
  await page.goto("/");
  await search(page);
  await expect(page.getByTestId("start-search").getByRole("alert")).toContainText("Too many session requests", { timeout: 10_000 });
});

for (const [name, reply, says] of [
  ["no network", "offline", "Check your connection"],
  ["a proxy with nothing behind it", { status: 502, body: "" }, "(502)"],
] as const) {
  test(`${name} is said`, async ({ page }) => {
    const errors = uncaught(page);
    await apiAnswers(page, reply);
    await page.goto("/");
    await expect(page.getByTestId("health-banner")).toContainText(says, { timeout: 10_000 });
    await search(page);
    await expect(page.getByTestId("start-search").getByRole("alert")).toContainText(says, { timeout: 10_000 });
    expect(errors).toEqual([]);
  });
}
