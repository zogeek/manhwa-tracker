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
