/** The saved card's menu (Phase 5c amendment 11). */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CardMenu, type MenuItem } from "./CardMenu";

afterEach(cleanup);

function setup() {
  const picked = vi.fn();
  const item = (label: string, icon: MenuItem["icon"], danger?: boolean): MenuItem => ({ label, icon, danger, onSelect: () => picked(label) });
  render(<CardMenu label="More for Coast run" items={[item("Rename", "edit"), item("Open in…", "externalLink"),
    item("Download GPX", "download"), item("Delete", "trash", true)]} />);
  const toggle = screen.getByRole("button", { name: "More for Coast run" });
  return { picked, toggle };
}

describe("CardMenu", () => {
  it("opens on its first item, Delete last, in the danger colour after a divider", () => {
    const { toggle } = setup();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const items = screen.getAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual(["Rename", "Open in…", "Download GPX", "Delete"]);
    expect(document.activeElement).toBe(items[0]);
    expect(items[3]!.className).toContain("danger");
    expect(screen.getByRole("separator").nextElementSibling).toBe(items[3]);
  });

  it("the arrows, Home and End move round", () => {
    const { toggle } = setup();
    fireEvent.click(toggle);
    const items = screen.getAllByRole("menuitem");
    const press = (key: string) => fireEvent.keyDown(document.activeElement!, { key });
    press("ArrowUp");
    expect(document.activeElement).toBe(items[3]);
    press("ArrowDown");
    expect(document.activeElement).toBe(items[0]);
    press("End");
    expect(document.activeElement).toBe(items[3]);
    press("Home");
    expect(document.activeElement).toBe(items[0]);
  });

  it("Esc closes and returns the focus", () => {
    const { toggle, picked } = setup();
    fireEvent.click(toggle);
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(toggle);
    expect(picked).not.toHaveBeenCalled();
  });

  it("a press outside closes it", () => {
    const { toggle } = setup();
    fireEvent.click(toggle);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("picking runs the action and closes", () => {
    const { toggle, picked } = setup();
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(picked).toHaveBeenCalledWith("Delete");
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
