import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RouteRequest } from "@/plan/edits";
import { EditorDialog } from "./EditorDialog";
import { PlanChips } from "./PlanChips";

afterEach(cleanup);

// The API's own A01 request (api/athlete_api/examples)
const A01: RouteRequest = JSON.parse(readFileSync(join(__dirname, "..", "..", "..", "api", "athlete_api", "examples", "plan_A01.json"), "utf8")).value.request;

describe("PlanChips", () => {
  it("one chip per constraint of the request, each a button that opens it", () => {
    const onOpen = vi.fn();
    render(<PlanChips request={A01} attention={["distance"]} onOpen={onOpen} />);
    const keys = [...document.querySelectorAll("[data-chip]")].map((e) => e.getAttribute("data-chip"));
    expect(keys).toEqual(["start", "distance", "type", "direction", "stops", "paths"]);
    expect(screen.getByRole("button", { name: "From Athanikkal" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "6 stops" })).toBeTruthy();
    const distance = document.querySelector('[data-chip="distance"] button')!;
    expect(distance.className).toContain("chip-attention");
    expect(distance.querySelector("[data-value]")?.getAttribute("data-value")).toBe(String(A01.target_distance_m));
    fireEvent.click(screen.getByRole("button", { name: "Towards Kozhikode" }));
    expect(onOpen).toHaveBeenCalledWith("direction");
  });

  it("an unset direction and no stops still have chips to add them", () => {
    const bare = { ...A01, direction: null, checkpoints: [] } as RouteRequest;
    render(<PlanChips request={bare} onOpen={() => {}} />);
    expect(screen.getByRole("button", { name: "Any direction" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Stops" })).toBeTruthy();
  });
});

describe("EditorDialog", () => {
  it("shows its title and content when open; Done, Close and Escape all close it", () => {
    const onClose = vi.fn();
    const { rerender } = render(<EditorDialog open title="Distance" onClose={onClose} testId="chip-editor"><p>stepper</p></EditorDialog>);
    const dlg = screen.getByTestId("chip-editor");
    expect(dlg.hasAttribute("open")).toBe(true);
    expect(screen.getByRole("heading", { name: "Distance" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent(dlg, new Event("cancel", { cancelable: true }));
    expect(onClose).toHaveBeenCalledTimes(3);
    rerender(<EditorDialog open={false} title="Distance" onClose={onClose} testId="chip-editor"><p>stepper</p></EditorDialog>);
    expect(dlg.hasAttribute("open")).toBe(false);
    expect(screen.queryByText("stepper")).toBeNull();
  });
});
