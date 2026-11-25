/** The planner's status line (Step 9 amendment 7): every busy and error state says something, never blank. */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiFailure, TOO_LONG_MESSAGE, UNAVAILABLE_MESSAGE } from "@/plan/planClient";
import type { Busy } from "@/plan/usePlan";

vi.mock("@/plan/usePlan", async (orig) => ({ ...(await orig<object>()) }));
const { StatusLine } = await import("./Planner");

afterEach(cleanup);

function show(busy: Busy) {
  const onDismiss = vi.fn();
  const onCancel = vi.fn();
  render(<StatusLine busy={busy} onDismiss={onDismiss} onCancel={onCancel} />);
  return { onDismiss, onCancel, text: () => screen.getByTestId("status").textContent ?? "" };
}

describe("StatusLine", () => {
  it("solver_busy: counts down every second and can be cancelled", async () => {
    vi.useFakeTimers();
    try {
      const { text, onCancel } = show({ kind: "busy", reason: "solver_busy", retryInS: 5, attempt: 1, until: Date.now() + 5000 });
      expect(text()).toContain("Lots of runners planning right now. Retrying in 5 seconds.");
      await act(async () => void vi.advanceTimersByTime(2000));
      expect(text()).toContain("Retrying in 3 seconds");
      await act(async () => void vi.advanceTimersByTime(2000));
      expect(text()).toContain("Retrying in 1 second.");
      fireEvent.click(screen.getByTestId("status-cancel"));
      expect(onCancel).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a later try says which", () => {
    const { text } = show({ kind: "busy", reason: "solver_busy", retryInS: 4, attempt: 2, until: Date.now() + 4000 });
    expect(text()).toMatch(/try 3 of 4/);
  });

  it.each([
    ["rate_limited", new ApiFailure(429, "rate_limited", "Too many plans in a short time. Wait 42 seconds, then try again."),
      "Wait 42 seconds"],
    ["503", new ApiFailure(503, "engine_unavailable", UNAVAILABLE_MESSAGE), "Planning is temporarily unavailable"],
    ["504", new ApiFailure(504, "solve_timeout", TOO_LONG_MESSAGE), "try a shorter distance"],
    ["offline", new ApiFailure(0, "network", "No answer from GATHO. Check your connection."), "Check your connection"],
  ])("%s: an alert with the reason and OK", (_, error, says) => {
    const { onDismiss } = show({ kind: "error", error });
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain(says);
    expect(alert.dataset.error).toBe(error.code);
    expect(screen.queryByTestId("status-cancel")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("a slow solve is still being worked on", () => {
    const { text } = show({ kind: "waiting", reason: "solve_timeout" });
    expect(text()).toContain("taking longer than usual");
  });
});
