import type { Manhwa } from '../manhwas/manhwa.schema.js';

/** Fournisseurs de catalogue externes branchés (valeur stockée dans `external_links.provider`). */
export const EXTERNAL_PROVIDERS = ['anilist', 'mangadex', 'kitsu'] as const;
export type ExternalProvider = (typeof EXTERNAL_PROVIDERS)[number];

/** Référence d'une œuvre chez un fournisseur (clé d'unicité de `external_links`). */
export type ExternalRef = {
  provider: ExternalProvider;
  externalId: string;
  url: string | null;
};

export const externalRefKey = ({ provider, externalId }: Pick<ExternalRef, 'provider' | 'externalId'>): string =>
  `${provider}:${externalId}`;

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
  /**
   * La même œuvre chez d'autres fournisseurs, quand celui-ci la connaît (MangaDex expose l'id AniList).
   * Sert à éviter les doublons : importer depuis MangaDex une œuvre déjà importée depuis AniList
   * complète la fiche existante au lieu d'en créer une seconde.
   */
  crossReferences: ExternalRef[];
};

/** Une parution de chapitre chez un fournisseur (une traduction, par une équipe, dans une langue). */
export type ExternalChapter = {
  externalId: string;
  /** Numéro canonique (`numeric(8,2)`) ; les parutions sans numéro (one-shots) sont écartées. */
  number: number;
  title: string | null;
  language: string;
  url: string;
  scanlationGroup: string | null;
  publishedAt: Date | null;
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

/**
 * Port séparé pour la capacité « liste des chapitres » : tous les fournisseurs ne l'ont pas
 * (AniList ne connaît que le nombre total). Ségrégation d'interface : AniList n'a pas à
 * implémenter une méthode qu'il ne peut pas honorer.
 */
export interface ExternalChapterFeed {
  readonly name: ExternalProvider;
  /** Source (table `sources`) à laquelle les parutions synchronisées sont rattachées. */
  readonly source: ExternalSource;
  /** URL de la page de l'œuvre sur cette source (`manhwa_sources.manhwa_url`). */
  workUrl(externalId: string): string;
  listChapters(externalId: string): Promise<ExternalChapter[]>;
}

export type ExternalSource = { name: string; baseUrl: string; language: string };
