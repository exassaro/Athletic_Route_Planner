import type { MetadataRoute } from "next";

/** PWA manifest (Phase 5): installable; no offline mode yet. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Athlete Router",
    short_name: "Athlete Router",
    description: "Running routes that are the distance you asked for, through the places you choose.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#0f6b4f",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
