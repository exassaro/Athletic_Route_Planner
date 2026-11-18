"use client";
/** Light or dark (blueprint Phase 5b amendment 5). Lives in the menu from step 8; until then, on the planner and About. */
import { useEffect } from "react";
import { applyTheme, type Theme } from "./theme";
import { useTheme } from "./useTheme";

const OPTIONS: { value: Theme; label: string }[] = [{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }];

export function ThemeToggle() {
  const [theme, setTheme] = useTheme();
  useEffect(() => applyTheme(theme), [theme]);   // also sets the theme-color meta, which the head script may miss
  return (
    <div className="theme-toggle" role="group" aria-label="Theme" data-testid="theme-toggle">
      <span className="field-label">Theme</span>
      <div className="row">
        {OPTIONS.map((o) => (
          <button key={o.value} type="button" aria-pressed={theme === o.value} onClick={() => setTheme(o.value)}
            data-theme-option={o.value}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
