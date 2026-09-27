import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CoverImage } from "./cover-image";

const LOCAL = "/api/images/media/abc.png";
const PROXY = "/api/images/proxy?url=https%3A%2F%2Fs4.anilist.co%2Fcover.jpg";

// `next/image` rend une URL absolue (`http://localhost:3000/…`) : on compare le chemin.
const shownSrc = () => screen.getByRole("img").getAttribute("src") ?? "";

const renderCover = (sources: string[]) =>
  render(<CoverImage sources={sources} alt="Couverture de TBATE" sizes="100vw" />);

describe("CoverImage", () => {
  it("shows the local copy first", () => {
    renderCover([LOCAL, PROXY]);

    expect(screen.getByRole("img", { name: "Couverture de TBATE" })).toBeInTheDocument();
    expect(shownSrc().endsWith(LOCAL)).toBe(true);
  });

  it("falls back to the proxy when the local copy fails, then to a placeholder — never a broken image", () => {
    renderCover([LOCAL, PROXY]);

    fireEvent.error(screen.getByRole("img"));
    expect(shownSrc().endsWith(PROXY)).toBe(true);

    fireEvent.error(screen.getByRole("img"));
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("Pas de couverture")).toBeInTheDocument();
  });

  it("shows the placeholder straight away without any source", () => {
    renderCover([]);

    expect(screen.getByText("Pas de couverture")).toBeInTheDocument();
  });
});
