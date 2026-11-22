/** The wordmark is drawn and coloured by tokens (amendments 24 to 26). */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Wordmark } from "./Wordmark";

afterEach(cleanup);

describe("Wordmark", () => {
  it("is an SVG named GATHO, whole pixels a cell in the top bar, no text and no literal colour", () => {
    render(<Wordmark height={21} />);
    const svg = screen.getByRole("img", { name: "GATHO" });
    expect([svg.getAttribute("width"), svg.getAttribute("height"), svg.getAttribute("shape-rendering")]).toEqual(["93", "27", "crispEdges"]);
    expect(svg.querySelector("text")).toBeNull();
    expect(svg.querySelector("[fill]")).toBeNull();
  });

  it("shows the icon under 14 px", () => {
    render(<Wordmark height={13} />);
    expect(screen.getByRole("img", { name: "GATHO" }).getAttribute("class")).toBe("logo-icon");
  });
});
