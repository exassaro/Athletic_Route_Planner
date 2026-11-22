/** What a tab keeps of the planner, and how it is read back (Phase 5e amendments 1 and 2). */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RESTORE_SCRIPT, RESTORING } from "./boot";
import { DRAFT_KEY, MAX_AGE_MS, MY_LOCATION, parseStored, rebuildItems, serialise, type Draft, type Stored } from "./draft";
import { planAddress, readAddress, readTab, tabWriter, WRITE_AFTER_MS } from "./tab";

// A01's request, from the API's own example: six stops with boundaries and a bridge's lines
const A01 = JSON.parse(readFileSync(join(__dirname, "..", "..", "..", "api", "athlete_api", "examples", "request_A01.json"),
  "utf8")).value.request as Draft;
const NOW = 1_795_000_000_000;

type State = Omit<Stored, "schema" | "at">;
const state = (over: Partial<State> = {}): State => ({
  run: { plan: "p1", version: 3, seq: 1, edit: null, history: { versions: [1, 2, 3], at: 2 } },
  draft: A01, located: false, step: 5, sheet: "peek", editor: "distance",
  view: { center: [75.82, 11.18], zoom: 12.5 }, ...over,
});

afterEach(() => {
  sessionStorage.clear();
  document.documentElement.removeAttribute(RESTORING);
  vi.useRealTimers();
});

describe("what is stored", () => {
  it("no geometry: no boundary, no lines, and a few KB at most", () => {
    const full = JSON.stringify(A01);
    expect(full).toMatch(/MultiPolygon|Polygon/);          // the test means something
    const text = serialise(state(), NOW);
    expect(text).not.toMatch(/"boundary"|"lines"|"polygon"|Polygon|LineString|"geometry"|"coordinates"/);
    expect(text.length).toBeLessThan(5000);
    expect(text.length).toBeLessThan(full.length);
  });

  it("no token", () => {
    expect(serialise(state(), NOW)).not.toMatch(/token/i);
  });

  it("no GPS position: neither a start from My location nor the view centred on it", () => {
    const draft = { ...A01, start: { lon: 75.8123456, lat: 11.2345678, label: MY_LOCATION, place_id: null } };
    const text = serialise(state({ draft, view: { center: [75.81234, 11.23456], zoom: 13 } }), NOW);
    expect(text).not.toMatch(/75\.8123|11\.2345/);
    const back = parseStored(text, NOW)!;
    expect(back.draft.start).toBeNull();
    expect(back.located).toBe(true);
    expect(back.view).toBeNull();
  });

  it("and it still says so when written again without that start", () => {
    const again = parseStored(serialise(state({ draft: { ...A01, start: null }, located: true }), NOW), NOW)!;
    expect(again.located).toBe(true);
    expect(again.view).toBeNull();
  });

  it("a searched start and the rest come back as they were", () => {
    const back = parseStored(serialise(state(), NOW), NOW)!;
    expect(back.draft.start).toEqual(A01.start);
    expect(back.draft.target_distance_m).toBe(A01.target_distance_m);
    expect(back.draft.direction).toEqual(A01.direction);
    expect(back.draft.checkpoints!.map((c) => c.label)).toEqual(A01.checkpoints!.map((c) => c.label));
    expect([back.step, back.sheet, back.editor]).toEqual([5, "peek", "distance"]);
    expect(back.run).toEqual(state().run);
    expect(back.view).toEqual(state().view);
  });
});

describe("reading it back never throws", () => {
  const good = () => JSON.parse(serialise(state(), NOW));
  const bad: [string, () => string | null][] = [
    ["nothing", () => null],
    ["not JSON", () => "{oops"],
    ["null", () => "null"],
    ["a number", () => "7"],
    ["another schema", () => JSON.stringify({ ...good(), schema: 2 })],
    ["no draft", () => JSON.stringify({ ...good(), draft: undefined })],
    ["a bad step", () => JSON.stringify({ ...good(), step: 9 })],
    ["a bad sheet", () => JSON.stringify({ ...good(), sheet: "huge" })],
    ["a bad list", () => JSON.stringify({ ...good(), draft: { ...good().draft, checkpoints: "x" } })],
    ["a bad start", () => JSON.stringify({ ...good(), draft: { ...good().draft, start: { lon: "x" } } })],
    ["a bad pointer", () => JSON.stringify({ ...good(), run: { plan: 7 } })],
    ["a bad view", () => JSON.stringify({ ...good(), view: { zoom: 4 } })],
  ];
  for (const [name, text] of bad) it(`${name}: a clean start`, () => expect(parseStored(text(), NOW)).toBeNull());

  it("12 hours old is too old", () => {
    const text = serialise(state(), NOW);
    expect(parseStored(text, NOW + MAX_AGE_MS - 1000)).not.toBeNull();
    expect(parseStored(text, NOW + MAX_AGE_MS)).toBeNull();
  });

  it("storage that throws is a clean start", () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(readTab(NOW)).toBeNull();
    get.mockRestore();
  });
});

describe("the stops are built again before planning", () => {
  it("A01's request comes back exactly, from the API's answers alone", async () => {
    const stored = parseStored(serialise(state(), NOW), NOW)!.draft;
    const fetchItem = vi.fn(async (_role: string, _kind: string, placeId: string) => {
      const item = A01.checkpoints!.find((c) => c.place_id === placeId)!;
      return { role: "checkpoint", checkpoint: item } as never;
    });
    expect((await rebuildItems(stored, fetchItem)).checkpoints).toEqual(A01.checkpoints);
    expect(fetchItem).toHaveBeenCalledTimes(6);
    const bridge = A01.checkpoints!.find((c) => c.kind === "bridge")!;
    expect(fetchItem.mock.calls.find((c) => c[1] === "bridge")![2]).toBe(bridge.place_id);
  });

  it("a road to avoid is found again by its first way", async () => {
    const draft = { ...A01, checkpoints: [], avoid: [{ kind: "road", label: "Beach Road", radius_m: 300, way_ids: [42, 43], lines: [[[75.8, 11.2], [75.81, 11.2]]] }] } as Draft;
    const stored = parseStored(serialise(state({ draft }), NOW), NOW)!.draft;
    const fetchItem = vi.fn(async () => ({ role: "avoid", avoid: draft.avoid![0] }) as never);
    expect((await rebuildItems(stored, fetchItem)).avoid).toEqual(draft.avoid);
    expect(fetchItem).toHaveBeenCalledWith("avoid", "road", "osm:way/42", undefined, false, "Beach Road");
  });

  it("a failure rejects, so nothing is planned without a boundary", async () => {
    const stored = parseStored(serialise(state(), NOW), NOW)!.draft;
    await expect(rebuildItems(stored, async () => { throw new Error("offline"); })).rejects.toThrow("offline");
  });
});

describe("the address", () => {
  it("plan, version, card, and the route being edited last", () => {
    expect(planAddress({ plan: "p", version: 2, seq: 1, edit: null })).toBe("/?plan=p&v=2&r=1");
    expect(planAddress({ plan: "p", version: 2, seq: 0, edit: "s" })).toBe("/?plan=p&v=2&r=0&edit=s");
  });

  it("reads them back", () => {
    expect(readAddress("?plan=p&v=2&r=1")).toEqual({ kind: "plan", run: { plan: "p", version: 2, seq: 1, edit: null } });
    expect(readAddress("?plan=p&v=2&r=0&edit=s")).toEqual({ kind: "plan", run: { plan: "p", version: 2, seq: 0, edit: "s" } });
    expect(readAddress("?plan=p&v=2")).toEqual({ kind: "plan", run: { plan: "p", version: 2, seq: null, edit: null } });
    expect(readAddress("?edit=s")).toEqual({ kind: "edit", id: "s" });
  });

  it("anything else is no plan", () => {
    for (const search of ["", "?plan=p", "?plan=p&v=0", "?plan=p&v=x", "?v=2"]) expect(readAddress(search)).toBeNull();
  });
});

describe("writing", () => {
  it("300 ms after the last change, only the latest", () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestIdleCallback", undefined);
    const writer = tabWriter();
    writer.schedule(() => "one");
    vi.advanceTimersByTime(WRITE_AFTER_MS - 1);
    writer.schedule(() => "two");
    vi.advanceTimersByTime(WRITE_AFTER_MS - 1);
    expect(sessionStorage.getItem(DRAFT_KEY)).toBeNull();
    vi.advanceTimersByTime(1);
    expect(sessionStorage.getItem(DRAFT_KEY)).toBe("two");
    vi.unstubAllGlobals();
  });

  it("flush writes now; nothing to keep removes it", () => {
    const writer = tabWriter();
    writer.schedule(() => "kept");
    writer.flush();
    expect(sessionStorage.getItem(DRAFT_KEY)).toBe("kept");
    writer.schedule(() => null);
    writer.flush();
    expect(sessionStorage.getItem(DRAFT_KEY)).toBeNull();
  });
});

describe("before paint", () => {
  const run = () => new Function(RESTORE_SCRIPT)();

  it("hides the sheet only when something will be restored", () => {
    vi.useFakeTimers();
    window.history.replaceState(null, "", "/");
    run();
    expect(document.documentElement.hasAttribute(RESTORING)).toBe(false);
    sessionStorage.setItem(DRAFT_KEY, "x");
    run();
    expect(document.documentElement.hasAttribute(RESTORING)).toBe(true);
    vi.advanceTimersByTime(8000);
    expect(document.documentElement.hasAttribute(RESTORING), "never for good").toBe(false);
  });

  it("not on another page", () => {
    sessionStorage.setItem(DRAFT_KEY, "x");
    window.history.replaceState(null, "", "/routes");
    run();
    expect(document.documentElement.hasAttribute(RESTORING)).toBe(false);
    window.history.replaceState(null, "", "/");
  });
});
