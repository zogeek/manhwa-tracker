import { z } from 'zod';
import type { HttpFetch } from '../../shared/http/outbound.js';
import { BadGatewayError, ServiceUnavailableError } from '../../shared/lib/errors.js';
import type { Manhwa } from '../manhwas/manhwa.schema.js';
import {
  type ExternalCatalogProvider,
  type ExternalManhwa,
  type ExternalProvider,
  type ExternalRef,
  type ExternalTag,
  type ExternalTitle,
} from './external-catalog.js';

export type KitsuClientOptions = {
  fetch: HttpFetch;
  /** API JSON:API (`https://kitsu.app/api/edge`). */
  url: string;
  timeoutMs?: number;
};

const SITE_URL = 'https://kitsu.app';
// Kitsu plafonne `page[limit]` à 20 pour la ressource manga.
const MAX_PAGE_SIZE = 20;
// Les catégories Kitsu n'ont pas de rang communautaire : pertinence fixe pour les thèmes.
const THEME_TAG_RELEVANCE = 60;
const MAX_TAGS = 10;
const MAX_ALTERNATIVE_TITLES = 20;
const MAX_SYNOPSIS_LENGTH = 10_000;
const ID_PATTERN = /^[1-9]\d{0,9}$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
// Relations embarquées : catégories (genres/thèmes) et correspondances vers les autres catalogues.
const INCLUDE = 'categories,mappings';

// Catégories Kitsu rangées dans le vocabulaire « genre » (les mêmes noms qu'AniList/MangaDex) ;
// les autres deviennent des thèmes.
const GENRES = new Set([
  'Action', 'Adventure', 'Comedy', 'Drama', 'Fantasy', 'Horror', 'Mystery', 'Psychological',
  'Romance', 'Science Fiction', 'Slice of Life', 'Sports', 'Supernatural', 'Thriller',
]);

// Zero Trust : la réponse d'un tiers est validée comme n'importe quelle entrée client.
const resourceRefSchema = z.object({ type: z.string(), id: z.string() });

const mangaSchema = z.object({
  id: z.string().regex(ID_PATTERN),
  type: z.literal('manga'),
  attributes: z.object({
    canonicalTitle: z.string().nullish(),
    titles: z.record(z.string(), z.string().nullable()).nullish(),
    abbreviatedTitles: z.array(z.string()).nullish(),
    synopsis: z.string().nullish(),
    startDate: z.string().nullish(),
    endDate: z.string().nullish(),
    averageRating: z.string().nullish(),
    status: z.string().nullish(),
    subtype: z.string().nullish(),
    ageRating: z.string().nullish(),
    chapterCount: z.number().int().nonnegative().nullish(),
    posterImage: z
      .object({ large: z.url({ protocol: /^https$/ }).nullish(), original: z.url({ protocol: /^https$/ }).nullish() })
      .nullish(),
  }),
  relationships: z
    .object({
      categories: z.object({ data: z.array(resourceRefSchema).nullish() }).nullish(),
      mappings: z.object({ data: z.array(resourceRefSchema).nullish() }).nullish(),
    })
    .nullish(),
});

// Ressources embarquées (`included`) : seules les catégories et correspondances nous intéressent.
const includedSchema = z.object({
  type: z.string(),
  id: z.string(),
  attributes: z
    .object({
      title: z.string().nullish(),
      externalSite: z.string().nullish(),
      externalId: z.string().nullish(),
    })
    .nullish(),
});

type KitsuManga = z.infer<typeof mangaSchema>;
type KitsuIncluded = z.infer<typeof includedSchema>;

const searchResponseSchema = z.object({ data: z.array(mangaSchema), included: z.array(includedSchema).nullish() });
const entityResponseSchema = z.object({ data: mangaSchema, included: z.array(includedSchema).nullish() });

const STATUS_MAP: Partial<Record<string, Manhwa['status']>> = {
  current: 'ongoing',
  finished: 'completed',
  tba: 'ongoing',
  unreleased: 'ongoing',
  upcoming: 'ongoing',
};

const TYPE_BY_SUBTYPE: Partial<Record<string, Manhwa['type']>> = { manhwa: 'manhwa', manhua: 'manhua' };
// Hors périmètre, comme pour AniList (`format_not: NOVEL`, `isAdult: false`).
const EXCLUDED_SUBTYPES = new Set(['novel']);
const EXCLUDED_AGE_RATINGS = new Set(['R18']);

// Clés `titles` de Kitsu → langue du domaine ; `en_jp`, `en_kr`… sont des romanisations → `null`.
const TITLE_LANGUAGE: Partial<Record<string, string>> = { en: 'en', ja_jp: 'jp', ko_kr: 'kr', zh_cn: 'cn' };
const ORIGINAL_TITLE_KEY: Partial<Record<string, string>> = { manhwa: 'ko_kr', manhua: 'zh_cn' };

// Correspondances Kitsu → nos fournisseurs (la même œuvre chez eux).
const CROSS_REFERENCE_SITES: Partial<Record<string, { provider: ExternalProvider; url: (id: string) => string }>> = {
  'anilist/manga': { provider: 'anilist', url: (id) => `https://anilist.co/manga/${id}` },
};

const clean = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

const isoDate = (value: string | null | undefined): string | null =>
  value && ISO_DATE_PATTERN.test(value) ? value : null;

/** Ressources embarquées indexées par `type:id`, pour résoudre les relations d'une fiche. */
function indexIncluded(included: readonly KitsuIncluded[] | null | undefined): Map<string, KitsuIncluded> {
  return new Map((included ?? []).map((item) => [`${item.type}:${item.id}`, item]));
}

function related(
  refs: z.infer<typeof resourceRefSchema>[] | null | undefined,
  included: ReadonlyMap<string, KitsuIncluded>,
): KitsuIncluded[] {
  return (refs ?? []).flatMap((ref) => included.get(`${ref.type}:${ref.id}`) ?? []);
}

function titleOf(manga: KitsuManga): string {
  const { titles, canonicalTitle } = manga.attributes;
  return clean(titles?.['en']) ?? clean(canonicalTitle) ?? `Kitsu #${manga.id}`;
}

function alternativeTitles(manga: KitsuManga, title: string): ExternalTitle[] {
  const { titles, canonicalTitle, abbreviatedTitles } = manga.attributes;
  const candidates: ExternalTitle[] = [
    ...Object.entries(titles ?? {}).map(([key, value]) => ({ title: clean(value) ?? '', language: TITLE_LANGUAGE[key] ?? null })),
    { title: clean(canonicalTitle) ?? '', language: null },
    ...(abbreviatedTitles ?? []).map((value) => ({ title: clean(value) ?? '', language: null })),
  ];

  const seen = new Set([title.toLowerCase()]);
  const result: ExternalTitle[] = [];
  for (const candidate of candidates) {
    const key = candidate.title.toLowerCase();
    if (!candidate.title || candidate.title.length > 500 || seen.has(key)) continue;
    seen.add(key);
    result.push(candidate);
  }
  return result.slice(0, MAX_ALTERNATIVE_TITLES);
}

function crossReferences(mappings: readonly KitsuIncluded[]): ExternalRef[] {
  return mappings.flatMap((mapping) => {
    const site = CROSS_REFERENCE_SITES[mapping.attributes?.externalSite ?? ''];
    const externalId = mapping.attributes?.externalId ?? '';
    return site && ID_PATTERN.test(externalId) ? [{ provider: site.provider, externalId, url: site.url(externalId) }] : [];
  });
}

/** Traduit une fiche Kitsu dans le vocabulaire du domaine ; `null` si elle est hors périmètre. */
export function toExternalManhwa(manga: KitsuManga, included: ReadonlyMap<string, KitsuIncluded>): ExternalManhwa | null {
  const { attributes: a } = manga;
  if (EXCLUDED_SUBTYPES.has(a.subtype ?? '') || EXCLUDED_AGE_RATINGS.has(a.ageRating ?? '')) return null;

  const title = titleOf(manga);
  const categories = related(manga.relationships?.categories?.data, included)
    .map((category) => clean(category.attributes?.title))
    .filter((name) => name !== null);
  const tags: ExternalTag[] = categories
    .filter((name) => !GENRES.has(name))
    .slice(0, MAX_TAGS)
    .map((name) => ({ name, relevance: THEME_TAG_RELEVANCE, isSpoiler: false }));
  const rating = Number(a.averageRating);
  const originalKey = ORIGINAL_TITLE_KEY[a.subtype ?? ''] ?? 'ja_jp';

  return {
    provider: 'kitsu',
    externalId: manga.id,
    url: `${SITE_URL}/manga/${manga.id}`,
    title,
    originalTitle: clean(a.titles?.[originalKey]),
    alternativeTitles: alternativeTitles(manga, title),
    synopsis: clean(a.synopsis)?.slice(0, MAX_SYNOPSIS_LENGTH) ?? null,
    coverUrl: a.posterImage?.large ?? a.posterImage?.original ?? null,
    type: TYPE_BY_SUBTYPE[a.subtype ?? ''] ?? 'manga',
    status: STATUS_MAP[a.status ?? ''] ?? 'ongoing',
    totalChapters: a.chapterCount ?? null,
    // Note Kitsu : pourcentage en chaîne (« 84.26 ») → sur 10, une décimale.
    rating: a.averageRating && rating >= 0 && rating <= 100 ? Math.round(rating) / 10 : null,
    startDate: isoDate(a.startDate),
    endDate: isoDate(a.endDate),
    genres: [...new Set(categories.filter((name) => GENRES.has(name)))],
    tags,
    // L'API Kitsu n'expose pas l'équipe des mangas (relations `staff` et `mangaStaff` vides, vérifié
    // sur des œuvres réelles) : les auteurs viendront d'AniList ou de MangaDex si l'œuvre y est liée.
    authors: [],
    crossReferences: crossReferences(related(manga.relationships?.mappings?.data, included)),
  };
}

/**
 * Adaptateur Kitsu (API JSON:API publique, sans clé) du port `ExternalCatalogProvider`.
 * Ses correspondances (`mappings`) pointent vers AniList : l'anti-doublon fonctionne sans code en plus.
 */
export class KitsuClient implements ExternalCatalogProvider {
  readonly name: ExternalProvider = 'kitsu';
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(private readonly options: KitsuClientOptions) {
    this.baseUrl = options.url.replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? 8_000;
  }

  async search(query: string, limit: number): Promise<ExternalManhwa[]> {
    const url = new URL(`${this.baseUrl}/manga`);
    url.searchParams.set('filter[text]', query);
    url.searchParams.set('page[limit]', String(Math.min(limit, MAX_PAGE_SIZE)));
    url.searchParams.set('include', INCLUDE);

    const res = await this.get(url);
    const body = searchResponseSchema.safeParse(await this.json(res));
    if (!res.ok || !body.success) throw new BadGatewayError(`Kitsu search failed (HTTP ${res.status})`);
    const included = indexIncluded(body.data.included);
    return body.data.data.flatMap((manga) => toExternalManhwa(manga, included) ?? []);
  }

  async findById(externalId: string): Promise<ExternalManhwa | null> {
    if (!ID_PATTERN.test(externalId)) return null;
    const url = new URL(`${this.baseUrl}/manga/${externalId}`);
    url.searchParams.set('include', INCLUDE);

    const res = await this.get(url);
    if (res.status === 404) {
      await res.body?.cancel();
      return null;
    }
    const body = entityResponseSchema.safeParse(await this.json(res));
    if (!res.ok || !body.success) throw new BadGatewayError(`Kitsu lookup failed (HTTP ${res.status})`);
    return toExternalManhwa(body.data.data, indexIncluded(body.data.included));
  }

  private async get(url: URL): Promise<Response> {
    const res = await this.options
      .fetch(url, {
        headers: { Accept: 'application/vnd.api+json' },
        signal: AbortSignal.timeout(this.timeoutMs),
      })
      .catch((error: unknown) => {
        throw new BadGatewayError('Kitsu is unreachable', { cause: error });
      });

    if (res.status === 429) {
      await res.body?.cancel();
      throw new ServiceUnavailableError('Kitsu rate limit reached, retry later');
    }
    return res;
  }

  private async json(res: Response): Promise<unknown> {
    return res.json().catch((error: unknown) => {
      throw new BadGatewayError(`Kitsu returned an invalid body (HTTP ${res.status})`, { cause: error });
    });
  }
}
