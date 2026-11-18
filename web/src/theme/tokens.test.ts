/**
 * The colour tokens in globals.css meet the contrast rules in both themes (blueprint Phase 5b amendments 4, 10):
 * text 4.5:1 or more, controls, focus rings and the route colour 3:1 or more. The pairs are the ones the UI draws.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no ${selector} block`);
  const body = css.slice(start, css.indexOf("}", start));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[0-9A-Fa-f]{6});/g)].map((m) => [m[1]!, m[2]!]));
}

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

export function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const TEXT: [string, string][] = [
  ["ink", "paper"], ["ink", "surface"], ["ink", "soft"], ["ink", "accent-soft"], ["ink", "warn-soft"],
  ["muted", "paper"], ["muted", "surface"], ["muted", "soft"],
  ["accent-text", "paper"], ["accent-text", "surface"],
  ["on-accent", "accent"],
  ["warn", "surface"], ["warn", "paper"], ["warn", "warn-soft"],
  ["snack-fg", "snack-bg"], ["snack-action", "snack-bg"],
  ["paper", "ink"],
];
const NON_TEXT: [string, string][] = [
  ["control", "surface"], ["control", "paper"], ["focus", "surface"], ["focus", "paper"], ["accent", "surface"], ["accent", "paper"],
];

const THEMES = { light: block(':root, [data-theme="light"]'), dark: block('[data-theme="dark"]') };

describe("colour tokens", () => {
  it("both themes define the same tokens", () => {
    expect(Object.keys(THEMES.dark).sort()).toEqual(Object.keys(THEMES.light).sort());
    expect(THEMES.light.accent).toBe("#0F6E56");
  });

  for (const [name, t] of Object.entries(THEMES)) {
    it(`${name}: text pairs are 4.5:1 or more`, () => {
      for (const [fg, bg] of TEXT) expect(contrast(t[fg]!, t[bg]!), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    });
    it(`${name}: controls, focus and accent are 3:1 or more`, () => {
      for (const [fg, bg] of NON_TEXT) expect(contrast(t[fg]!, t[bg]!), `${fg} on ${bg}`).toBeGreaterThanOrEqual(3);
    });
  }
});
