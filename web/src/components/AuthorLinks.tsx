/**
 * The author's links (src/lib/links.ts) as a row of small text links: in the site footer and on the About page.
 * Each opens in a new tab, says so to screen readers, and has a 44 px tap area (CSS `.author-links a`).
 */
import { AUTHOR_LINKS } from "@/lib/links";

export function AuthorLinks({ className }: { className?: string }) {
  return (
    <ul className={className ? `author-links ${className}` : "author-links"}>
      {AUTHOR_LINKS.map((l) => (
        <li key={l.href}>
          <a href={l.href} target="_blank" rel="noopener noreferrer" aria-label={l.ariaLabel} data-testid={l.testId}>
            {l.label}
          </a>
        </li>
      ))}
    </ul>
  );
}
