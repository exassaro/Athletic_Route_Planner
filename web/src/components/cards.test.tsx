import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Schemas } from "@/api/client";
import { flagText } from "@/plan/flags";
import { km, metres, runningTime } from "@/plan/format";
import { CandidateCard } from "./CandidateCard";
import { PeekBar } from "./PeekBar";
import { settledIndex } from "./RouteCards";
import { StatNumber } from "./StatNumber";

afterEach(cleanup);

// The API's own A01 example (api/athlete_api/examples, built from real solver output)
const A01 = JSON.parse(readFileSync(join(__dirname, "..", "..", "..", "api", "athlete_api", "examples", "plan_A01.json"), "utf8")).value;
const REC: Schemas["CandidateOut"] = A01.candidates[0];

describe("StatNumber", () => {
  it("its text is the formatted value; the digits are pixel, the units sans", () => {
    for (const [kind, v, want] of [["km", 24999.99, km(24999.99)], ["m", 106.5, metres(106.5)],
      ["time", 24999.99, runningTime(24999.99, 360)], ["time", 8000, runningTime(8000, 360)]] as const) {
      const { container, unmount } = render(<StatNumber kind={kind} value={v} field="f" pace={360} />);
      const el = container.querySelector("[data-value]")!;
      expect(el.textContent).toBe(want);
      expect(el.getAttribute("data-value")).toBe(String(v));
      expect([...el.querySelectorAll("[class^=t-stat]")].map((e) => e.textContent).join("")).toMatch(/^[\d.]+$/);
      unmount();
    }
  });
});

describe("PeekBar", () => {
  it("shows distance, time at the pace and climb from the API", () => {
    render(<PeekBar cand={REC} pace={360} />);
    const bar = screen.getByTestId("summary");
    expect(bar.textContent).toContain(km(REC.foot_m));
    expect(bar.textContent).toContain(runningTime(REC.foot_m, 360));
    expect(bar.textContent).toContain(metres(REC.gain_m!));
    expect(bar.textContent).toContain("approx.");
  });
});

describe("CandidateCard", () => {
  it("keeps the test ids, shows the numbers once, and opens a flag's API detail on tap", () => {
    const onSelect = vi.fn();
    render(<CandidateCard cand={REC} index={0} total={4} selected pace={360} target={25000} onSelect={onSelect} onWhy={() => {}} />);
    const card = screen.getByTestId(`card-${REC.label}-${REC.option}`);
    expect(card.querySelector("[data-field=foot_m]")!.textContent).toBe("25.0 km");
    expect(card.className).toContain("selected");
    const flag = flagText(REC.flags![0]!);
    const badge = screen.getByRole("button", { name: flag.short });
    expect(screen.queryByText(flag.detail, { exact: false })).toBeNull();
    fireEvent.click(badge);
    expect(screen.getByText(flag.detail, { exact: false })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Recommended/ }));
    expect(onSelect).toHaveBeenCalledOnce();
    const why = screen.getByRole("button", { name: "Why this route?" });
    expect(why.getAttribute("aria-expanded")).toBe("false");
    expect(why.hasAttribute("aria-controls")).toBe(false);   // only while the explanation exists
  });

  it("every flag has a short badge label of a few words and no digits", () => {
    for (const code of ["uses_national_highway", "endpoint_mid_road", "lengthened", "short_of_budget", "repeated_edges"]) {
      const t = flagText({ code, message: "m", data: {} } as unknown as Schemas["Flag"]);
      expect(t.short.split(" ").length, code).toBeLessThanOrEqual(3);
      expect(t.short, code).not.toMatch(/\d/);
    }
  });
});

describe("settledIndex", () => {
  it("is the card nearest the row's centre", () => {
    const cards = [0, 312, 624, 936].map((left) => ({ left, width: 300 }));
    expect(settledIndex(0, 358, cards)).toBe(0);
    expect(settledIndex(300, 358, cards)).toBe(1);
    expect(settledIndex(900, 358, cards)).toBe(3);
  });
});
