/**
 * The small footer of the plain pages (saved routes, link, share): what GATHO keeps and the credits are on About
 * (Step 9 item 8), then the author's links (src/lib/links.ts). The planner, a full-screen map, has the About link
 * in its menu.
 */
import Link from "next/link";
import { AuthorLinks } from "./AuthorLinks";

export function SiteFooter() {
  return (
    <footer className="site-footer t-meta">
      <Link href="/about" data-testid="footer-about">About and privacy</Link>
      <AuthorLinks />
    </footer>
  );
}
