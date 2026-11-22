/** The delete's Undo message and its 10 seconds (Phase 5c amendment 12). */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { newDeleted, takeDeleted } from "@/saved/deleted";
import { DeletedMessage } from "./DeletedMessage";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  sessionStorage.clear();
});

function show() {
  vi.useFakeTimers();
  const onGone = vi.fn();
  const onUndo = vi.fn();
  render(<DeletedMessage deleted={newDeleted("s1", "Coast run")} onUndo={onUndo} onGone={onGone} />);
  return { onGone, onUndo, box: screen.getByTestId("deleted-toast").parentElement! };
}

const pass = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

describe("DeletedMessage", () => {
  it("says it and offers Undo for 10 seconds", () => {
    const { onGone, onUndo } = show();
    expect(screen.getByTestId("deleted-toast").textContent).toContain("Deleted Coast run. Its share link stopped working.");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(onUndo).toHaveBeenCalled();
    pass(9999);
    expect(onGone).not.toHaveBeenCalled();
    pass(1);
    expect(onGone).toHaveBeenCalled();
  });

  it("waits while it has the pointer or the focus, then goes on from where it was", () => {
    const { onGone, box } = show();
    pass(6000);
    fireEvent.pointerEnter(box);
    pass(60_000);
    fireEvent.pointerLeave(box);
    pass(3000);
    act(() => screen.getByRole("button", { name: "Undo" }).focus());
    pass(60_000);
    expect(onGone).not.toHaveBeenCalled();
    act(() => screen.getByRole("button", { name: "Undo" }).blur());
    pass(1000);
    expect(onGone).toHaveBeenCalled();
  });

  it("is there for the next page until its time is up", () => {
    show();
    pass(4000);
    expect(takeDeleted()).toMatchObject({ savedId: "s1", name: "Coast run", msLeft: 6000 });
    pass(7000);
    expect(takeDeleted()).toBeNull();
  });
});
