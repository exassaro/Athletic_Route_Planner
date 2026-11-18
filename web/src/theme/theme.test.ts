import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_THEME, readTheme, saveTheme, THEME_COLOR, THEME_KEY, THEME_SCRIPT } from "./theme";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  document.head.innerHTML = "";
});

describe("theme", () => {
  it("is light by default", () => {
    expect(DEFAULT_THEME).toBe("light");
    expect(readTheme()).toBe("light");
  });

  it("reads a kept choice and ignores anything else", () => {
    localStorage.setItem(THEME_KEY, "dark");
    expect(readTheme()).toBe("dark");
    localStorage.setItem(THEME_KEY, "purple");
    expect(readTheme()).toBe("light");
  });

  it("stays light when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(readTheme()).toBe("light");
  });

  it("saving applies the theme, keeps it, and sets the browser colour", () => {
    document.head.innerHTML = '<meta name="theme-color" content="">';
    saveTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem(THEME_KEY)).toBe("dark");
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute("content")).toBe(THEME_COLOR.dark);
  });

  it("saving still applies the theme when storage throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    saveTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("the head script sets the same theme as readTheme", () => {
    for (const stored of [null, "dark", "light", "nonsense"]) {
      localStorage.clear();
      if (stored) localStorage.setItem(THEME_KEY, stored);
      new Function(THEME_SCRIPT)();
      expect(document.documentElement.dataset.theme).toBe(readTheme());
    }
  });
});
