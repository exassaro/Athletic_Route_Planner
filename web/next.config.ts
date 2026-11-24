import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // NEXT_DIST_DIR=.next-check builds beside a running `next start` (which keeps serving .next) without breaking it.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // NEXT_PUBLIC_SITE_URL (read at build time): the public address, for absolute OpenGraph links (Phase 5b amendment 28).
  // The API's address as the browser sees it. "same-origin": the page's own origin (behind Caddy, Phase 5
  // amendment 9). Unset: the dev API on :8000. Read at build time.
  env: { NEXT_PUBLIC_API_BASE: process.env.NEXT_PUBLIC_API_BASE === "same-origin" ? ""
    : (process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000") },
  // Phase 5b amendment 12: Chrome on Windows corrupts cached Range responses (zero-filled bodies, "Wrong magic
  // number for PMTiles archive"), so the archive is never stored. no-cache is not enough: it still stores them.
  // This covers the archive only where Next serves it (development, the LAN Caddy). With NEXT_PUBLIC_BASEMAP_ORIGIN
  // set, the basemap's own server must send it (web/README.md, "Split origin").
  async headers() {
    return [{ source: "/basemap/kerala.pmtiles", headers: [{ key: "Cache-Control", value: "no-store" }] }];
  },
  // Testing only: NEXT_API_PROXY=http://localhost:8000 (with NEXT_PUBLIC_API_BASE=same-origin) forwards /v1/* to the
  // API, so a build on another port is same-origin and needs no CORS entry. Read at build time. Unset in production,
  // where Caddy does this.
  async rewrites() {
    const proxy = process.env.NEXT_API_PROXY;
    return proxy ? [{ source: "/v1/:path*", destination: `${proxy.replace(/\/$/, "")}/v1/:path*` }] : [];
  },
};

export default config;
