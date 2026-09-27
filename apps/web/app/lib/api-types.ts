import type { InferRequestType, InferResponseType } from "hono/client";
import type { api } from "./api";

// Types du front *déduits* du contrat RPC de l'API (AppType) : aucune interface écrite à la main.
// Si une colonne change côté Drizzle, ces types (et tous leurs usages) suivent automatiquement.

/** Fiche d'un manhwa telle que renvoyée par `GET /manhwas`. */
export type CatalogManhwa = InferResponseType<typeof api.manhwas.$get, 200>["data"][number];

/** Entrée de la bibliothèque (`GET /reading/progress`) : progression + fiche du manhwa suivi. */
export type LibraryEntry = InferResponseType<typeof api.reading.progress.$get, 200>["data"][number];

/** Corps accepté par `PUT /reading/progress/:manhwaId` (validator Zod de l'API). */
export type ProgressPatch = InferRequestType<(typeof api.reading.progress)[":manhwaId"]["$put"]>["json"];

export type ReadingStatus = LibraryEntry["status"];
export type ManhwaType = CatalogManhwa["type"];
export type PublicationStatus = CatalogManhwa["status"];

/** Réponse de `GET /manhwas/search` : résultats locaux, externes et état de chaque fournisseur. */
export type CatalogSearch = InferResponseType<typeof api.manhwas.search.$get, 200>["data"];
export type LocalSearchHit = CatalogSearch["local"][number];
export type ExternalSearchHit = CatalogSearch["external"][number];
export type ExternalProvider = ExternalSearchHit["provider"];
export type ProviderReport = CatalogSearch["providers"][number];

/** Fiche complète (`GET /manhwas/:id`). */
export type ManhwaDetail = InferResponseType<(typeof api.manhwas)[":id"]["$get"], 200>["data"];

/** Tag d'une œuvre avec son terme et son vocabulaire (`GET /taxonomy/manhwas/:manhwaId/terms`). */
export type ManhwaTag = InferResponseType<
  (typeof api.taxonomy.manhwas)[":manhwaId"]["terms"]["$get"],
  200
>["data"][number];

/** Chapitre canonique (`GET /chapters/manhwa/:manhwaId`). */
export type Chapter = InferResponseType<(typeof api.chapters.manhwa)[":manhwaId"]["$get"], 200>["data"][number];

/** Progression de l'utilisateur sur une œuvre, `null` si elle n'est pas dans sa bibliothèque. */
export type ReadingProgress = InferResponseType<(typeof api.reading.progress)[":manhwaId"]["$get"], 200>["data"];

/** Auteur d'une fiche (nom + rôle), dans l'ordre du catalogue d'origine. */
export type ManhwaAuthor = CatalogManhwa["authors"][number];
export type AuthorRole = ManhwaAuthor["role"];

/** Parution d'un chapitre (source, langue, URL) avec les teams créditées, dans l'ordre de crédit. */
export type ChapterRelease = Chapter["releases"][number];
export type ReleaseTeam = ChapterRelease["teams"][number];
