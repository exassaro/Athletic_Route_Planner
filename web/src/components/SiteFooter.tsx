/**
 * The small footer of the plain pages (saved routes, link, share): what GATHO keeps and the credits are on About
 * (Step 9 item 8). The planner, a full-screen map, has the same link in its menu.
 */
import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="site-footer t-meta">
      <Link href="/about" data-testid="footer-about">About and privacy</Link>
    </footer>
  );
}
