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

export const isExternalProvider = (value: string): value is ExternalProvider =>
  EXTERNAL_PROVIDERS.some((provider) => provider === value);

export const externalRefKey = ({ provider, externalId }: Pick<ExternalRef, 'provider' | 'externalId'>): string =>
  `${provider}:${externalId}`;

export type ExternalTitle = {
  title: string;
  /** 'kr' | 'jp' | 'cn' | 'en'… ; `null` pour une romanisation ou un alias. */
  language: string | null;
};

/** Rôle d'un auteur (enum `author_role`) : scénario, dessin, ou les deux. */
export type AuthorRole = 'story' | 'art' | 'both';

/**
 * Auteur d'une œuvre, dans l'ordre d'importance donné par le fournisseur. `nativeName` (추공)
 * est la meilleure clé entre catalogues : les romanisations divergent (« Chu-Gong », « Chugong »).
 */
export type ExternalAuthor = { name: string; nativeName: string | null; role: AuthorRole };

/**
 * Identité d'une personne pour le dédoublonnage : son nom natif s'il est connu (stable d'un
 * catalogue à l'autre), sinon son nom latin sans casse, accents, tirets ni ordre des mots
 * (« So-Ryeong Gi » = « Gi So-Ryeong »).
 */
export function authorIdentity({ name, nativeName }: Pick<ExternalAuthor, 'name' | 'nativeName'>): string {
  const native = nativeName?.replace(/\s+/g, '');
  if (native) return `native:${native}`;
  const tokens = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/\s+/)
    .map((token) => token.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean)
    .sort();
  return `latin:${tokens.join(' ')}`;
}

/** « Chugong (추공) » (format MangaDex) → nom latin + nom natif. */
export function splitNativeName(raw: string): Pick<ExternalAuthor, 'name' | 'nativeName'> {
  const match = /^(.+?)\s*\(([^()]+)\)\s*$/.exec(raw.trim());
  return match?.[1] && match[2] ? { name: match[1].trim(), nativeName: match[2].trim() } : { name: raw.trim(), nativeName: null };
}

/**
 * Rôle en texte libre (AniList, Kitsu : « Story & Art », « Original Creator », « Art (assistant) »…) → rôle du domaine.
 * Traduction, lettrage, édition, assistants… ne sont pas des auteurs de l'œuvre : `null`.
 */
export function parseAuthorRole(role: string | null): AuthorRole | null {
  const value = (role ?? '').toLowerCase();
  if (/assistant|translat|letter|edit|touch-up|design/.test(value)) return null;
  const story = /story|original creator|writer|author/.test(value);
  const art = /\bart\b|illustrat/.test(value);
  if (story && art) return 'both';
  if (story) return 'story';
  if (art) return 'art';
  return null;
}

/**
 * Fusionne les entrées d'une même personne (MangaDex la cite comme « author » ET « artist ») :
 * un seul auteur, rôle « both », à la place de sa première apparition.
 */
export function mergeAuthors(authors: readonly ExternalAuthor[], max = 10): ExternalAuthor[] {
  const byKey = new Map<string, ExternalAuthor>();
  for (const author of authors) {
    const name = author.name.trim();
    if (!name || name.length > 200) continue;
    const key = authorIdentity(author);
    const known = byKey.get(key);
    byKey.set(
      key,
      known
        ? { ...known, nativeName: known.nativeName ?? author.nativeName, role: known.role === author.role ? known.role : 'both' }
        : { ...author, name },
    );
  }
  return [...byKey.values()].slice(0, max);
}

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
  authors: ExternalAuthor[];
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
