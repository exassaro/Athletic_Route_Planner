/**
 * Planning survives a refresh and Back (blueprint Phase 5e amendments 1 to 3), on the live stack. A restore never
 * solves: every test that restores counts the plan POSTs and PATCHes, and expects none.
 */
import { expect, test, type Page } from "@playwright/test";
import { checkNumbers, pickPlace, planA01Base, PLACES, recordApi, setDistance, waitVersion } from "./helpers";
import { actAs, savedA01 } from "./savedApi";

const KEY = "gatho:draft:v1";

/** Every request that would make a solve, from now on. */
function watchSolves(page: Page) {
  const solves: string[] = [];
  page.on("request", (r) => {
    if (/\/v1\/plans/.test(r.url()) && r.method() !== "GET") solves.push(`${r.method()} ${r.url()}`);
  });
  return solves;
}

const stored = (page: Page) => page.evaluate((key) => sessionStorage.getItem(key), KEY);
/** The write is 300 ms after the last change; pagehide flushes it too. */
const settled = (page: Page) => page.waitForTimeout(900);
const selected = (page: Page) => page.locator(".route-card.selected").getAttribute("data-route-id");
const step = (page: Page) => page.locator(".setup").getAttribute("data-step");

/** Setup to step 4: start, 18 km, a loop. */
async function halfASetup(page: Page) {
  await page.goto("/");
  await pickPlace(page, "start-search", PLACES.athanikkal);
  await expect(page.locator(".setup")).toHaveAttribute("data-step", "2");
  await setDistance(page, 18);
  await page.getByTestId("setup-next").click();
  await page.locator(".shape-tile", { hasText: "Loop" }).click();
  await page.getByTestId("setup-next").click();
  await expect(page.locator(".setup")).toHaveAttribute("data-step", "4");
  await settled(page);
}

async function expectHalfASetup(page: Page) {
  await expect(page.locator(".setup")).toHaveAttribute("data-step", "4");
  await expect(page.locator(".setup-answers")).toContainText("Athanikkal · 18.0 km · Loop");
}

test("a fresh tab keeps the server's step 1: nothing is restored, so nothing is drawn again", async ({ page }) => {
  // a remount after hydration made the largest paint wait for every script (Lighthouse, Phase 5d step 9)
  await page.addInitScript(() => document.addEventListener("DOMContentLoaded", () => {
    const title = document.querySelector(".setup-title");
    if (title) (title as HTMLElement).dataset.fromServer = "yes";
  }));
  await page.goto("/");
  await expect(page.getByTestId("start-search")).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(page.locator(".setup-title"), "the server's heading, not a new one").toHaveAttribute("data-from-server", "yes");
});

test("refresh during setup: the same step, answers, sheet and map view, and step 1 never flashes", async ({ page }) => {
  await halfASetup(page);
  await page.locator(".sheet-handle").click();
  await expect(page.locator(".sheet")).toHaveAttribute("data-snap", "full");
  await settled(page);
  const view = JSON.parse((await stored(page))!).view;

  // every step that was ever visible during the load
  await page.addInitScript(() => {
    const seen: string[] = [];
    Object.assign(window, { __seen: seen });
    const look = () => {
      const setup = document.querySelector(".setup");
      const sheet = document.querySelector(".sheet");
      if (setup && sheet && getComputedStyle(sheet).visibility === "visible") seen.push(setup.getAttribute("data-step")!);
      requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  });
  await page.reload();
  await expectHalfASetup(page);
  await expect(page.locator(".sheet")).toHaveAttribute("data-snap", "full");
  await page.waitForTimeout(600);
  const seen = await page.evaluate(() => [...new Set((window as unknown as { __seen: string[] }).__seen)]);
  expect(seen, "steps seen while loading").toEqual(["4"]);
  if (view) {
    await page.waitForFunction(() => (window as unknown as { athleteMap?: import("maplibre-gl").Map }).athleteMap?.loaded());
    const at = await page.evaluate(() => {
      const m = (window as unknown as { athleteMap: import("maplibre-gl").Map }).athleteMap;
      return { lng: m.getCenter().lng, lat: m.getCenter().lat, zoom: m.getZoom() };
    });
    expect(at.lng).toBeCloseTo(view.center[0], 3);
    expect(at.lat).toBeCloseTo(view.center[1], 3);
    expect(at.zoom).toBeCloseTo(view.zoom, 1);
  }
  await page.screenshot({ path: test.info().outputPath("setup-restored.png") });
});

test("Back out of GATHO during setup, then forward: nothing is lost", async ({ page }) => {
  await page.goto("/about");
  await halfASetup(page);
  await page.goBack();
  await expect(page).toHaveURL(/\/about$/);
  await page.goForward();
  await expectHalfASetup(page);
});

test("refresh with a plan: the same version and card, read and never solved", async ({ page }) => {
  await planA01Base(page);
  await setDistance(page, 22);
  await waitVersion(page, 2);
  await page.locator(".route-card-head").nth(1).click();
  await expect(page.locator(".route-card").nth(1)).toHaveClass(/selected/);
  await settled(page);
  const route = await selected(page);
  expect(page.url()).toMatch(/\/\?plan=[0-9a-f-]+&v=2&r=1$/);

  const solves = watchSolves(page);
  const bodies = recordApi(page);
  await page.reload();
  await waitVersion(page, 2);
  expect(await selected(page)).toBe(route);
  await expect(page.locator('[data-chip="distance"] [data-value]')).toHaveAttribute("data-value", "22000");
  await expect(page.getByTestId("elevation-chart")).toBeVisible();
  await expect(page.getByTestId("diff-toast"), "a fresh result").toHaveCount(0);
  await checkNumbers(page, bodies);
  await page.waitForTimeout(1000);
  expect(await selected(page), "the row did not select another").toBe(route);
  expect(solves, "a restore never solves").toEqual([]);

  // Undo still knows the versions, and an edit applies to the version on screen
  await page.getByTestId("menu-open").click();
  await expect(page.getByTestId("menu-undo")).toBeEnabled();
  await page.getByTestId("menu").getByRole("button", { name: "Done" }).click();
  await setDistance(page, 20);
  await waitVersion(page, 3);
  await expect(page).toHaveURL(/&v=3&r=\d+$/);
  await page.screenshot({ path: test.info().outputPath("plan-restored.png") });
});

test("the sheet's position and an open editor come back", async ({ page }) => {
  await planA01Base(page);
  await page.locator('[data-chip="distance"] button').click();
  await expect(page.getByTestId("chip-editor")).toBeVisible();
  await settled(page);
  await page.reload();
  await waitVersion(page, 1);
  await expect(page.getByTestId("chip-editor")).toBeVisible();
  await page.getByTestId("chip-editor").getByRole("button", { name: "Done" }).click();
  await page.locator(".sheet-handle").click();
  await expect(page.locator(".sheet")).toHaveAttribute("data-snap", "full");
  await settled(page);
  await page.reload();
  await waitVersion(page, 1);
  await expect(page.locator(".sheet")).toHaveAttribute("data-snap", "full");
});

test("Saved routes and back, by Back and by the link, restores the run", async ({ page }) => {
  await planA01Base(page);
  const route = await selected(page);
  const solves = watchSolves(page);
  const toSaved = async () => {
    await page.getByTestId("menu-open").click();
    await page.getByTestId("menu").getByRole("link", { name: "Saved routes" }).click();
    await expect(page).toHaveURL(/\/routes$/);
  };
  await toSaved();
  await page.goBack();
  await waitVersion(page, 1);
  expect(await selected(page)).toBe(route);

  await toSaved();
  await page.getByRole("link", { name: "Plan a run", exact: true }).click();
  await waitVersion(page, 1);
  expect(await selected(page)).toBe(route);
  await expect(page).toHaveURL(/\/\?plan=/);
  expect(solves).toEqual([]);
});

test("the Back gesture from Follow returns to the plan", async ({ page }) => {
  await planA01Base(page);
  const route = await selected(page);
  await page.locator(".route-card.selected").getByTestId("follow").click();
  await expect(page.getByTestId("follow-start")).toBeVisible();
  await page.goBack();
  await waitVersion(page, 1);
  expect(await selected(page)).toBe(route);
});

test("a new tab starts clean; the copied address opens the plan", async ({ page, context }) => {
  await planA01Base(page);
  await settled(page);
  const address = page.url();
  const tab = await context.newPage();
  await tab.goto("/");
  await expect(tab.locator(".setup")).toHaveAttribute("data-step", "1");
  expect(new URL(tab.url()).search).toBe("");
  await tab.goto(address);
  await waitVersion(tab, 1);
});

test("editing a saved route survives a refresh, edits included", async ({ page, request }) => {
  const { token, saved } = await savedA01(request, "Coast run");
  await actAs(page, token);
  await page.goto(`/?edit=${saved.saved_id}`);
  await waitVersion(page, 1);
  await setDistance(page, 28);
  await waitVersion(page, 2);
  await expect(page.getByTestId("update")).toBeEnabled();
  await settled(page);
  await page.reload();
  await waitVersion(page, 2);
  await expect(page.getByTestId("update")).toHaveText("Update Coast run");
  await expect(page.getByTestId("update")).toBeEnabled();
  await expect(page.locator('[data-chip="distance"] [data-value]')).toHaveAttribute("data-value", "28000");
  await expect(page).toHaveURL(new RegExp(`&edit=${saved.saved_id}$`));
});

test("New run clears it all, and Undo puts it back without a solve", async ({ page }) => {
  await planA01Base(page);
  await settled(page);
  const address = page.url();
  const route = await selected(page);
  const solves = watchSolves(page);
  const button = page.getByTestId("new-run");
  expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const handle = (await page.locator(".sheet-handle").boundingBox())!;
  expect((await button.boundingBox())!.x, "clear of the handle").toBeGreaterThanOrEqual(handle.x + handle.width - 1);
  await page.screenshot({ path: test.info().outputPath("new-run.png") });

  await button.click();
  await expect(page.locator(".setup")).toHaveAttribute("data-step", "1");
  await expect(page.getByTestId("cleared-toast")).toContainText("Cleared your run.");
  expect(new URL(page.url()).search).toBe("");
  await page.waitForTimeout(700);
  await page.screenshot({ path: test.info().outputPath("cleared.png") });
  await page.getByTestId("cleared-toast").getByRole("button", { name: "Undo" }).click();
  await waitVersion(page, 1);
  expect(await selected(page)).toBe(route);
  await expect(page).toHaveURL(address);
  expect(solves).toEqual([]);

  await page.getByTestId("new-run").click();
  await settled(page);
  expect(await stored(page), "nothing kept").toBeNull();
  await page.reload();
  await expect(page.locator(".setup")).toHaveAttribute("data-step", "1");
  expect(new URL(page.url()).search).toBe("");
});

test("Plan a new run in the menu, from the setup; its message goes after 10 s", async ({ page }) => {
  await halfASetup(page);
  await page.getByTestId("menu-open").click();
  await page.getByTestId("menu-new-run").click();
  await expect(page.getByTestId("menu")).not.toBeVisible();
  expect(await step(page)).toBe("1");
  await page.getByTestId("cleared-toast").getByRole("button", { name: "Undo" }).click();
  await expectHalfASetup(page);
  await page.getByTestId("menu-open").click();
  await page.getByTestId("menu-new-run").click();
  await page.mouse.move(5, 100);
  await expect(page.getByTestId("cleared-toast")).toBeVisible();
  await expect(page.getByTestId("cleared-toast")).toHaveCount(0, { timeout: 14_000 });
});

test("a run that is gone: calm, with the draft still filled in", async ({ page }) => {
  await planA01Base(page);
  await settled(page);
  await page.route(/\/v1\/plans\/[^/]+\/versions\//, (route) => route.fulfill({ status: 404, contentType: "application/json",
    body: JSON.stringify({ error: "not_found", message: "No such plan for this client.", detail: null }) }));
  await page.reload();
  await expect(page.getByTestId("restoring-note")).toContainText("That run is no longer available");
  await expect(page.locator(".setup")).toHaveAttribute("data-step", "5");
  await expect(page.locator(".setup-answers")).toContainText("Athanikkal · 25.0 km");
  expect(new URL(page.url()).search).toBe("");
  await page.screenshot({ path: test.info().outputPath("gone.png") });
});

test("the API down: the draft and Try again", async ({ page }) => {
  await planA01Base(page);
  await settled(page);
  const down = /\/v1\/plans\/[^/]+\/versions\//;
  await page.route(down, (route) => route.fulfill({ status: 502, contentType: "text/html", body: "bad gateway" }));
  await page.reload();
  await expect(page.getByTestId("restoring-note")).toHaveAttribute("data-state", "failed");
  await expect(page.locator(".setup-answers")).toContainText("Athanikkal");
  await page.screenshot({ path: test.info().outputPath("failed.png") });
  await settled(page);
  await page.reload();
  await expect(page.getByTestId("restoring-note"), "the pointer is kept").toHaveAttribute("data-state", "failed");
  await page.unroute(down);
  await page.getByTestId("restoring-note").getByRole("button", { name: "Try again" }).click();
  await waitVersion(page, 1);
});

test("while it loads: the skeleton, no number and no step 1", async ({ page }) => {
  await planA01Base(page);
  await settled(page);
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route(/\/v1\/plans\/[^/]+\/versions\//, async (route) => {
    await held;
    await route.continue();
  });
  await page.reload();
  await expect(page.getByTestId("restoring")).toBeVisible();
  await expect(page.locator(".restoring-bar"), "the skeleton, at half too").toBeVisible();
  await expect(page.locator(".setup")).toHaveCount(0);
  await expect(page.locator(".sheet [data-value]")).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("restoring.png") });
  release();
  await waitVersion(page, 1);
});

test("a copied address opened elsewhere makes no session", async ({ page, browser }) => {
  await planA01Base(page);
  await settled(page);
  const other = await (await browser.newContext()).newPage();
  const asked: string[] = [];
  other.on("request", (r) => { if (r.url().includes("/v1/session")) asked.push(r.url()); });
  await other.goto(page.url());
  await expect(other.getByTestId("restoring-note")).toContainText("That run is no longer available");
  expect(asked).toEqual([]);
  await other.context().close();
});

test("a plan made on another map says so", async ({ page }) => {
  await planA01Base(page);
  await settled(page);
  await page.route(/\/v1\/health/, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    // the public body's opaque map id (Step 9): any other value is another map
    await route.fulfill({ response, json: { ...body, map: { ...body.map, valhalla: "0123456789abcdef" } } });
  });
  await page.reload();
  await waitVersion(page, 1);
  await expect(page.getByTestId("older-map")).toContainText("Built on an older map");
});

test("My location: no position in storage, and the setup says why", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ longitude: 75.8123456, latitude: 11.2345678, accuracy: 8 });
  await page.goto("/");
  await page.getByRole("button", { name: "My location" }).click();
  await expect(page.locator(".setup")).toHaveAttribute("data-step", "2");
  await setDistance(page, 12);
  await page.waitForTimeout(1500);
  const all = await page.evaluate(() => JSON.stringify([{ ...sessionStorage }, { ...localStorage }]));
  expect(all).not.toMatch(/75\.81[0-9]|11\.23[0-9]/);
  await page.reload();
  await expect(page.getByTestId("start-not-kept")).toContainText("Tap My location again");
  expect(JSON.parse((await stored(page))!).draft.target_distance_m).toBe(12_000);
});

test("no geometry and no token in storage, and the stops still plan the same after a refresh", async ({ page }) => {
  await halfASetup(page);
  await page.getByTestId("setup-skip").click();
  await pickPlace(page, "setup-stop-search", PLACES.kadalundi);
  await expect(page.locator(".setup-stops li")).toHaveCount(1);
  await settled(page);
  expect((await stored(page))!).not.toMatch(/boundary|Polygon|"lines"|token|geometry/i);
  expect((await stored(page))!.length).toBeLessThan(5000);

  await page.reload();
  await expect(page.locator(".setup-stops li")).toHaveCount(1);
  const item = page.waitForResponse((r) => r.url().includes("/v1/features/item") && r.ok());
  const planned = page.waitForRequest((r) => r.url().endsWith("/v1/plans") && r.method() === "POST");
  await page.getByTestId("plan-button").click();
  const built = (await (await item).json()).checkpoint;
  expect((await planned).postDataJSON().request.checkpoints).toEqual([built]);
});
