import type { Manhwa } from '../manhwas/manhwa.schema.js';

/** Fournisseurs de catalogue externes branchés (valeur stockée dans `external_links.provider`). */
export const EXTERNAL_PROVIDERS = ['anilist'] as const;
export type ExternalProvider = (typeof EXTERNAL_PROVIDERS)[number];

export type ExternalTitle = {
  title: string;
  /** 'kr' | 'jp' | 'cn' | 'en'… ; `null` pour une romanisation ou un alias. */
  language: string | null;
};

export type ExternalTag = {
  name: string;
  /** Pertinence 0-100 (→ `manhwa_terms.relevance`). */
  relevance: number;
  isSpoiler: boolean;
};

/** Fiche d'une œuvre chez un fournisseur externe, déjà normalisée dans le vocabulaire de notre domaine. */
export type ExternalManhwa = {
  provider: ExternalProvider;
  externalId: string;
  url: string | null;
  title: string;
  originalTitle: string | null;
  alternativeTitles: ExternalTitle[];
  synopsis: string | null;
  coverUrl: string | null;
  type: Manhwa['type'];
  status: Manhwa['status'];
  totalChapters: number | null;
  /** Note moyenne ramenée sur 10. */
  rating: number | null;
  /** Dates complètes uniquement (`YYYY-MM-DD`), sinon `null`. */
  startDate: string | null;
  endDate: string | null;
  genres: string[];
  tags: ExternalTag[];
};

/**
 * Port (contrat) d'un catalogue externe. Le domaine ne dépend que de cette interface :
 * brancher MangaDex ou Kitsu = écrire un nouvel adaptateur, sans toucher au service.
 */
export interface ExternalCatalogProvider {
  readonly name: ExternalProvider;
  search(query: string, limit: number): Promise<ExternalManhwa[]>;
  /** `null` si l'œuvre n'existe pas (ou est exclue : contenu adulte, roman…). */
  findById(externalId: string): Promise<ExternalManhwa | null>;
}
