import type { ExternalProvider } from "./api-types";

// Formulaire « Ajouter une série » : l'utilisateur colle une URL de fiche (AniList, MangaDex, Kitsu)
// ou un identifiant brut. Ce module en déduit la référence attendue par `POST /manhwas/import`.
// Pure fonction partagée serveur/client ; l'API revalide de toute façon (Zero Trust).

export type SeriesReference = { provider: ExternalProvider; externalId: string };

export type ParsedReference = { ok: true; reference: SeriesReference } | { ok: false; message: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERIC_ID = /^[1-9]\d{0,9}$/;

/** Hôtes reconnus → fournisseur + extraction de l'identifiant depuis le chemin. */
const SITES: readonly { hosts: readonly string[]; provider: ExternalProvider; extract: (segments: string[]) => string | null }[] = [
  // https://anilist.co/manga/30002/Berserk
  { hosts: ["anilist.co"], provider: "anilist", extract: ([kind, id]) => (kind === "manga" && id && NUMERIC_ID.test(id) ? id : null) },
  // https://mangadex.org/title/<uuid>/solo-leveling
  {
    hosts: ["mangadex.org"],
    provider: "mangadex",
    extract: ([kind, id]) => (kind === "title" && id && UUID.test(id) ? id.toLowerCase() : null),
  },
  // https://kitsu.app/manga/12345 (l'URL à slug `/manga/solo-leveling` ne contient pas l'identifiant)
  { hosts: ["kitsu.app", "kitsu.io"], provider: "kitsu", extract: ([kind, id]) => (kind === "manga" && id && NUMERIC_ID.test(id) ? id : null) },
];

const failure = (message: string): ParsedReference => ({ ok: false, message });

/**
 * @param input  URL de fiche ou identifiant saisi par l'utilisateur.
 * @param provider  Catalogue choisi dans le formulaire, utilisé pour un identifiant numérique
 *   (AniList et Kitsu partagent ce format). Une URL ou un UUID (MangaDex) désignent le leur.
 */
export function parseSeriesReference(input: string, provider: ExternalProvider): ParsedReference {
  const value = input.trim();
  if (!value) return failure("Collez l'URL d'une fiche ou son identifiant.");

  if (/^https?:\/\//i.test(value)) {
    const url = URL.parse(value);
    const host = url?.hostname.replace(/^www\./, "");
    const site = SITES.find(({ hosts }) => host !== undefined && hosts.includes(host));
    if (!url || !site) return failure("Site non reconnu : collez une URL AniList, MangaDex ou Kitsu.");
    const externalId = site.extract(url.pathname.split("/").filter(Boolean));
    if (!externalId) {
      return failure(
        site.provider === "kitsu"
          ? "Cette URL Kitsu ne contient pas l'identifiant numérique de la série : collez l'identifiant à la place."
          : "Cette URL ne pointe pas vers la fiche d'une série.",
      );
    }
    return { ok: true, reference: { provider: site.provider, externalId } };
  }

  if (UUID.test(value)) return { ok: true, reference: { provider: "mangadex", externalId: value.toLowerCase() } };
  if (NUMERIC_ID.test(value) && provider !== "mangadex") return { ok: true, reference: { provider, externalId: value } };
  return failure(
    provider === "mangadex"
      ? "Un identifiant MangaDex est un UUID (ex. 32d76d19-8a05-4db0-9fc2-e0b0648fe9d0)."
      : "Identifiant invalide : un nombre est attendu pour ce catalogue.",
  );
}
