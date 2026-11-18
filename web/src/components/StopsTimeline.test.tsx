import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Schemas } from "@/api/client";
import { patchFor, type RouteRequest } from "@/plan/edits";
import { km, metres } from "@/plan/format";
import { moveEdit, StopsTimeline, timelineRows } from "./StopsTimeline";

afterEach(cleanup);

// The API's own A01 example (api/athlete_api/examples/plan_A01.json): request and recommended candidate
const A01 = JSON.parse(readFileSync(join(__dirname, "..", "..", "..", "api", "athlete_api", "examples", "plan_A01.json"), "utf8")).value;
const REQ: RouteRequest = A01.request;
const REC: Schemas["CandidateOut"] = A01.candidates[0];

describe("timelineRows", () => {
  it("follows the route's order and keeps each stop's index in the request", () => {
    const rows = timelineRows(REQ, REC);
    expect(rows.map((r) => r.checkpoint.label)).toEqual(REC.stops!.filter((s) => s.role === "checkpoint").map((s) => s.label));
    expect(rows.map((r) => r.index)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(rows.every((r) => r.at !== null)).toBe(true);
  });

  it("when the route met the stops in another order, shows that order; without a route, the request's", () => {
    const swapped = { ...REC, stops: [REC.stops![0]!, REC.stops![2]!, REC.stops![1]!, ...REC.stops!.slice(3)] };
    const rows = timelineRows(REQ, swapped);
    expect(rows.slice(0, 2).map((r) => r.index)).toEqual([1, 0]);
    expect(timelineRows(REQ, null).map((r) => r.at)).toEqual(Array(6).fill(null));
  });
});

describe("moveEdit", () => {
  it("in the request's own order: the guarded move patch", () => {
    const e = moveEdit(REQ, timelineRows(REQ, REC), 1, 0)!;
    expect(e).toEqual({ kind: "move_checkpoint", from: 1, to: 0, label: REQ.checkpoints![1]!.label });
    expect(patchFor(REQ, e)[0]).toEqual({ op: "test", path: "/checkpoints/1/label", value: REQ.checkpoints![1]!.label });
  });

  it("when the route reordered the stops: the order shown, as my order", () => {
    const swapped = { ...REC, stops: [REC.stops![0]!, REC.stops![2]!, REC.stops![1]!, ...REC.stops!.slice(3)] };
    const e = moveEdit(REQ, timelineRows(REQ, swapped), 2, 0)!;
    expect(e.kind).toBe("restore");
    const req = (e as { request: RouteRequest }).request;
    expect(req.checkpoint_order).toBe("fixed");
    expect(req.checkpoints!.map((c) => c.label).slice(0, 3)).toEqual([REQ.checkpoints![2]!.label, REQ.checkpoints![1]!.label, REQ.checkpoints![0]!.label]);
    expect(moveEdit(REQ, timelineRows(REQ, REC), 0, -1)).toBeNull();
  });
});

describe("StopsTimeline", () => {
  it("start, six stops with the API's distance marks and how the route meets them, end", () => {
    render(<StopsTimeline request={REQ} selected={REC} onEdit={() => {}} toggleReach={() => {}} />);
    const stops = [...document.querySelectorAll("li[data-stop]")];
    expect(stops).toHaveLength(6);
    const chaliyam = document.querySelector('li[data-stop="Chaliyam"]')!;
    const at = REC.stops!.find((s) => s.label === "Chaliyam")!;
    expect(chaliyam.querySelector("[data-field='stops.at_m']")!.textContent).toBe(km(at.at_m));
    if (at.how === "via") expect(chaliyam.textContent).toContain(`${metres(at.pass_walk_m!)} away on foot`);
    expect(chaliyam.textContent).toContain("Pass near");
    expect(document.querySelector(".tl-end")!.textContent).toContain(REC.end.label!);
  });

  it("a stop's options: move, pass near or must reach, remove", () => {
    const onEdit = vi.fn();
    const toggleReach = vi.fn();
    render(<StopsTimeline request={REQ} selected={REC} onEdit={onEdit} toggleReach={toggleReach} />);
    fireEvent.click(screen.getByRole("button", { name: "Options for Kallai" }));
    const dlg = screen.getByTestId("stop-options");
    expect((screen.getByRole("button", { name: "Move later" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /Must reach instead/ }));
    expect(toggleReach).toHaveBeenCalledWith(5);
    fireEvent.click(screen.getByRole("button", { name: "Options for Kallai" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Kallai" }));
    expect(onEdit).toHaveBeenCalledWith({ kind: "remove", list: "checkpoints", index: 5, label: "Kallai" });
    expect(dlg).toBeTruthy();
  });

  it("the stop's node reorders with the arrow keys", () => {
    const onEdit = vi.fn();
    render(<StopsTimeline request={REQ} selected={REC} onEdit={onEdit} toggleReach={() => {}} />);
    fireEvent.keyDown(screen.getByRole("button", { name: /^Stop 2, Kadalundi/ }), { key: "ArrowUp" });
    expect(onEdit).toHaveBeenCalledWith({ kind: "move_checkpoint", from: 1, to: 0, label: "Kadalundi" });
  });
});
