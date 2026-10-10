import type { AuthorRole, ExternalProvider, ManhwaType, PublicationStatus, ReadingStatus, SourceHealthStatus } from "./api-types";

// Records exhaustifs : une valeur ajoutée à un enum Postgres casse le typecheck tant qu'elle n'a pas de libellé.

export const READING_STATUS_LABELS: Record<ReadingStatus, string> = {
  reading: "En cours",
  on_hold: "En pause",
  plan_to_read: "À lire",
  completed: "Terminé",
  dropped: "Abandonné",
};

export const MANHWA_TYPE_LABELS: Record<ManhwaType, string> = {
  manhwa: "Manhwa",
  manga: "Manga",
  manhua: "Manhua",
  webtoon: "Webtoon",
};

export const PUBLICATION_STATUS_LABELS: Record<PublicationStatus, string> = {
  ongoing: "En cours de parution",
  completed: "Série terminée",
  hiatus: "En hiatus",
  cancelled: "Annulée",
};

/** Ordre d'affichage des statuts de lecture (sélecteur, regroupements). */
export const READING_STATUSES: readonly ReadingStatus[] = [
  "reading",
  "on_hold",
  "plan_to_read",
  "completed",
  "dropped",
];

export const AUTHOR_ROLE_LABELS: Record<AuthorRole, string> = {
  both: "Scénario & dessin",
  story: "Scénario",
  art: "Dessin",
};

/** Ordre d'affichage des rôles sur la fiche : auteur complet d'abord. */
export const AUTHOR_ROLES: readonly AuthorRole[] = ["both", "story", "art"];

export const PROVIDER_LABELS: Record<ExternalProvider, string> = {
  anilist: "AniList",
  mangadex: "MangaDex",
  kitsu: "Kitsu",
};

/** Ordre d'affichage des catalogues externes (sélecteurs). */
export const EXTERNAL_PROVIDERS: readonly ExternalProvider[] = ["anilist", "mangadex", "kitsu"];

/** État de la dernière vérification d'une source de scantrad par le scraper. */
export const SOURCE_STATUS_LABELS: Record<SourceHealthStatus, string> = {
  up: "Opérationnelle",
  degraded: "Ralentie",
  blocked: "Bloquée (anti-bot)",
  down: "Hors ligne",
};
