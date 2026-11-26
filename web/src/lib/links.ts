/**
 * The author's links, in one place: the site footer and the About page both read this list. Plain navigation on
 * click: nothing here is fetched or embedded, so the pages still load nothing from anyone else.
 */
export const AUTHOR = "Shahinsha";

export interface AuthorLink {
  label: string;
  href: string;
  /** Read by screen readers instead of the label: who, where, and that it opens a new tab. */
  ariaLabel: string;
  testId: string;
}

export const AUTHOR_LINKS: readonly AuthorLink[] = [
  { label: "Website", href: "https://www.shahinsha.xyz/", ariaLabel: `${AUTHOR}'s website, opens in a new tab`, testId: "link-website" },
  { label: "Instagram", href: "https://www.instagram.com/databyshahinsha", ariaLabel: `${AUTHOR} on Instagram, opens in a new tab`, testId: "link-instagram" },
  { label: "LinkedIn", href: "https://www.linkedin.com/in/muhshahinshaav/", ariaLabel: `${AUTHOR} on LinkedIn, opens in a new tab`, testId: "link-linkedin" },
];
