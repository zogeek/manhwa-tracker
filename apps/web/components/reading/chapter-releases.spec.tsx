import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ChapterRelease } from "@/app/lib/api-types";
import { ChapterReleases } from "./chapter-releases";

const release = (overrides: Partial<ChapterRelease>): ChapterRelease => ({
  id: crypto.randomUUID(),
  url: "https://asura.example/ch-42",
  language: "fr",
  sourceName: "Asura Scans",
  teams: [],
  ...overrides,
});

describe("ChapterReleases", () => {
  it("credits a collaboration as « FR — Asura Scans & Flame Comics », linked to the source", () => {
    render(
      <ChapterReleases
        releases={[
          release({
            teams: [
              { id: "a", name: "Asura Scans", websiteUrl: null },
              { id: "f", name: "Flame Comics", websiteUrl: null },
            ],
          }),
        ]}
      />,
    );

    const link = screen.getByRole("link", { name: /FR.*Asura Scans & Flame Comics/ });
    expect(link).toHaveAttribute("href", "https://asura.example/ch-42");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveAttribute("title", "Lire sur Asura Scans");
  });

  it("stays neutral when no team is credited: the language only", () => {
    render(<ChapterReleases releases={[release({ language: "en", teams: [] })]} />);

    expect(screen.getByRole("listitem")).toHaveTextContent(/^EN$/);
  });

  it("renders nothing without any release, and never links an unsafe URL", () => {
    const { container, rerender } = render(<ChapterReleases releases={[]} />);
    expect(container).toBeEmptyDOMElement();

    rerender(<ChapterReleases releases={[release({ url: "javascript:alert(1)" })]} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByRole("listitem")).toHaveTextContent("FR");
  });
});
