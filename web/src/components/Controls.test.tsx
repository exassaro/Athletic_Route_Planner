/**
 * Component tests (Phase 5 plan, step 8): each control, rendered, reports the edit whose patch is right.
 * The patches themselves are checked in src/plan/edits.test.ts.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import spec from "@/api/openapi.json";
import type { Edit, RouteRequest } from "@/plan/edits";
import { patchFor } from "@/plan/edits";
import { DirectionPicker, DistanceStepper, PathsToggle, RouteTypePicker } from "./Controls";

const ex = (spec as unknown as { paths: Record<string, { post: { responses: Record<string, { content: Record<string,
  { examples: Record<string, { value: { request: RouteRequest } }> }> }> } }> }).paths["/v1/plans"]!.post;
const A01 = ex.responses["201"]!.content["application/json"]!.examples["plan_A01"]!.value.request;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function setup(el: (onEdit: (e: Edit) => void) => React.ReactElement) {
  const edits: Edit[] = [];
  render(el((e) => edits.push(e)));
  return edits;
}

describe("controls", () => {
  it("distance: typing a value and Enter sends one replace of target_distance_m", () => {
    vi.useFakeTimers();
    const edits = setup((onEdit) => <DistanceStepper request={A01} onEdit={onEdit} near={null} live />);
    const box = screen.getByTestId("distance-input");
    fireEvent.change(box, { target: { value: "26" } });
    fireEvent.keyDown(box, { key: "Enter" });
    act(() => void vi.advanceTimersByTime(800));
    expect(edits.map((e) => patchFor(A01, e))).toEqual([[{ op: "replace", path: "/target_distance_m", value: 26000 }]]);
  });

  it("distance: + + + sends one patch; leaving the box unchanged sends nothing", () => {
    vi.useFakeTimers();
    const edits = setup((onEdit) => <DistanceStepper request={A01} onEdit={onEdit} near={null} live />);
    const more = screen.getByRole("button", { name: "1 km more" });
    fireEvent.click(more);
    fireEvent.click(more);
    fireEvent.click(more);
    act(() => void vi.advanceTimersByTime(800));
    expect(edits).toEqual([{ kind: "distance", meters: 28000 }]);
    cleanup();
    const fresh = setup((onEdit) => <DistanceStepper request={A01} onEdit={onEdit} near={null} live />);
    fireEvent.focus(screen.getByTestId("distance-input"));
    fireEvent.blur(screen.getByTestId("distance-input"));     // e.g. tapping a fix button
    act(() => void vi.advanceTimersByTime(800));
    expect(fresh).toEqual([]);
  });

  it("distance: Enter, then leaving the box before the API answers (tapping Done), sends the value once", () => {
    vi.useFakeTimers();
    const edits = setup((onEdit) => <DistanceStepper request={A01} onEdit={onEdit} near={null} live />);
    const box = screen.getByTestId("distance-input");
    fireEvent.change(box, { target: { value: "20" } });
    fireEvent.keyDown(box, { key: "Enter" });
    act(() => void vi.advanceTimersByTime(800));      // the patch is sent; the request still says 25 km
    fireEvent.blur(box);
    act(() => void vi.advanceTimersByTime(800));
    fireEvent.change(box, { target: { value: "20" } });
    fireEvent.blur(box);                               // and again, blur before the timer
    act(() => void vi.advanceTimersByTime(800));
    expect(edits).toEqual([{ kind: "distance", meters: 20000 }]);
  });

  it("route type: loop is a replace; out-and-back is disabled while there are stops", () => {
    const edits = setup((onEdit) => <RouteTypePicker request={A01} onEdit={onEdit} near={null} live />);
    fireEvent.click(screen.getByLabelText("Loop"));
    expect(patchFor(A01, edits[0]!)).toEqual([{ op: "replace", path: "/route_type", value: "loop" }]);
    expect((screen.getByLabelText("Out and back") as HTMLInputElement).disabled).toBe(true);
  });

  it("direction: a compass point is a bearing; Clear removes the direction", () => {
    const edits = setup((onEdit) => <DirectionPicker request={A01} onEdit={onEdit} near={null} live />);
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    fireEvent.click(screen.getByRole("tab", { name: "A direction" }));
    fireEvent.click(screen.getByRole("button", { name: "NE" }));
    expect(edits.map((e) => patchFor(A01, e))).toEqual([
      [{ op: "replace", path: "/direction", value: null }],
      [{ op: "replace", path: "/direction", value: { kind: "bearing", degrees: 45 } }],
    ]);
  });

  it("paths: the toggle flips preferences.paths", () => {
    const edits = setup((onEdit) => <PathsToggle request={A01} onEdit={onEdit} near={null} live />);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(patchFor(A01, edits[0]!)).toEqual([{ op: "replace", path: "/preferences/paths", value: "allow" }]);
  });
});
