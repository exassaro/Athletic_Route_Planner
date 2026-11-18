import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Badge, Button, Chip, Icon, IconButton, Snackbar } from ".";

afterEach(cleanup);

describe("base components", () => {
  it("Button: type=button by default; primary carries the hard-shadow class; the icon is decorative", () => {
    render(<Button variant="primary" icon="bookmark">Save</Button>);
    const b = screen.getByRole("button", { name: "Save" });
    expect(b.getAttribute("type")).toBe("button");
    expect(b.className).toContain("btn-primary");
    expect(b.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("Button passes through attributes and disabled", () => {
    const onClick = vi.fn();
    render(<Button data-testid="plan-button" disabled onClick={onClick}>Plan my run</Button>);
    const b = screen.getByTestId("plan-button");
    fireEvent.click(b);
    expect(onClick).not.toHaveBeenCalled();
    expect(b.className).toContain("btn-secondary");
  });

  it("IconButton is named by its label", () => {
    render(<IconButton icon="menu" label="Menu" />);
    expect(screen.getByRole("button", { name: "Menu" })).toBeTruthy();
  });

  it("Chip: pressed state and attention", () => {
    render(<><Chip aria-pressed>Loop</Chip><Chip attention data-chip="distance">20.0 km</Chip></>);
    expect(screen.getByRole("button", { name: "Loop" }).getAttribute("aria-pressed")).toBe("true");
    const d = screen.getByRole("button", { name: "20.0 km" });
    expect(d.className).toContain("chip-attention");
    expect(d.getAttribute("data-chip")).toBe("distance");
  });

  it("Badge: words plus an icon; a button only when it opens a detail", () => {
    const onClick = vi.fn();
    render(<><Badge testId="b1">Ends mid-road</Badge><Badge tone="warn" onClick={onClick} expanded={false} testId="b2">Uses a national highway</Badge></>);
    expect(screen.getByTestId("b1").tagName).toBe("SPAN");
    expect(screen.getByTestId("b1").querySelector("svg")).toBeTruthy();
    const b2 = screen.getByRole("button", { name: "Uses a national highway" });
    expect(b2.className).toBe("badge-hit");
    expect(b2.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(b2);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("Snackbar: a status message with its action and a dismiss button, no timer", () => {
    vi.useFakeTimers();
    const onAction = vi.fn();
    const onDismiss = vi.fn();
    render(<Snackbar actionLabel="Undo" onAction={onAction} onDismiss={onDismiss} testId="diff-toast">−2.7 km, new end</Snackbar>);
    vi.advanceTimersByTime(60_000);
    expect(screen.getByRole("status").textContent).toContain("−2.7 km, new end");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onAction).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("Icon renders the generated path on the 24 px grid", () => {
    const { container } = render(<Icon name="search" />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(svg.querySelector("path")?.getAttribute("d")).toMatch(/^M22 22h-2/);
  });
});
