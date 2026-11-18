"use client";
/** The current theme as React state; re-renders when it changes here or in another tab. */
import { useSyncExternalStore } from "react";
import { applyTheme, DEFAULT_THEME, readTheme, saveTheme, THEME_EVENT, THEME_KEY, type Theme } from "./theme";

function subscribe(onChange: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key === THEME_KEY) {
      applyTheme(readTheme());
      onChange();
    }
  };
  window.addEventListener(THEME_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(THEME_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const theme = useSyncExternalStore(subscribe, readTheme, () => DEFAULT_THEME);
  return [theme, saveTheme];
}

