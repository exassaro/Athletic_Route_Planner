/** The site footer: About, then the author's three links (src/lib/links.ts), each opening safely in a new tab. */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AUTHOR_LINKS } from "@/lib/links";
import { SiteFooter } from "./SiteFooter";

afterEach(cleanup);

function expectAuthorLinks(): void {
  expect(AUTHOR_LINKS.map((l) => [l.label, l.href])).toEqual([
    ["Website", "https://www.shahinsha.xyz/"],
    ["Instagram", "https://www.instagram.com/databyshahinsha"],
    ["LinkedIn", "https://www.linkedin.com/in/muhshahinshaav/"],
  ]);
  for (const l of AUTHOR_LINKS) {
    const a = screen.getByRole("link", { name: l.ariaLabel });
    expect(a.textContent).toBe(l.label);
    expect(a.getAttribute("href")).toBe(l.href);
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
    expect(l.ariaLabel).toMatch(/opens in a new tab$/);
  }
}

describe("SiteFooter", () => {
  it("keeps the About link and adds the three author links", () => {
    render(<SiteFooter />);
    expect(screen.getByTestId("footer-about").getAttribute("href")).toBe("/about");
    expectAuthorLinks();
    expect(document.querySelectorAll("footer a")).toHaveLength(4);
  });
});
