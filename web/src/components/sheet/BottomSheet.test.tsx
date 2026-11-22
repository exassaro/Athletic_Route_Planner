import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BottomSheet, nextSnap, snapAfterDrag, type Snap } from "./BottomSheet";

afterEach(cleanup);

const H: Record<Snap, number> = { peek: 136, half: 422, full: 780 };

describe("the banner", () => {
  it("is part of the sheet, outside its scrolling body, and focusing it does not open a peeked sheet", () => {
    const onSnap = vi.fn();
    const { container } = render(
      <BottomSheet snap="peek" onSnap={onSnap} label="Run" banner={<button type="button">Undo</button>}>
        <button type="button">Inside</button>
      </BottomSheet>,
    );
    const undo = screen.getByRole("button", { name: "Undo" });
    expect(undo.closest(".sheet")).not.toBeNull();
    expect(container.querySelector(".sheet-body")!.contains(undo)).toBe(false);
    fireEvent.focusIn(undo);
    expect(onSnap).not.toHaveBeenCalled();
    fireEvent.focusIn(screen.getByRole("button", { name: "Inside" }));
    expect(onSnap).toHaveBeenCalledWith("half");
  });
});

describe("snapAfterDrag", () => {
  it("settles on the nearest position when let go slowly", () => {
    expect(snapAfterDrag("half", 150, 0, H)).toBe("peek");
    expect(snapAfterDrag("half", 500, 0.1, H)).toBe("half");
    expect(snapAfterDrag("peek", 700, -0.2, H)).toBe("full");
  });
  it("a flick moves one position in its direction, and stops at the ends", () => {
    expect(snapAfterDrag("half", 430, -0.8, H)).toBe("full");
    expect(snapAfterDrag("half", 410, 0.8, H)).toBe("peek");
    expect(snapAfterDrag("full", 760, -2, H)).toBe("full");
    expect(snapAfterDrag("peek", 140, 2, H)).toBe("peek");
  });
});

describe("BottomSheet", () => {
  it("tap cycles peek, half, full, peek", () => {
    expect(["peek", "half", "full"].map((s) => nextSnap(s as Snap))).toEqual(["half", "full", "peek"]);
    const onSnap = vi.fn();
    render(<BottomSheet snap="half" onSnap={onSnap} label="Plan your run"><p>body</p></BottomSheet>);
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(onSnap).toHaveBeenLastCalledWith("full");
    expect(screen.getByRole("region", { name: "Plan your run" }).className).toBe("sheet half");
  });

  it("arrow keys go up and down, and stop at the ends", () => {
    const onSnap = vi.fn();
    const { rerender } = render(<BottomSheet snap="half" onSnap={onSnap} label="Sheet"><p>body</p></BottomSheet>);
    const handle = screen.getByRole("button", { name: "Show more" });
    fireEvent.keyDown(handle, { key: "ArrowUp" });
    fireEvent.keyDown(handle, { key: "ArrowDown" });
    expect(onSnap.mock.calls).toEqual([["full"], ["peek"]]);
    rerender(<BottomSheet snap="full" onSnap={onSnap} label="Sheet"><p>body</p></BottomSheet>);
    fireEvent.keyDown(screen.getByRole("button", { name: "Show the map" }), { key: "ArrowUp" });
    expect(onSnap).toHaveBeenCalledTimes(2);
  });

  it("focus moving into a peeked sheet opens it to half; the handle itself does not", () => {
    const onSnap = vi.fn();
    render(<BottomSheet snap="peek" onSnap={onSnap} label="Sheet"><button type="button">Inside</button></BottomSheet>);
    fireEvent.focus(screen.getByRole("button", { name: "Show more" }));
    expect(onSnap).not.toHaveBeenCalled();
    fireEvent.focus(screen.getByRole("button", { name: "Inside" }));
    expect(onSnap).toHaveBeenCalledWith("half");
  });
});
