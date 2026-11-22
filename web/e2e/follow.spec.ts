/**
 * Follow mode (blueprint Phase 5d amendments 4 to 15) on the live stack. The position is mocked: A01's committed GPX
 * replayed at running speed, with the page's clock moved along with it. The refusal is the browser's own.
 * The screen lock is step 7's.
 */
import { readFileSync } from "node:fs";
import { expect, test, type BrowserContext, type Page, type Request } from "@playwright/test";
import { planA01Base, strayNumbers } from "./helpers";
import { actAs, API, savedA01, type Made } from "./savedApi";

const GPX = readFileSync(new URL("../../docs/reports/phase4/gpx/A01_recommended.gpx", import.meta.url), "utf8");
const TRACK = [...GPX.matchAll(/<trkpt lat="([^"]+)" lon="([^"]+)"/g)].map((m) => [Number(m[2]), Number(m[1])] as [number, number]);

type Fix = { lon: number; lat: number; after: number; accuracy?: number };
type Mock = { __replay: (fixes: Fix[]) => Promise<void>; __watching: () => number };

/** A geolocation that says only what the test feeds it, each fix `after` seconds of the page's clock later. */
async function mockPosition(context: BrowserContext) {
  await context.addInitScript(() => {
    const realNow = Date.now.bind(Date);
    let ahead = 0;
    Date.now = () => realNow() + ahead;
    let next = 0;
    const watchers = new Map<number, PositionCallback>();
    const fake = {
      watchPosition(ok: PositionCallback) {
        watchers.set(++next, ok);
        return next;
      },
      clearWatch(id: number) { watchers.delete(id); },
      getCurrentPosition() {},
    };
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: fake });
    Object.assign(window, {
      __watching: () => watchers.size,
      async __replay(fixes: { lon: number; lat: number; after: number; accuracy?: number }[]) {
        for (let i = 0; i < fixes.length; i++) {
          const f = fixes[i]!;
          ahead += f.after * 1000;
          for (const ok of [...watchers.values()]) {
            ok({ timestamp: Date.now(), coords: { longitude: f.lon, latitude: f.lat, accuracy: f.accuracy ?? 6 } } as GeolocationPosition);
          }
          if (i % 25 === 24) await new Promise((r) => setTimeout(r, 0));
        }
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      },
    });
  });
}

const replay = (page: Page, fixes: Fix[]) => page.evaluate((f) => (window as unknown as Mock).__replay(f), fixes);

/** Fixes every `step` seconds at 3 m/s along a route, its metres given by the API's follow response. */
function running(points: [number, number][], along: number[], fromM: number, toM: number, step = 5): Fix[] {
  const out: Fix[] = [];
  let i = 0;
  for (let m = fromM; ; m += 3 * step) {
    const at = Math.min(m, toM);
    while (i + 2 < along.length && along[i + 1]! < at) i++;
    const t = Math.min(1, Math.max(0, (at - along[i]!) / (along[i + 1]! - along[i]! || 1)));
    const [a, b] = [points[i]!, points[i + 1]!];
    out.push({ lon: a[0] + t * (b[0] - a[0]), lat: a[1] + t * (b[1] - a[1]), after: step });
    if (at >= toM) return out;
  }
}

/** Opens /follow on a route, waits until its corridor is in and the map is drawn, and hands back the API's answer. */
async function openFollow(page: Page, query: string) {
  const answered = page.waitForResponse((r) => r.url().includes("/follow") && r.url().includes("/v1/") && r.ok());
  await page.goto(`/follow?${query}`);
  const route = await (await answered).json() as { points: [number, number][]; along_m: number[]; cue_source: string };
  await expect(page.getByTestId("map")).toHaveAttribute("data-corridor", "ready");
  await expect(page.getByTestId("map")).toHaveAttribute("data-drawn", "yes");
  await page.waitForTimeout(1200);       // the style's sprite, the first labels
  return route;
}

const number = async (page: Page, field: string) =>
  Number(await page.locator(`[data-field="${field}"]`).first().getAttribute("data-value"));

async function checkLayout(page: Page) {
  const small = await page.locator("button, a.btn").evaluateAll((els) => els
    .filter((e) => e.getClientRects().length && e.getBoundingClientRect().height < 44).map((e) => e.textContent));
  expect(small, "under 44 px").toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), "sideways").toBeLessThanOrEqual(0);
  expect(await strayNumbers(page)).toEqual([]);
  if ((page.viewportSize()?.width ?? 0) >= 900) return;
  const credit = (await page.locator(".maplibregl-ctrl-attrib").boundingBox())!;
  const sheet = (await page.locator(".follow .sheet").boundingBox())!;
  expect(credit.y + credit.height, "the OSM credit is above the sheet").toBeLessThanOrEqual(sheet.y + 1);
}

async function bothThemes(page: Page, name: string) {
  for (const theme of ["light", "dark"]) {
    await page.evaluate((t) => {
      localStorage.setItem("gatho-theme", t);
      document.documentElement.dataset.theme = t;
      window.dispatchEvent(new Event("gatho-theme"));
    }, theme);
    await page.waitForTimeout(900);
    await page.screenshot({ path: test.info().outputPath(`${name}-${theme}.png`) });
  }
  await page.evaluate(() => {
    localStorage.setItem("gatho-theme", "light");
    document.documentElement.dataset.theme = "light";
    window.dispatchEvent(new Event("gatho-theme"));
  });
  await page.waitForTimeout(500);
}

let made: Made;
test.beforeAll(async ({ request }) => {
  made = await savedA01(request, "Coast run");
});

test("A01's GPX at running speed reaches 100 %, and the whole run asks the server for nothing", async ({ page, context }) => {
  await mockPosition(context);
  await actAs(page, made.token);
  const logged: string[] = [];
  page.on("console", (m) => logged.push(m.text()));
  const { points, along_m: along, cue_source: source } = await openFollow(page, `saved=${made.saved.saved_id}`);
  expect(source).toBe("junctions");
  expect(points.length, "the committed GPX is this route").toBe(TRACK.length);
  for (const [i, [lon, lat]] of TRACK.entries()) {
    expect(points[i]![0]).toBeCloseTo(lon, 6);
    expect(points[i]![1]).toBeCloseTo(lat, 6);
  }
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Coast run");
  expect(await page.evaluate(() => (window as unknown as Mock).__watching()), "asked only when tapped").toBe(0);
  await checkLayout(page);

  const stored = await page.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }, document.cookie]));
  const asked: string[] = [];
  const onRequest = (r: Request) => { if (!/^(blob|data):/.test(r.url())) asked.push(r.url()); };
  context.on("request", onRequest);

  await page.getByTestId("follow-start").click();
  const fixes = running(TRACK, along, 0, along.at(-1)!);
  const half = Math.floor(fixes.length / 2);
  await replay(page, [{ ...fixes[0]!, after: 0 }, ...fixes.slice(1, half)]);
  await page.waitForTimeout(800);

  const total = along.at(-1)!;
  const done = await number(page, "follow.done_m");
  expect(Math.abs(done - total / 2)).toBeLessThan(80);
  expect(done + (await number(page, "follow.left_m"))).toBeCloseTo(total, 3);
  const elapsed = await number(page, "follow.elapsed_s");
  expect(await number(page, "follow.pace_s_per_km")).toBeGreaterThan(300);
  expect(await number(page, "follow.pace_s_per_km")).toBeLessThan(360);
  expect(elapsed).toBeGreaterThan(3900);
  await expect(page.getByTestId("follow-cue")).toContainText(/(^In .+|^Now): turn (left|right|around)/);
  await expect(page.getByTestId("follow-off")).toHaveCount(0);
  await checkLayout(page);

  const drawn = await page.evaluate(() => {
    const map = (window as unknown as { athleteMap: import("maplibre-gl").Map }).athleteMap;
    const all = map.queryRenderedFeatures();
    const of = (p: (f: (typeof all)[number]) => boolean) => all.filter(p).length;
    return {
      roads: of((f) => f.source === "protomaps" && f.sourceLayer === "roads"),
      labels: of((f) => f.source === "protomaps" && f.layer.type === "symbol"),
      dot: of((f) => f.layer.id === "follow-dot"),
      done: of((f) => f.layer.id === "follow-done"),
      left: of((f) => f.layer.id === "follow-left"),
    };
  });
  expect(drawn.roads, "the corridor's roads, from memory").toBeGreaterThan(0);
  expect(drawn.labels, "labels, drawn on the device").toBeGreaterThan(0);
  expect([drawn.dot, drawn.done, drawn.left].map((n) => n > 0)).toEqual([true, true, true]);
  expect(await page.evaluate(() => !!(window as unknown as { athleteMap: import("maplibre-gl").Map }).athleteMap
    .getLayer("pin-obstacles")), "labels give way to the markers").toBe(true);
  await expect(page.locator(".pin-start.hop")).toHaveCount(0);

  // the camera wanders where the corridor is not: still nothing may be asked
  await page.evaluate(async () => {
    const map = (window as unknown as { athleteMap: import("maplibre-gl").Map }).athleteMap;
    for (const [center, zoom] of [[[76.3, 9.98], 14], [[75.3704, 11.8745], 17], [[75.8, 11.2], 9.5]] as const) {
      map.jumpTo({ center: [center[0], center[1]], zoom });
      await new Promise((r) => setTimeout(r, 700));
    }
  });

  await replay(page, fixes.slice(half));
  await page.waitForTimeout(800);
  expect(await number(page, "follow.done_m")).toBe(total);
  expect(await number(page, "follow.left_m")).toBe(0);
  await expect(page.getByTestId("follow-cue")).toHaveAttribute("data-state", "arrived");

  await page.getByTestId("follow-stop").click();
  await expect(page.getByTestId("follow-question")).toContainText("Stop this run?");
  await page.getByTestId("follow-stop-confirm").click();
  await expect(page.getByTestId("follow-summary")).toContainText("Route finished");
  expect(await number(page, "follow.done_m")).toBe(total);
  await expect(page.getByTestId("follow-skipped")).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as Mock).__watching()), "stopped watching").toBe(0);

  expect(asked, "requests during the run").toEqual([]);
  // canaries: the recorder does hear a fetch, from the page and from a worker (MapLibre fetches from both)
  await page.evaluate(async () => {
    await fetch("/icons/icon.svg?canary=page", { cache: "no-store" });
    const code = "onmessage = (e) => fetch(e.data, { cache: 'no-store' }).then(() => postMessage(1))";
    const worker = new Worker(URL.createObjectURL(new Blob([code], { type: "text/javascript" })));
    await new Promise((resolve) => {
      worker.onmessage = resolve;
      worker.postMessage(`${location.origin}/icons/icon.svg?canary=worker`);
    });
    worker.terminate();
  });
  await expect.poll(() => asked.filter((url) => url.includes("canary=")).length, { message: "the recorder hears fetches" }).toBe(2);
  context.off("request", onRequest);
  expect(await page.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }, document.cookie])), "stored").toBe(stored);
  expect(logged.filter((line) => /7[56]\.\d{4}|1[01]\.\d{4}/.test(line)), "logged").toEqual([]);
  await checkLayout(page);
  await bothThemes(page, "finished");
});

test("start, running, a 60 m detour with its banner, and back", async ({ page, context }) => {
  await mockPosition(context);
  await actAs(page, made.token);
  const { points, along_m: along } = await openFollow(page, `route=${made.v1.candidates[0]!.route_id}`);
  await expect(page.getByTestId("follow-lock")).toContainText("Locking your phone pauses GATHO's tracking.");
  await expect(page.getByTestId("follow-why")).toContainText("stays on this phone");
  await bothThemes(page, "start");

  await page.getByTestId("follow-start").click();
  await expect(page.getByTestId("follow-asking")).toBeVisible();
  await replay(page, running(points, along, 0, 3500));
  await page.waitForTimeout(900);
  await expect(page.getByTestId("follow-cue")).toContainText("turn right onto Chaliyam Road");
  await bothThemes(page, "running");

  // 60 m to the side of the segment being run
  const i = along.findIndex((m) => m >= 3500);
  const [a, b] = [points[i - 1]!, points[i]!];
  const here = running(points, along, 3500, 3500)[0]!;
  const [kx, ky] = [109_230, 110_620];
  const [dx, dy] = [(b[0] - a[0]) * kx, (b[1] - a[1]) * ky];
  const size = Math.hypot(dx, dy);
  const away = { lon: here.lon + ((-dy / size) * 60) / kx, lat: here.lat + ((dx / size) * 60) / ky };
  await replay(page, Array.from({ length: 9 }, () => ({ ...away, after: 1 })));
  await expect(page.getByTestId("follow-off")).toHaveCount(0);
  await replay(page, Array.from({ length: 3 }, () => ({ ...away, after: 1 })));
  await expect(page.getByTestId("follow-off")).toBeVisible();
  await expect(page.getByTestId("follow-off")).toContainText("off the route, in a straight line. Head ");
  const off = await number(page, "follow.off_m");
  expect(off).toBeGreaterThan(50);
  expect(off).toBeLessThan(66);
  await page.waitForTimeout(700);
  await checkLayout(page);
  await bothThemes(page, "off-route");

  await replay(page, [{ ...here, after: 1 }, { ...here, after: 1 }]);
  await expect(page.getByTestId("follow-off")).toHaveCount(0);

  await page.getByTestId("follow-pause").click();
  await expect(page.getByTestId("follow-cue")).toHaveText("Paused");
  const paused = await number(page, "follow.done_m");
  await replay(page, running(points, along, 3500, 3600));
  expect(await number(page, "follow.done_m")).toBe(paused);
  await page.getByTestId("follow-resume").click();
  await replay(page, running(points, along, 3605, 3650));
  expect(await number(page, "follow.done_m")).toBeGreaterThan(3600);

  await page.setViewportSize({ width: 360, height: 640 });
  await page.waitForTimeout(700);
  await checkLayout(page);
  await page.screenshot({ path: test.info().outputPath("running-small.png") });
  const sheet = (await page.locator(".follow .sheet").boundingBox())!;
  expect(sheet.y, "the map keeps a good part of a small screen").toBeGreaterThan(640 * 0.38);
});

test("Did you finish: yes records 100 %", async ({ page, context }) => {
  await mockPosition(context);
  await actAs(page, made.token);
  const { points, along_m: along } = await openFollow(page, `saved=${made.saved.saved_id}`);
  await page.getByTestId("follow-start").click();
  const total = along.at(-1)!;
  await replay(page, running(points, along, 0, 300));
  // out of sight long enough for the window to reach the end, then by the end but too inexact to snap
  const [lon, lat] = points.at(-1)!;
  await replay(page, [{ lon, lat, after: Math.ceil(total / 5) + 30, accuracy: 45 }]);
  await page.getByTestId("follow-stop").click();
  await expect(page.getByTestId("follow-question")).toContainText("Did you finish the route?");
  await checkLayout(page);
  await page.screenshot({ path: test.info().outputPath("did-you-finish.png") });
  await page.getByTestId("follow-finished-yes").click();
  await expect(page.getByTestId("follow-summary")).toContainText("Route finished");
  expect(await number(page, "follow.done_m")).toBe(total);
});

test("a denied permission shows the calm message", async ({ page }) => {
  await actAs(page, made.token);
  await openFollow(page, `saved=${made.saved.saved_id}`);      // no permission granted: the browser itself refuses
  await page.getByTestId("follow-start").click();
  await expect(page.getByTestId("follow-blocked")).toContainText("Location is off for GATHO");
  await expect(page.getByTestId("follow-blocked")).toContainText("That's fine.");
  await expect(page.getByRole("alert").filter({ hasText: /./ })).toHaveCount(0);
  await checkLayout(page);
  await bothThemes(page, "denied");
});

test("the browser's own geolocation starts a run", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ longitude: TRACK[0]![0], latitude: TRACK[0]![1], accuracy: 5 });
  await actAs(page, made.token);
  await openFollow(page, `saved=${made.saved.saved_id}`);
  await page.getByTestId("follow-start").click();
  await expect(page.getByTestId("follow-screen")).toHaveAttribute("data-view", "running");
  expect(await number(page, "follow.done_m")).toBeLessThan(20);
});

test("the three Follow buttons, and Back", async ({ page, context }) => {
  await planA01Base(page);
  const card = page.locator(".route-card").first();
  await expect(card.getByTestId("follow")).toHaveAttribute("href", `/follow?route=${await card.getAttribute("data-route-id")}`);
  await page.locator(".sheet-handle").click();
  await card.getByTestId("follow").scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await page.screenshot({ path: test.info().outputPath("route-card.png") });
  const [tab] = await Promise.all([context.waitForEvent("page"), card.getByTestId("follow").click()]);
  await expect(tab.getByTestId("follow-start")).toBeVisible();
  await Promise.all([tab.waitForEvent("close"), tab.getByTestId("follow-back").click()]);
  await expect(page.locator(".route-card").first(), "the plan is still there").toBeVisible();

  await page.getByTestId("route-name").fill("Follow test");
  await page.getByTestId("save").click();
  const share = (await page.getByTestId("share-link").getAttribute("href"))!;

  await page.goto("/routes");
  const follow = page.locator(".saved-card").first().getByTestId("follow");
  expect((await follow.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: test.info().outputPath("saved-card.png") });
  await follow.click();
  await expect(page.getByTestId("follow-start")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Follow test");
  await page.getByTestId("follow-back").click();
  await page.waitForURL(/\/routes$/);

  await page.goto(share);
  await page.locator(".sheet-handle").click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: test.info().outputPath("share-follow.png") });
  await page.getByTestId("follow").click();
  await expect(page.getByTestId("follow-start")).toBeVisible();
  await page.getByTestId("follow-back").click();
  await page.waitForURL(/\/s\//);
});

test("a visitor follows a share link and never gets a session", async ({ page }) => {
  const sessions: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/v1/session") || r.headers()["x-client-token"]) sessions.push(r.url());
  });
  await openFollow(page, `share=${made.saved.share_slug}`);
  await expect(page.getByTestId("follow-start")).toBeVisible();
  await page.goto(`/follow?saved=${made.saved.saved_id}`);
  await expect(page.getByTestId("follow-page")).toHaveAttribute("data-state", "gone");
  await expect(page.getByTestId("follow-page")).toContainText("That route is no longer available");
  await page.screenshot({ path: test.info().outputPath("gone.png") });
  expect(sessions).toEqual([]);
});

test("the map failing to load leaves Follow working", async ({ page, context }) => {
  await mockPosition(context);
  await context.route(/\/basemap\/kerala\.pmtiles/, (route) => route.abort());
  await actAs(page, made.token);
  const answered = page.waitForResponse((r) => r.url().includes("/v1/") && r.url().endsWith("/follow"));
  await page.goto(`/follow?saved=${made.saved.saved_id}`);
  const route = await (await answered).json();
  await expect(page.getByTestId("map-failed")).toContainText("Follow still works");
  await page.getByTestId("follow-start").click();
  await replay(page, running(route.points, route.along_m, 0, 200));
  expect(await number(page, "follow.done_m")).toBeGreaterThan(150);
});

test("a share link updated while its page is open never mixes two routes (step 4's race)", async ({ page, request }) => {
  const other = await savedA01(request, "Race");
  await page.goto(`/s/${other.saved.share_slug}`);
  await page.locator(".sheet-handle").click();
  await page.waitForTimeout(400);
  const changed = await request.patch(`${API}/v1/me/routes/${other.saved.saved_id}`,
    { headers: other.headers, data: { route_id: other.v1.candidates[1]!.route_id } });
  expect(changed.ok()).toBe(true);
  await page.getByTestId("open-in").click();
  await expect(page.getByTestId("open-in-sheet").getByRole("alert")).toContainText("This link now has a new route. Reload the page");
  await expect(page.getByTestId("open-google")).toHaveAttribute("data-points", "even");
  await expect(page.getByTestId("open-google-note")).not.toContainText("overlap");
  await expect(page.getByTestId("open-share")).toBeDisabled();
});

test.describe("on a computer", () => {
  test.use({ viewport: { width: 1366, height: 800 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });

  test("the panel", async ({ page, context }) => {
    await mockPosition(context);
    await actAs(page, made.token);
    const { points, along_m: along } = await openFollow(page, `saved=${made.saved.saved_id}`);
    await checkLayout(page);
    await page.getByTestId("follow-start").click();
    await replay(page, running(points, along, 0, 1500));
    await page.waitForTimeout(800);
    await checkLayout(page);
    await page.screenshot({ path: test.info().outputPath("running-desktop.png") });
  });
});
