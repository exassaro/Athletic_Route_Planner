"use client";
import { useEffect } from "react";
import { applyTheme, readTheme } from "./theme";

/**
 * Applies the saved theme once React is running. Normally the head script has done it before first paint, but
 * Next serves a notFound() page (a dead share link) as a shell that React fills in, and that script never runs.
 */
export function ThemeSync() {
  useEffect(() => applyTheme(readTheme()), []);
  return null;
}
