/** About and privacy (Step 9 item 8): what is kept, linking, share links, deleting, credits, contact from env. */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AUTHOR_LINKS } from "@/lib/links";
import AboutPage from "./page";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("About", () => {
  it("says what is kept, in plain words", () => {
    render(<AboutPage />);
    const text = document.body.textContent ?? "";
    for (const said of ["random token in this browser", "routes you save", "Nothing sold, no ads, no third-party trackers",
      "Use on another device", "Share links are public", "Delete", "OpenStreetMap contributors", "Protomaps"]) {
      expect(text).toContain(said);
    }
    expect(screen.getAllByRole("link", { name: "Saved routes" })[0]!.getAttribute("href")).toBe("/routes");
  });

  it("shows a contact address only when NEXT_PUBLIC_CONTACT_EMAIL is set", () => {
    render(<AboutPage />);
    expect(screen.queryByTestId("about-contact")).toBeNull();
    cleanup();
    vi.stubEnv("NEXT_PUBLIC_CONTACT_EMAIL", "runs@example.org");
    render(<AboutPage />);
    expect(screen.getByRole("link", { name: "runs@example.org" }).getAttribute("href")).toBe("mailto:runs@example.org");
  });

  it("says who built it, with the three author links opening safely in a new tab", () => {
    render(<AboutPage />);
    expect(screen.getByTestId("about-author").textContent).toBe("Built by Shahinsha.");
    expect(AUTHOR_LINKS.map((l) => l.href)).toEqual([
      "https://www.shahinsha.xyz/", "https://www.instagram.com/databyshahinsha", "https://www.linkedin.com/in/muhshahinshaav/",
    ]);
    for (const l of AUTHOR_LINKS) {
      const a = screen.getByRole("link", { name: l.ariaLabel });
      expect(a.textContent).toBe(l.label);
      expect(a.getAttribute("href")).toBe(l.href);
      expect(a.getAttribute("target")).toBe("_blank");
      expect(a.getAttribute("rel")).toBe("noopener noreferrer");
    }
    expect(document.body.textContent).not.toMatch(/@\w+\.\w+/);   // no email address unless the env sets one
  });
});
