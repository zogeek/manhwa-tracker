import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ManhwaAuthor } from "@/app/lib/api-types";
import { AuthorCredits, AuthorLine } from "./author-list";

const TBATE: ManhwaAuthor[] = [
  { name: "TurtleMe", nativeName: null, role: "story" },
  { name: "Fuyuki23", nativeName: null, role: "art" },
  { name: "Studio Waveon", nativeName: null, role: "both" },
];

describe("AuthorLine (cards)", () => {
  it("shows two names, a counter for the others, and the full credits for screen readers", () => {
    render(<AuthorLine authors={TBATE} />);

    expect(screen.getByText("TurtleMe · Fuyuki23 +1")).toBeInTheDocument();
    expect(
      screen.getByText("Scénario : TurtleMe — Dessin : Fuyuki23 — Scénario & dessin : Studio Waveon"),
    ).toHaveClass("sr-only");
  });

  it("renders nothing without authors", () => {
    const { container } = render(<AuthorLine authors={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("AuthorCredits (detail page)", () => {
  it("groups the names by role, complete authors first", () => {
    render(<AuthorCredits authors={[...TBATE, { name: "Kim", nativeName: null, role: "art" }]} />);

    const terms = screen.getAllByRole("term").map((term) => term.textContent);
    const definitions = screen.getAllByRole("definition").map((definition) => definition.textContent);
    expect(terms).toEqual(["Scénario & dessin", "Scénario", "Dessin"]);
    expect(definitions).toEqual(["Studio Waveon", "TurtleMe", "Fuyuki23, Kim"]);
  });

  it("shows the native name next to the romanized one", () => {
    render(<AuthorCredits authors={[{ name: "Chugong", nativeName: "추공", role: "story" }]} />);

    expect(screen.getByRole("definition")).toHaveTextContent("Chugong추공");
    expect(screen.getByText("추공")).toHaveAttribute("lang", "und");
  });
});
