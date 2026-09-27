import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LibraryItem } from "./library-tabs";
import { LibraryTabs } from "./library-tabs";

vi.mock("next/navigation", () => ({ usePathname: () => "/library" }));

const item = (key: string, status: LibraryItem["status"]): LibraryItem => ({
  key,
  status,
  card: <article aria-label={key}>{key}</article>,
});

const ITEMS = [item("Solo Leveling", "reading"), item("TBATE", "reading"), item("Omniscient Reader", "on_hold")];

beforeEach(() => {
  vi.spyOn(window.history, "replaceState");
});

const cards = () => screen.queryAllByRole("article").map((card) => card.getAttribute("aria-label"));

describe("LibraryTabs", () => {
  it("shows every series with a count per status", () => {
    render(<LibraryTabs items={ITEMS} initialTab="all" />);

    expect(screen.getByRole("tab", { name: "Toutes, 3 séries" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "En cours, 2 séries" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "En pause, 1 série" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Terminé, 0 série" })).toBeInTheDocument();
    expect(cards()).toEqual(["Solo Leveling", "TBATE", "Omniscient Reader"]);
  });

  it("filters instantly and mirrors the tab in the URL without a server round-trip", async () => {
    render(<LibraryTabs items={ITEMS} initialTab="all" />);

    await userEvent.click(screen.getByRole("tab", { name: "En pause, 1 série" }));
    expect(cards()).toEqual(["Omniscient Reader"]);
    expect(window.history.replaceState).toHaveBeenLastCalledWith(null, "", "/library?statut=on_hold");

    await userEvent.click(screen.getByRole("tab", { name: "Toutes, 3 séries" }));
    expect(window.history.replaceState).toHaveBeenLastCalledWith(null, "", "/library");
  });

  it("opens the tab requested by the URL and explains an empty status", () => {
    render(<LibraryTabs items={ITEMS} initialTab="completed" />);

    expect(cards()).toEqual([]);
    expect(screen.getByText("Aucune série « Terminé »")).toBeInTheDocument();
  });
});
