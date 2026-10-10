import { describe, expect, it } from "vitest";
import type { ExternalProvider } from "./api-types";
import { parseSeriesReference } from "./series-reference";

const MANGADEX_ID = "32d76d19-8a05-4db0-9fc2-e0b0648fe9d0";

describe("parseSeriesReference", () => {
  it.each([
    ["https://anilist.co/manga/105398/Na-Honjaman-Level-Up/", "anilist", "105398"],
    ["https://www.anilist.co/manga/105398", "anilist", "105398"],
    [`https://mangadex.org/title/${MANGADEX_ID.toUpperCase()}/solo-leveling`, "mangadex", MANGADEX_ID],
    ["https://kitsu.app/manga/41521", "kitsu", "41521"],
    ["  https://kitsu.io/manga/41521  ", "kitsu", "41521"],
  ])("recognises the catalogue of %s", (input, provider, externalId) => {
    // Le catalogue choisi dans le formulaire est ignoré : l'URL fait foi.
    expect(parseSeriesReference(input, "kitsu")).toEqual({ ok: true, reference: { provider, externalId } });
  });

  it("treats a bare UUID as a MangaDex id whatever the selected catalogue", () => {
    expect(parseSeriesReference(MANGADEX_ID, "anilist")).toEqual({
      ok: true,
      reference: { provider: "mangadex", externalId: MANGADEX_ID },
    });
  });

  it("uses the selected catalogue for a numeric id", () => {
    expect(parseSeriesReference("105398", "anilist")).toEqual({ ok: true, reference: { provider: "anilist", externalId: "105398" } });
    expect(parseSeriesReference("41521", "kitsu")).toEqual({ ok: true, reference: { provider: "kitsu", externalId: "41521" } });
  });

  const invalidInputs: [input: string, provider: ExternalProvider, message: unknown][] = [
    ["", "anilist", "Collez l'URL d'une fiche ou son identifiant."],
    ["https://evil.example/manga/1", "anilist", "Site non reconnu : collez une URL AniList, MangaDex ou Kitsu."],
    ["https://anilist.co/anime/21", "anilist", "Cette URL ne pointe pas vers la fiche d'une série."],
    ["https://kitsu.app/manga/solo-leveling", "kitsu", expect.stringContaining("identifiant numérique")],
    ["105398", "mangadex", expect.stringContaining("UUID")],
    ["solo leveling", "anilist", "Identifiant invalide : un nombre est attendu pour ce catalogue."],
    ["javascript:alert(1)", "anilist", "Identifiant invalide : un nombre est attendu pour ce catalogue."],
  ];

  it.each(invalidInputs)("rejects %j with a readable message", (input, provider, message) => {
    expect(parseSeriesReference(input, provider)).toEqual({ ok: false, message });
  });
});
