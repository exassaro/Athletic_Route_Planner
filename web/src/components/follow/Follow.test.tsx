/** Follow's screens and what they load (Phase 5d amendments 4, 7, 11 and 12). The map is not drawn here. */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pointAt } from "@/follow/line";
import { lineOf, ROUTES } from "@/follow/testing";
import { TOKEN_KEY } from "@/plan/planClient";
import { FollowScreen } from "./FollowScreen";
import { isGone, loadFollow } from "./load";
import { cameFrom, followTarget } from "./target";

vi.mock("./FollowMap", () => ({ FollowMap: () => null }));
vi.mock("@/theme/useTheme", () => ({ useTheme: () => ["light", () => {}] }));

const T0 = 1_795_000_000_000;
let onFix: PositionCallback;
let onError: PositionErrorCallback;
let watchPosition: ReturnType<typeof vi.fn>;
let clearWatch: ReturnType<typeof vi.fn>;
let clock = T0;

beforeEach(() => {
  clock = T0;
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  watchPosition = vi.fn((ok: PositionCallback, failed: PositionErrorCallback) => {
    onFix = ok;
    onError = failed;
    return 7;
  });
  clearWatch = vi.fn();
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: { watchPosition, clearWatch } });
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function show(name: keyof typeof ROUTES = "S02", routeName: string | null = null) {
  const onLeave = vi.fn();
  render(<FollowScreen followed={{ route: ROUTES[name], name: routeName }} onLeave={onLeave} />);
  return { line: lineOf(name), onLeave };
}

function fix(line: ReturnType<typeof lineOf>, seconds: number, m: number, east = 0) {
  clock = T0 + seconds * 1000;
  const [lon, lat] = pointAt(line, m);
  act(() => onFix({ timestamp: clock,
    coords: { longitude: lon + east / 109_200, latitude: lat, accuracy: 6 } } as GeolocationPosition));
}

const view = () => screen.getByTestId("follow-screen").getAttribute("data-view");
const tap = (id: string) => act(() => { fireEvent.click(screen.getByTestId(id)); });
const value = (field: string) => Number(document.querySelector(`[data-field="${field}"]`)!.getAttribute("data-value"));

describe("the start screen", () => {
  it("says the lock line and why, and asks for nothing until Follow is tapped", () => {
    show("S02", "Morning loop");
    expect(screen.getByTestId("follow-lock").textContent).toBe("Locking your phone pauses GATHO's tracking. Keep the "
      + "screen on, or use the GPX in Organic Maps or on a watch for long runs.");
    expect(screen.getByTestId("follow-why").textContent).toContain("stays on this phone");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Morning loop");
    expect(value("along_m")).toBe(ROUTES.S02.along_m.at(-1));
    expect(watchPosition).not.toHaveBeenCalled();
    tap("follow-start");
    expect(watchPosition).toHaveBeenCalledTimes(1);
    expect(watchPosition.mock.calls[0]![2]).toEqual({ enableHighAccuracy: true, maximumAge: 0 });
    expect(view()).toBe("asking");
  });

  it("a refusal is calm, and can be tried again", () => {
    show();
    tap("follow-start");
    act(() => onError({ code: 1, message: "denied" } as GeolocationPositionError));
    expect(view()).toBe("denied");
    expect(screen.getByTestId("follow-blocked").textContent).toContain("That's fine.");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(clearWatch).toHaveBeenCalledWith(7);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(watchPosition).toHaveBeenCalledTimes(2);
  });

  it("says https is needed, without asking", () => {
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: false });
    show();
    tap("follow-start");
    expect(view()).toBe("insecure");
    expect(watchPosition).not.toHaveBeenCalled();
  });

  it("no position yet is not a refusal", () => {
    show();
    tap("follow-start");
    act(() => onError({ code: 2, message: "unavailable" } as GeolocationPositionError));
    expect(view()).toBe("asking");
    expect(screen.getByTestId("follow-asking").textContent).toContain("No position yet");
  });
});

describe("a run", () => {
  it("time starts at the first position, not at the tap", () => {
    const { line } = show();
    tap("follow-start");
    fix(line, 25, 0);
    expect(value("follow.elapsed_s")).toBe(0);
  });

  it("the numbers add up and are labelled along the route", () => {
    const { line } = show();
    tap("follow-start");
    for (let t = 0; t <= 100; t++) fix(line, t, 3 * t);
    expect(value("follow.done_m")).toBeGreaterThan(280);
    expect(value("follow.done_m") + value("follow.left_m")).toBeCloseTo(line.totalM, 6);
    expect(value("follow.elapsed_s")).toBe(100);
    expect(value("follow.pace_s_per_km")).toBeCloseTo(100_000 / value("follow.done_m"), 6);
    const labels = [...document.querySelectorAll(".follow-stat dt")].map((e) => e.textContent);
    expect(labels).toEqual(["done, along the route", "left, along the route", "time", "pace, along the route"]);
    expect(screen.getByTestId("follow-cue").getAttribute("data-state")).toBe("cue");
  });

  it("off the route: the straight line and the way back", () => {
    const { line } = show();
    tap("follow-start");
    for (let t = 0; t <= 40; t++) fix(line, t, 4000, 400);
    const banner = screen.getByTestId("follow-off");
    expect(banner.textContent).toMatch(/^You are \d+ m off the route, in a straight line\. Head [a-z-]+ to get back to it\.$/);
    expect(value("follow.off_m")).toBeGreaterThan(40);
    expect(screen.getByRole("alert").textContent).toBe("You are off the route.");
  });

  it("pause, resume, then stop asks once and Done leaves", () => {
    const { line, onLeave } = show();
    tap("follow-start");
    for (let t = 0; t <= 60; t++) fix(line, t, 3 * t);
    tap("follow-pause");
    expect(view()).toBe("paused");
    tap("follow-resume");
    expect(view()).toBe("running");
    tap("follow-stop");
    expect(screen.getByTestId("follow-question").textContent).toContain("Stop this run?");
    tap("follow-keep-going");
    expect(view()).toBe("running");
    tap("follow-stop");
    tap("follow-stop-confirm");
    expect(view()).toBe("finished");
    expect(screen.getByTestId("follow-summary").textContent).toContain("Run stopped");
    expect(screen.queryByTestId("follow-skipped")).toBeNull();
    expect(clearWatch).toHaveBeenCalledWith(7);
    tap("follow-done");
    expect(onLeave).toHaveBeenCalled();
  });

  it("a loop's end after a long gap: Did you finish, and a yes is 100 %", () => {
    const { line } = show();
    tap("follow-start");
    fix(line, 0, 0);
    for (let t = 2010; t < 2025; t++) fix(line, t, 0);
    tap("follow-stop");
    expect(screen.getByTestId("follow-question").textContent).toContain("Did you finish the route?");
    tap("follow-finished-yes");
    expect(screen.getByTestId("follow-summary").textContent).toContain("Route finished");
    expect(value("follow.done_m")).toBe(line.totalM);
  });

  it("location turned off during a run keeps the run, to stop or try again", () => {
    const { line } = show();
    tap("follow-start");
    fix(line, 0, 0);
    act(() => onError({ code: 1, message: "denied" } as GeolocationPositionError));
    expect(screen.getByTestId("follow-lost")).toBeTruthy();
    expect(screen.getByTestId("follow-stop")).toBeTruthy();
  });
});

describe("what /follow loads", () => {
  it("exactly one of saved, route or share", () => {
    expect(followTarget({ saved: "a" })).toEqual({ kind: "saved", id: "a" });
    expect(followTarget({ route: "b" })).toEqual({ kind: "route", id: "b" });
    expect(followTarget({ share: "c" })).toEqual({ kind: "share", id: "c" });
    for (const bad of [{}, { route: "" }, { route: ["a", "b"] }, { route: "a", share: "b" }]) expect(followTarget(bad)).toBeNull();
  });

  it("Back leads to where Follow was tapped", () => {
    expect(cameFrom({ kind: "saved", id: "a" })).toBe("/routes");
    expect(cameFrom({ kind: "share", id: "c" })).toBe("/s/c");
    expect(cameFrom({ kind: "route", id: "b" })).toBe("/");
  });

  it("a visitor never gets a session: without a token only a share link works, and nothing is sent", async () => {
    localStorage.removeItem(TOKEN_KEY);
    const fetched = vi.spyOn(globalThis, "fetch");
    for (const kind of ["saved", "route"] as const) {
      const failure = await loadFollow({ kind, id: "x" }).catch((e: unknown) => e);
      expect(isGone(failure)).toBe(true);
    }
    expect(fetched).not.toHaveBeenCalled();
  });
});
