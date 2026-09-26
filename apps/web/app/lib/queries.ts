import "server-only";

import { cache } from "react";
import { api } from "./api";
import { getForwardedAuthHeaders } from "./dal";

// Lectures côté serveur (Server Components), mémoïsées par `cache()` le temps d'un rendu :
// la page, `generateMetadata` et les sections en streaming peuvent appeler la même fonction
// sans déclencher deux requêtes vers l'API.

/** Fiche d'une œuvre, ou `null` si elle n'existe pas (id inconnu, supprimé ou mal formé). */
export const getManhwa = cache(async (id: string) => {
  const res = await api.manhwas[":id"].$get({ param: { id } });
  // Le contrat RPC ne décrit que le succès (les erreurs passent par le handler central de l'API) :
  // on élargit le statut au type `number` pour tester les cas d'erreur attendus.
  const status: number = res.status;
  if (status === 404 || status === 400) return null;
  if (!res.ok) throw new Error(`Fiche indisponible (HTTP ${res.status})`);
  return (await res.json()).data;
});

export const getManhwaTags = cache(async (manhwaId: string) => {
  const res = await api.taxonomy.manhwas[":manhwaId"].terms.$get({ param: { manhwaId } });
  if (!res.ok) throw new Error(`Tags indisponibles (HTTP ${res.status})`);
  return (await res.json()).data;
});

export const getChapters = cache(async (manhwaId: string) => {
  const res = await api.chapters.manhwa[":manhwaId"].$get({ param: { manhwaId } });
  if (!res.ok) throw new Error(`Chapitres indisponibles (HTTP ${res.status})`);
  return (await res.json()).data;
});

/** Progression de l'utilisateur connecté sur cette œuvre (`null` : pas dans sa bibliothèque). */
export const getProgress = cache(async (manhwaId: string) => {
  const res = await api.reading.progress[":manhwaId"].$get({ param: { manhwaId } }, { headers: await getForwardedAuthHeaders() });
  if (!res.ok) throw new Error(`Progression indisponible (HTTP ${res.status})`);
  return (await res.json()).data;
});

/** Ids des œuvres suivies par l'utilisateur (pour l'état des boutons « Ajouter »). Vide en cas d'échec. */
export const getLibraryIds = cache(async (): Promise<ReadonlySet<string>> => {
  const res = await api.reading.progress.$get({}, { headers: await getForwardedAuthHeaders() });
  if (!res.ok) return new Set();
  return new Set((await res.json()).data.map((entry) => entry.manhwaId));
});
