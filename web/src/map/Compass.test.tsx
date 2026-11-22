/** The compass follows the map, marks a direction, and faces north on a tap (amendment 19). */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Compass } from "./Compass";

afterEach(cleanup);

describe("Compass", () => {
  it("the needle stays on true north, the mark on its direction, and a tap resets the map", () => {
    let bearing = 0;
    let rotated = () => {};
    const easeTo = vi.fn();
    const map = { getBearing: () => bearing, on: (_: string, f: () => void) => { rotated = f; }, off: () => {}, easeTo };
    render(<Compass map={map as never} pointing={135} />);
    act(() => {
      bearing = 30;
      rotated();
    });
    expect(document.querySelector("[data-needle]")!.getAttribute("transform")).toBe("rotate(-30 11.5 11.5)");
    expect(screen.getByTestId("compass-direction").getAttribute("transform")).toBe("rotate(105 11.5 11.5)");
    fireEvent.click(screen.getByRole("button", { name: "Compass, tap to face north" }));
    expect(easeTo).toHaveBeenCalledWith({ bearing: 0, pitch: 0 });
  });

  it("no mark unless a direction is being picked", () => {
    render(<Compass map={null} />);
    expect(screen.queryByTestId("compass-direction")).toBeNull();
  });
});
