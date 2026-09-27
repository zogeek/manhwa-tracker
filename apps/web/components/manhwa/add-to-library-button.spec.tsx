import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AddToLibraryButton } from "./add-to-library-button";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/lib/api", () => ({ api: {} }));

// Régression « bouton rogné » : sur une carte étroite, le libellé doit pouvoir passer à la ligne
// et le bouton grandir, au lieu du `whitespace-nowrap` + hauteur fixe du bouton shadcn.
describe("AddToLibraryButton layout", () => {
  it.each([
    [false, "Ajouter à ma bibliothèque"],
    [true, "Dans ma bibliothèque"],
  ])("lets the label wrap inside a narrow card (inLibrary=%s)", (inLibrary, label) => {
    render(<AddToLibraryButton manhwaId="m-1" inLibrary={inLibrary} />);

    const button = screen.getByRole("button", { name: label });
    expect(button).toHaveClass("w-full", "whitespace-normal", "h-auto");
    expect(button).not.toHaveClass("whitespace-nowrap");
    expect(button).not.toHaveClass("h-8");
  });
});
