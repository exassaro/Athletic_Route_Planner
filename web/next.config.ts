import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // The API's address as the browser sees it. Empty: same origin (production behind Caddy, Phase 5 amendment 9).
  env: { NEXT_PUBLIC_API_BASE: process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000" },
};

export default config;
