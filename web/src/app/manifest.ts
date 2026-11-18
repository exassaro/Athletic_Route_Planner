import type { MetadataRoute } from "next";
import { THEME_COLOR } from "@/theme/theme";

/** PWA manifest (Phase 5; GATHO, Phase 5b amendments 1 and 7): installable; no offline mode yet. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "GATHO",
    short_name: "GATHO",
    description: "Running routes that are the distance you asked for, through the places you choose.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: THEME_COLOR.light,
    theme_color: THEME_COLOR.light,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
