import type { ReadingStatus } from "./api-types";

// Partagé serveur ET client : ne pas le déclarer dans un module "use client" (une valeur exportée
// par un tel module devient une *référence client* quand un Server Component l'importe).

/** Onglet « Toutes » de la bibliothèque (les autres onglets sont les statuts de lecture). */
export const ALL_TAB = "all";
export type LibraryTab = ReadingStatus | typeof ALL_TAB;
