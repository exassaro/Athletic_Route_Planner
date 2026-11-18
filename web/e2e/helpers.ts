/** Shared steps for the end-to-end journeys and screenshots. */
import { expect, type Page } from "@playwright/test";
import { km, runningTime } from "../src/plan/format";

export const PLACES = {
  athanikkal: { q: "Athanikkal", id: "osm:node/1770460252" },
  kozhikode: { q: "Kozhikode", id: "osm:node/1348192542" },
  kottakkadavu: { q: "Kottakkadavu", id: "osm:node/3027581412" },
  kadalundi: { q: "Kadalundi", id: "osm:node/7728008448" },
  chaliyam: { q: "Chaliyam", id: "osm:node/1683145417" },
  beypore: { q: "Beypore", id: "osm:node/1683149581" },
  kallai: { q: "Kallai", id: "osm:node/3797752730" },
  mananchira: { q: "Mananchira", id: "osm:node/12355175353" },
  feroke: { q: "Feroke", id: "osm:node/986593739" },
} as const;

/** The Karuvanthuruthy bridge: way 389396419 ("Chaliyam - Feroke Road", bridge=yes), middle vertex from OSM. */
export const BRIDGE = { id: "osm:way/389396419", lonlat: [75.8163968, 11.1605711] as [number, number],
  label: "Chaliyam - Feroke Road" };

/** Everything the API sent the page (plan versions, elevation, share), for the number check. */
export function recordApi(page: Page) {
  const bodies: unknown[] = [];
  page.on("response", async (r) => {
    const url = r.url();
    if (!/\/v1\/(plans|routes|share|me)/.test(url) || !r.headers()["content-type"]?.includes("json")) return;
    try {
      bodies.push(await r.json());
    } catch {
      /* not JSON */
    }
  });
  return bodies;
}

function numbers(x: unknown, out: Set<number>) {
  if (typeof x === "number") out.add(x);
  else if (Array.isArray(x)) x.forEach((v) => numbers(v, out));
  else if (x && typeof x === "object") Object.values(x).forEach((v) => numbers(v, out));
}

/**
 * Every number on screen matches the API response (Phase 5 acceptance): each element with data-value holds a
 * number the API sent, and its text is that number formatted (km to 0.1 or 0.01, metres rounded, time at the
 * page's pace). Returns how many were checked.
 */
export async function checkNumbers(page: Page, bodies: unknown[]): Promise<number> {
  const sent = new Set<number>();
  bodies.forEach((b) => numbers(b, sent));
  const shown = await page.locator("[data-value]").evaluateAll((els) => els.filter((e) => (e as HTMLElement).offsetParent !== null)
    .map((e) => ({ value: Number(e.getAttribute("data-value")), field: e.getAttribute("data-field") ?? "",
      pace: e.getAttribute("data-pace"), text: (e.textContent ?? "").trim() })));
  for (const s of shown) {
    expect(sent.has(s.value), `${s.field} = ${s.value} ("${s.text}") is not in any API response`).toBe(true);
    if (s.pace) expect(s.text, s.field).toBe(runningTime(s.value, Number(s.pace)));
    else if (s.text.endsWith("km")) {
      const signed = /^[+−±]/.test(s.text);
      const v = signed ? Math.abs(s.value) : s.value;      // a signed deviation shows its size after the sign
      expect([km(v), km(v, 2)], s.field).toContain(s.text.replace(/^[+−±]/, ""));
    }
    else if (s.text.endsWith(" m")) expect(s.text, s.field).toBe(`${Math.round(s.value)} m`);
  }
  expect(shown.length).toBeGreaterThan(0);
  return shown.length;
}

export async function pickPlace(page: Page, scope: string, place: { q: string; id: string }) {
  await page.getByTestId(scope).getByRole("searchbox").fill(place.q);
  await page.locator(`[data-testid=${scope}] [data-place-id="${place.id}"]`).first().click();
}

export async function waitVersion(page: Page, n: number) {
  await expect(page.locator(".history")).toContainText(`Version ${n}`, { timeout: 120_000 });
  await expect(page.getByTestId("status")).toHaveAttribute("data-state", "idle", { timeout: 120_000 });
}

export async function setDistance(page: Page, kmValue: number) {
  const input = page.getByTestId("distance-input");
  await input.fill(String(kmValue));
  await input.press("Enter");
}

/** Taps the map at a point (OSM coordinates), through the page's map. */
export async function tapMap(page: Page, lonlat: [number, number]) {
  const xy = await page.evaluate(async (p) => {
    const m = (window as unknown as { athleteMap: import("maplibre-gl").Map }).athleteMap;
    // put the point in the part of the map the sheet or panel does not cover (a one-off offset; padding would stay)
    const sheet = document.querySelector(".sheet")?.getBoundingClientRect();
    const wide = window.matchMedia("(min-width: 900px)").matches;
    const offset: [number, number] = !sheet ? [0, 0] : wide ? [sheet.width / 2, 0] : [0, -(window.innerHeight - sheet.top) / 2];
    m.easeTo({ center: p, zoom: 16, offset, duration: 0 });
    await new Promise((r) => setTimeout(r, 400));
    const q = m.project(p);
    const r = m.getCanvas().getBoundingClientRect();
    return [r.left + q.x, r.top + q.y];
  }, lonlat);
  await page.mouse.click(xy[0]!, xy[1]!);
}

export async function addStop(page: Page, place: { q: string; id: string }) {
  await page.getByTestId("add-checkpoint").click();
  await pickPlace(page, "search-checkpoint", place);
}

export async function addBridgeStop(page: Page) {
  await page.getByTestId("add-checkpoint").click();
  await page.getByTestId("tap-checkpoint").click();
  await tapMap(page, BRIDGE.lonlat);
  await page.locator(`button[data-place-id="${BRIDGE.id}"]`).click();
}

/** Start, distance and direction, then "Plan my run": version 1. */
export async function planA01Base(page: Page) {
  await page.goto("/");
  await pickPlace(page, "start-search", PLACES.athanikkal);
  await setDistance(page, 25);
  await pickPlace(page, "towards-search", PLACES.kozhikode);
  await page.getByTestId("plan-button").click();
  await waitVersion(page, 1);
}

export const A01_STOPS = ["Kottakkadavu", "Kadalundi", "Chaliyam", BRIDGE.label, "Beypore", "Kallai"];

/** The six A01 stops, one patch each: versions 2 to 7. */
export async function addA01Stops(page: Page) {
  const stops = [PLACES.kottakkadavu, PLACES.kadalundi, PLACES.chaliyam, "bridge", PLACES.beypore, PLACES.kallai] as const;
  for (let i = 0; i < stops.length; i++) {
    const s = stops[i]!;
    if (s === "bridge") await addBridgeStop(page);
    else await addStop(page, s);
    await waitVersion(page, i + 2);
  }
}
