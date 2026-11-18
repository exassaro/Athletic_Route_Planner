/**
 * Light and dark themes (blueprint Phase 5b amendment 5): a toggle, kept on this device, light by default. The
 * choice is a data-theme attribute on <html>; globals.css holds both token sets. THEME_SCRIPT runs in <head> before
 * first paint, so a dark choice never flashes light. Storage can be missing or throw (private windows, blocked site
 * data): the theme then stays light and nothing breaks.
 */
export type Theme = "light" | "dark";
export const THEME_KEY = "gatho-theme";
export const DEFAULT_THEME: Theme = "light";
/** The browser chrome colour per theme: the paper token of each. */
export const THEME_COLOR: Record<Theme, string> = { light: "#F5F0E6", dark: "#14161A" };
export const THEME_EVENT = "gatho-theme";

function parse(value: string | null): Theme {
  return value === "dark" || value === "light" ? value : DEFAULT_THEME;
}

export function readTheme(): Theme {
  try {
    return parse(window.localStorage.getItem(THEME_KEY));
  } catch {
    return DEFAULT_THEME;
  }
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[theme]);
}

export function saveTheme(theme: Theme) {
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* not kept; still applied for this page */
  }
  applyTheme(theme);
  window.dispatchEvent(new Event(THEME_EVENT));
}

/** Inline in <head>: sets data-theme before the page paints. Kept in step with readTheme and applyTheme. */
export const THEME_SCRIPT = `(function(){var t=${JSON.stringify(DEFAULT_THEME)};try{var s=localStorage.getItem(${JSON.stringify(THEME_KEY)});if(s==="dark"||s==="light")t=s}catch(e){}document.documentElement.dataset.theme=t;var c=${JSON.stringify(THEME_COLOR)};var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",c[t])})()`;
