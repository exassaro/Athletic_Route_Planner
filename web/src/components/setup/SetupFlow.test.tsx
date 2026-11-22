import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NewRouteRequest } from "@/api/client";
import { applyToDraft, patchFor, type Edit, type Point, type RouteRequest } from "@/plan/edits";
import { SetupFlow } from "./SetupFlow";

afterEach(cleanup);

type Draft = Omit<NewRouteRequest, "start"> & { start: Point | null };
// Coordinates and id of the A01 start as the API returns them (api/athlete_api/examples/plan_A01.json)
const ATHANIKKAL: Point = { lon: 75.8460689, lat: 11.1209333, label: "Athanikkal", place_id: "osm:node/1770460252" };

function Harness({ onPlan }: { onPlan: (d: Draft) => void }) {
  const [draft, setDraft] = useState<Draft>({ route_type: "point_to_point", start: null, target_distance_m: 10000, direction: null });
  const onEdit = (e: Edit) => setDraft((d) => applyToDraft(d, patchFor(d as RouteRequest, e)));
  const start = <button type="button" onClick={() => onEdit({ kind: "start", point: ATHANIKKAL })}>Choose Athanikkal</button>;
  return <SetupFlow draft={draft} onEdit={onEdit} startControls={start} near={null} solving={false}
    canPlan={!!draft.start && (draft.route_type !== "out_and_back" || !!draft.direction)} onPlan={() => onPlan(draft)} />;
}

const step = () => document.querySelector(".setup")!.getAttribute("data-step");

describe("SetupFlow", () => {
  it("walks start, distance, shape, towards, stops, then plans the draft", () => {
    const onPlan = vi.fn();
    render(<Harness onPlan={onPlan} />);
    expect(step()).toBe("1");
    expect(screen.getByRole("heading", { name: "Where do you start?" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Choose Athanikkal" }));
    expect(step()).toBe("2");                                       // choosing the start moves on
    fireEvent.click(screen.getByRole("button", { name: "25 km" }));
    fireEvent.click(screen.getByTestId("setup-next"));
    expect(step()).toBe("3");
    fireEvent.click(screen.getByRole("radio", { name: /^Loop/ }));
    fireEvent.click(screen.getByTestId("setup-next"));
    expect(step()).toBe("4");
    expect(screen.getByText("(optional)")).toBeTruthy();
    fireEvent.click(screen.getByTestId("setup-skip"));
    expect(step()).toBe("5");
    expect(screen.getByText(/Athanikkal · 25\.0 km · Loop/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(step()).toBe("4");
    fireEvent.click(screen.getByTestId("setup-next"));
    fireEvent.click(screen.getByTestId("plan-button"));
    expect(onPlan).toHaveBeenCalledWith(expect.objectContaining({ start: ATHANIKKAL, target_distance_m: 25000, route_type: "loop" }));
  });

  it("an out-and-back cannot leave the direction step without a direction", () => {
    render(<Harness onPlan={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Choose Athanikkal" }));
    fireEvent.click(screen.getByTestId("setup-next"));
    fireEvent.click(screen.getByRole("radio", { name: /^Out and back/ }));
    fireEvent.click(screen.getByTestId("setup-next"));
    expect(step()).toBe("4");
    expect(screen.getByText("(needed for out and back)")).toBeTruthy();
    expect(screen.queryByTestId("setup-skip")).toBeNull();
    expect((screen.getByTestId("setup-next") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("tab", { name: "A direction" }));
    fireEvent.click(screen.getByRole("button", { name: "North, up on the map" }));
    expect((screen.getByTestId("setup-next") as HTMLButtonElement).disabled).toBe(false);
  });
});
