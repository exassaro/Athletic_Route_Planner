import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // The API's address as the browser sees it. "same-origin": the page's own origin (behind Caddy, Phase 5
  // amendment 9). Unset: the dev API on :8000. Read at build time.
  env: { NEXT_PUBLIC_API_BASE: process.env.NEXT_PUBLIC_API_BASE === "same-origin" ? ""
    : (process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000") },
};

export default config;
