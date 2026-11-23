/** The "Open in..." sheet (blueprint Phase 5d amendments 1 to 3). */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Overview, RoutePoints } from "@/export/googleMaps";
import { ApiFailure } from "@/plan/planClient";
import { OpenInDialog, type OpenInProps } from "./OpenIn";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const route: RoutePoints = { start: [75.84, 11.12], end: [75.78, 11.25],
  kmMarks: Array.from({ length: 24 }, (_, i) => ({ lon: 75.8, lat: 11.12 + i / 1000 })) };
const smart: Overview = { max_deviation_m: 1078.4, overlap_pct: 78.9,
  points: [{ lon: 75.81, lat: 11.15, at_m: 5000 }, { lon: 75.8, lat: 11.18, at_m: 12000 }, { lon: 75.79, lat: 11.22, at_m: 20000 }] };
const never = () => new Promise<never>(() => {});

function open(over: Partial<OpenInProps> = {}) {
  const props: OpenInProps = {
    footM: 24999.99,
    loadPoints: async () => route,
    loadOverview: vi.fn(async () => smart),
    loadGpx: async () => new File(["<gpx/>"], "run.gpx", { type: "application/gpx+xml" }),
    ...over,
  };
  render(<OpenInDialog open onClose={() => {}} {...props} />);
  return props;
}

const link = () => screen.findByTestId("open-google");
const waypoints = async () => new URL((await link()).getAttribute("href")!).searchParams.get("waypoints")!.split("|");
const note = () => screen.getByTestId("open-google-note").textContent;

describe("the sheet's order and words", () => {
  it("GPX, Google Maps, the exact line, then Garmin and Strava", async () => {
    open();
    await link();
    expect([...document.querySelectorAll(".open-in-group")].map((s) => s.getAttribute("aria-label")))
      .toEqual(["GPX file", "Google Maps", "The exact line in Google Maps", "Garmin Connect and Strava"]);
  });

  it("Get GPX is first and the only primary button", async () => {
    open();
    await link();
    const primary = document.querySelectorAll(".btn-primary");
    expect(primary).toHaveLength(1);
    expect(primary[0]!.textContent).toBe("Get GPX (exact route)");
    expect(document.querySelector(".open-in button")).toBe(primary[0]);
    expect(screen.getByTestId("open-gpx-note").textContent)
      .toBe("Open it in Organic Maps or OsmAnd (free, offline maps) to see the exact line.");
  });

  it("Google Maps is an overview, with the note and both numbers carrying the API's values", async () => {
    open();
    expect((await link()).textContent).toBe("Google Maps (overview)");
    await waitFor(() => expect(note()).toBe("Google may re-route between points, so the path and distance can differ. "
      + "Our route: 25.0 km. Estimated overlap: 78% (tested with our router, not Google)."));
    expect(document.querySelector('[data-field="foot_m"]')!.getAttribute("data-value")).toBe("24999.99");
    expect(document.querySelector('[data-field="overlap_pct"]')!.getAttribute("data-value")).toBe("78.9");
  });

  for (const [pct, shown] of [[100, "over 95%"], [99.9, "over 95%"], [95.1, "over 95%"], [95, "95%"], [94.9, "94%"]] as const) {
    it(`${pct} is shown as ${shown}`, async () => {
      open({ loadOverview: async () => ({ ...smart, overlap_pct: pct }) });
      await waitFor(() => expect(note()).toContain(`Estimated overlap: ${shown} (tested`));
      expect(document.querySelector('[data-field="overlap_pct"]')!.getAttribute("data-value")).toBe(String(pct));
    });
  }

  it("the My Maps steps are collapsed and say they need a computer", async () => {
    open();
    await link();
    const steps = screen.getByTestId("open-mymaps") as HTMLDetailsElement;
    expect(steps.open).toBe(false);
    expect(steps.querySelector("summary")!.textContent).toBe("How to see the exact line in Google Maps");
    expect(steps.textContent).toContain("needs a computer");
    expect(steps.querySelectorAll("li")).toHaveLength(6);
    expect(screen.getByTestId("open-mymaps-help").getAttribute("href")).toBe("https://support.google.com/mymaps/answer/3024836");
  });
});

describe("the Google link", () => {
  it("takes the API's points", async () => {
    open();
    await waitFor(async () => expect((await link()).getAttribute("data-points")).toBe("smart"));
    expect(await waypoints()).toEqual(smart.points.map((p) => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`));
  });

  it("works before they arrive, evenly spaced and with no estimate, then switches", async () => {
    let arrive!: (o: Overview) => void;
    open({ loadOverview: () => new Promise<Overview>((r) => { arrive = r; }) });
    expect((await link()).getAttribute("data-points")).toBe("even");
    expect((await waypoints()).length).toBeGreaterThan(0);
    expect(note()).not.toContain("overlap");
    await act(async () => arrive(smart));
    expect((await link()).getAttribute("data-points")).toBe("smart");
    expect(note()).toContain("Estimated overlap");
  });

  for (const [name, failure] of [
    ["Valhalla is down", new ApiFailure(503, "engine_unavailable", "Valhalla is not answering.")],
    ["the limit is hit", new ApiFailure(429, "rate_limited", "Too many read requests.")],
    ["the network fails", new ApiFailure(0, "network", "No answer from GATHO.")],
  ] as const) {
    it(`keeps evenly spaced points, no estimate and no error when ${name}`, async () => {
      open({ loadOverview: () => Promise.reject(failure) });
      expect((await link()).getAttribute("data-points")).toBe("even");
      expect(await waypoints()).toHaveLength(9);        // jsdom is not a mobile browser
      expect(note()).toBe("Google may re-route between points, so the path and distance can differ. Our route: 25.0 km.");
      expect(screen.queryByRole("alert")).toBeNull();
    });
  }

  it("asks for this device's limit: 9 on a computer", async () => {
    const props = open();
    await link();
    expect(props.loadOverview).toHaveBeenCalledWith(9);
  });

  it("asks for 3 on a phone", async () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile Safari/537.36");
    const props = open({ loadOverview: vi.fn(never) });
    expect(await waypoints()).toHaveLength(3);
    expect(props.loadOverview).toHaveBeenCalledWith(3);
  });

  it("a failed GPX leaves the link working", async () => {
    open({ loadGpx: () => Promise.reject(new ApiFailure(500, "x", "The GPX failed.")) });
    expect(await link()).toBeTruthy();
    expect((await screen.findByRole("alert")).textContent).toBe("The GPX failed.");
    expect((screen.getByTestId("open-share") as HTMLButtonElement).disabled).toBe(true);
  });

  it("without the route's points there is no link, and it says why", async () => {
    open({ loadPoints: () => Promise.reject(new ApiFailure(0, "network", "No answer from GATHO.")) });
    expect((await screen.findByRole("alert")).textContent).toBe("No answer from GATHO.");
    expect(screen.queryByTestId("open-google")).toBeNull();
  });
});

describe("Get GPX", () => {
  it("where sharing isn't possible it downloads and says how to open it", async () => {
    const clicked = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    URL.createObjectURL = vi.fn(() => "blob:gpx");
    URL.revokeObjectURL = vi.fn();
    open();
    const button = await screen.findByTestId("open-share");
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);
    const message = await screen.findByTestId("open-message");
    expect(message.textContent).toContain("downloaded instead");
    expect(message.textContent).toContain("open or share it with Organic Maps or OsmAnd");
    expect(clicked).toHaveBeenCalledTimes(1);
  });
});
