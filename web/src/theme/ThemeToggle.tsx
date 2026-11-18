"use client";
/** Light or dark (blueprint Phase 5b amendment 5). Lives in the menu from step 8; until then, on the planner and About. */
import { useEffect } from "react";
import { Chip } from "@/components/ui";
import { applyTheme, type Theme } from "./theme";
import { useTheme } from "./useTheme";

const OPTIONS = [{ value: "light", label: "Light", icon: "sun" }, { value: "dark", label: "Dark", icon: "moon" }] as const satisfies
  readonly { value: Theme; label: string; icon: "sun" | "moon" }[];

export function ThemeToggle() {
  const [theme, setTheme] = useTheme();
  useEffect(() => applyTheme(theme), [theme]);   // also sets the theme-color meta, which the head script may miss
  return (
    <div className="theme-toggle" role="group" aria-labelledby="theme-label" data-testid="theme-toggle">
      <span className="field-label" id="theme-label">Theme</span>
      <div className="row">
        {OPTIONS.map((o) => (
          <Chip key={o.value} icon={o.icon} aria-pressed={theme === o.value} onClick={() => setTheme(o.value)} data-theme-option={o.value}>
            {o.label}
          </Chip>
        ))}
      </div>
    </div>
  );
}
