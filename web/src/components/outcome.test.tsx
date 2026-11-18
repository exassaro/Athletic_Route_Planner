import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { km } from "@/plan/format";
import { orList, OutcomePanel } from "./OutcomePanel";
import { TopBar } from "./TopBar";

afterEach(cleanup);

// The API's own examples (api/athlete_api/examples): A01 at 20 km (over_budget) and G01 (a conflict)
const ex = (name: string) => JSON.parse(readFileSync(join(__dirname, "..", "..", "..", "api", "athlete_api", "examples", name), "utf8")).value;
const OVER = ex("plan_A01_20km.json");
const G01 = ex("plan_G01.json");

describe("OutcomePanel", () => {
  it("over_budget: one headline with the API's numbers, then the fixes; the solver's sentence is not repeated", () => {
    const onPatch = vi.fn();
    render(<OutcomePanel version={OVER} onPatch={onPatch} disabled={false} />);
    const c = OVER.conflict;
    const panel = screen.getByTestId("outcome");
    expect(screen.getByRole("heading").textContent).toBe(`Your stops need ${km(c.minimum_m)}`);
    expect(panel.textContent).toContain(`${km(c.overshoot_m)} over your ${km(c.requested_m)}.`);
    expect(panel.textContent).not.toContain(c.message);
    const fix = screen.getByTestId("fix-set_distance");
    fireEvent.click(fix);
    expect(onPatch).toHaveBeenCalledWith(c.fixes.find((f: { action: string }) => f.action === "set_distance").patch);
    const helps = c.savings.filter((s: { saves_m: number }) => s.saves_m > 0).map((s: { label: string }) => s.label);
    for (const label of helps) expect(screen.getByTestId(`saving-${label}`).textContent).toContain("then fits");
    // the stops whose dropping does not help, in one sentence, and no drop button offered twice
    const none = c.savings.filter((s: { saves_m: number }) => s.saves_m <= 0).map((s: { label: string }) => s.label);
    expect(panel.textContent).toContain(`Dropping ${orList(none)} doesn't shorten the run.`);
    expect(screen.queryByTestId(`fix-drop_checkpoint-${helps[0]}`)).toBeNull();
  });

  it("a conflict: a fixed title, the solver's sentence with its numbers, and every fix", () => {
    render(<OutcomePanel version={G01} onPatch={() => {}} disabled={false} />);
    expect(screen.getByRole("heading").textContent).toBe("A stop is too far for a loop of this distance");
    expect(screen.getByTestId("conflict-message").textContent).toBe(G01.conflict.message);
    expect(screen.getByTestId("fix-set_distance").textContent).toBe(`Change to ${km(G01.conflict.fixes[0].value_m)}`);
    expect(screen.getByTestId("fix-drop_checkpoint-Feroke")).toBeTruthy();
  });

  it("orList", () => {
    expect([orList(["A"]), orList(["A", "B"]), orList(["A", "B", "C"])]).toEqual(["A", "A or B", "A, B or C"]);
  });
});

describe("TopBar", () => {
  it("search on route screens, the wordmark during setup; the menu opens its content", () => {
    const { rerender } = render(<TopBar setupMode={false} near={null} canAddStop onPlace={() => {}} menu={<p>menu content</p>} />);
    expect(screen.getByRole("button", { name: "Search a place" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Menu" }));
    expect(screen.getByText("menu content")).toBeTruthy();
    rerender(<TopBar setupMode near={null} canAddStop={false} onPlace={() => {}} menu={<p>menu content</p>} />);
    expect(screen.queryByRole("button", { name: "Search a place" })).toBeNull();
    expect(document.querySelector(".topbar-brand")!.textContent).toBe("GATHO");
  });
});
