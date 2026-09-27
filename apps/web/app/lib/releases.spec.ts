import { describe, expect, it } from "vitest";
import type { ChapterRelease } from "./api-types";
import { externalHref, formatLanguage, formatTeams, releaseCredits } from "./releases";

const team = (id: string, name = id) => ({ id, name, websiteUrl: null });
const release = (overrides: Partial<ChapterRelease>): ChapterRelease => ({
  id: crypto.randomUUID(),
  url: "https://asura.example/1",
  language: "fr",
  sourceName: "Asura Scans",
  teams: [],
  ...overrides,
});

describe("formatTeams", () => {
  it("joins credits the way a reader says them", () => {
    expect(formatTeams([])).toBe("");
    expect(formatTeams([team("a", "Asura Scans")])).toBe("Asura Scans");
    expect(formatTeams([team("a", "Asura Scans"), team("f", "Flame Comics")])).toBe("Asura Scans & Flame Comics");
    expect(formatTeams([team("a", "A"), team("b", "B"), team("c", "C")])).toBe("A, B & C");
  });
});

describe("formatLanguage", () => {
  it("shows short uppercase codes", () => {
    expect(formatLanguage("fr")).toBe("FR");
    expect(formatLanguage("pt-br")).toBe("PT-BR");
  });
});

describe("externalHref", () => {
  it("only links http(s) URLs", () => {
    expect(externalHref("https://asura.example/ch-1")).toBe("https://asura.example/ch-1");
    expect(externalHref("http://asura.example/ch-1")).toBe("http://asura.example/ch-1");
    expect(externalHref("javascript:alert(1)")).toBeNull();
    expect(externalHref("not a url")).toBeNull();
  });
});

describe("releaseCredits", () => {
  it("merges the same translation republished on several sources, keeping API order", () => {
    const asura = team("asura");
    const credits = releaseCredits([
      release({ language: "fr", teams: [asura], url: "javascript:alert(1)", sourceName: "Shady" }),
      release({ language: "en", teams: [] }),
      release({ language: "fr", teams: [asura], url: "https://mangadex.org/chapter/1", sourceName: "MangaDex" }),
    ]);

    expect(credits.map(({ language, teams }) => ({ language, teams: teams.length }))).toEqual([
      { language: "fr", teams: 1 },
      { language: "en", teams: 0 },
    ]);
    // Le lien piégé est écarté au profit de la parution sûre du même crédit.
    expect(credits[0]).toMatchObject({ href: "https://mangadex.org/chapter/1", sourceName: "MangaDex" });
  });
});
