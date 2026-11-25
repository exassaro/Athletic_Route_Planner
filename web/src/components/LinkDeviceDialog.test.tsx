/** "Use on another device" (Step 9): the code, the countdown, expiry, "New code", errors. No network. */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlanClient, TOKEN_KEY } from "@/plan/planClient";

let codes: string[] = [];
let answer: () => Response = () => Response.json({ code: codes.shift(), expires_in_s: 300 }, { status: 201 });
const client = () => new PlanClient({
  baseUrl: "http://api.test",
  fetch: (async () => answer()) as typeof globalThis.fetch,
  storage: { getItem: (k) => (k === TOKEN_KEY ? "t" : null), setItem: () => {}, removeItem: () => {} },
});
vi.mock("@/plan/usePlan", () => ({ planClient: () => client() }));

const { LinkDeviceDialog } = await import("./LinkDeviceDialog");

const CODE_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const CODE_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

beforeEach(() => {
  codes = [CODE_A, CODE_B];
  answer = () => Response.json({ code: codes.shift(), expires_in_s: 300 }, { status: 201 });
});
afterEach(cleanup);

async function open(now: () => number = Date.now) {
  const onClose = vi.fn();
  render(<LinkDeviceDialog onClose={onClose} now={now} />);
  await screen.findByTestId("link-url");
  await screen.findByRole("img", { hidden: true });       // the QR code, after its import()
  return { onClose };
}

describe("LinkDeviceDialog", () => {
  it("shows the link with the code in its fragment, a QR code and 5:00", async () => {
    await open();
    const url = (screen.getByTestId("link-url") as HTMLInputElement).value;
    expect(url).toBe(`${window.location.origin}/link#${CODE_A}`);
    expect(screen.getByTestId("link-countdown").textContent).toContain("5:00");
    expect(screen.getByRole("img", { hidden: true }).querySelector("path")!.getAttribute("d")).toMatch(/^M\d/);
  });

  it("counts down, expires, and 'New code' brings a fresh one", async () => {
    let t = 1_000_000;
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      await open(() => t);
      t += 61_000;
      await act(async () => void vi.advanceTimersByTime(1000));
      expect(screen.getByTestId("link-countdown").textContent).toContain("3:59");
      t += 240_000;
      await act(async () => void vi.advanceTimersByTime(1000));
      expect(screen.getByTestId("link-countdown").textContent).toBe("This code has expired.");
      expect((screen.getByTestId("link-url") as HTMLInputElement).value).toBe("");
      expect(screen.queryByTestId("link-copy")).toBeNull();
      fireEvent.click(screen.getByTestId("link-new"));
      await screen.findByDisplayValue(`${window.location.origin}/link#${CODE_B}`);
      expect(screen.getByTestId("link-countdown").textContent).toContain("5:00");
    } finally {
      vi.useRealTimers();
    }
  });

  it("copies the link", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await open();
    await act(async () => void fireEvent.click(screen.getByTestId("link-copy")));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/link#${CODE_A}`);
    expect(screen.getByTestId("link-copy").textContent).toContain("Copied");
  });

  it("says why there is no code, and 'New code' tries again", async () => {
    answer = () => Response.json({ error: "rate_limited", message: "Too many link requests.", detail: null }, { status: 429 });
    render(<LinkDeviceDialog onClose={() => {}} />);
    expect((await screen.findByTestId("link-error")).textContent).toContain("Too many link requests.");
    answer = () => Response.json({ code: CODE_A, expires_in_s: 300 }, { status: 201 });
    fireEvent.click(screen.getByTestId("link-new"));
    await screen.findByDisplayValue(`${window.location.origin}/link#${CODE_A}`);
  });

  it("Esc and Done close it", async () => {
    const { onClose } = await open();
    fireEvent.keyDown(screen.getByTestId("link-dialog"), { key: "Escape" });
    fireEvent.click(screen.getByTestId("link-close"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
