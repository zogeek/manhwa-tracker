import { z } from 'zod';
import type { HttpFetch } from '../../shared/http/outbound.js';
import { BadGatewayError, NotFoundError, ServiceUnavailableError } from '../../shared/lib/errors.js';
import type { Manhwa } from '../manhwas/manhwa.schema.js';
import type {
  ExternalCatalogProvider,
  ExternalChapter,
  ExternalChapterFeed,
  ExternalManhwa,
  ExternalProvider,
  ExternalRef,
  ExternalSource,
  ExternalTag,
  ExternalTitle,
} from './external-catalog.js';

export type MangaDexClientOptions = {
  fetch: HttpFetch;
  /** API REST (`https://api.mangadex.org`). */
  url: string;
  /** Langues des chapitres synchronisés (codes MangaDex : `en`, `fr`, `pt-br`…). */
  chapterLanguages: readonly string[];
  timeoutMs?: number;
  /** Pages de 500 parutions lues au maximum par synchronisation (borne le coût d'une tâche). */
  maxFeedPages?: number;
};

export const MANGADEX_SITE_URL = 'https://mangadex.org';
const COVERS_URL = 'https://uploads.mangadex.org/covers';
// MangaDex demande un User-Agent identifiable (et bannit les clients anonymes trop bavards).
const USER_AGENT = 'manhwa-tracker/1.0 (+https://github.com/zogeek/manhwa-tracker)';
// Pas de contenu adulte, comme pour AniList (`isAdult: false`).
const CONTENT_RATINGS = ['safe', 'suggestive'];
const FEED_PAGE_SIZE = 500;
// Les tags MangaDex sont binaires (pas de rang communautaire comme AniList) : pertinence fixe.
const THEME_TAG_RELEVANCE = 75;
const MAX_TAGS = 10;
const MAX_ALTERNATIVE_TITLES = 20;
const MAX_SYNOPSIS_LENGTH = 10_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// `numeric(8,2)` : 6 chiffres entiers, 2 décimales au plus.
const CHAPTER_NUMBER_PATTERN = /^\d{1,6}(\.\d{1,2})?$/;

// Zero Trust : la réponse d'un tiers est validée comme n'importe quelle entrée client.
// MangaDex (PHP) sérialise un objet vide en `[]` : on le ramène à `{}`.
const emptyObject = z.array(z.never()).transform((): Record<string, string> => ({}));
const localizedSchema = z.union([z.record(z.string(), z.string()), emptyObject]);

const relationshipSchema = z.object({
  id: z.string(),
  type: z.string(),
  attributes: z.record(z.string(), z.unknown()).nullish(),
});

const mangaSchema = z.object({
  id: z.guid(),
  attributes: z.object({
    title: localizedSchema,
    altTitles: z.array(localizedSchema).nullish(),
    description: localizedSchema.nullish(),
    links: z.union([z.record(z.string(), z.unknown()), emptyObject]).nullish(),
    originalLanguage: z.string().nullish(),
    lastChapter: z.string().nullish(),
    status: z.string().nullish(),
    contentRating: z.string().nullish(),
    tags: z
      .array(z.object({ attributes: z.object({ name: localizedSchema, group: z.string() }) }))
      .nullish(),
  }),
  relationships: z.array(relationshipSchema).nullish(),
});

const chapterSchema = z.object({
  id: z.guid(),
  attributes: z.object({
    chapter: z.string().nullish(),
    title: z.string().nullish(),
    translatedLanguage: z.string().min(2).max(10),
    publishAt: z.iso.datetime({ offset: true }).nullish(),
  }),
  relationships: z.array(relationshipSchema).nullish(),
});

type MangaDexManga = z.infer<typeof mangaSchema>;
type MangaDexChapter = z.infer<typeof chapterSchema>;

const searchResponseSchema = z.object({ data: z.array(mangaSchema) });
const entityResponseSchema = z.object({ data: mangaSchema });
const feedResponseSchema = z.object({
  data: z.array(chapterSchema),
  offset: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});

const STATUS_MAP: Partial<Record<string, Manhwa['status']>> = {
  ongoing: 'ongoing',
  completed: 'completed',
  hiatus: 'hiatus',
  cancelled: 'cancelled',
};

// La langue d'origine distingue manhwa (coréen), manhua (chinois) et manga (japonais, défaut).
const TYPE_BY_LANGUAGE: Partial<Record<string, Manhwa['type']>> = { ko: 'manhwa', zh: 'manhua', 'zh-hk': 'manhua' };
// Codes de langue du domaine (alignés sur l'import AniList) ; les romanisations (`ko-ro`) → `null`.
const TITLE_LANGUAGE: Partial<Record<string, string>> = { ko: 'kr', ja: 'jp', zh: 'cn', 'zh-hk': 'cn' };

const clean = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

function titleLanguage(code: string): string | null {
  if (code.endsWith('-ro')) return null;
  return TITLE_LANGUAGE[code] ?? (/^[a-z]{2}$/.test(code) ? code : null);
}

/** Descriptions MangaDex : Markdown léger (liens, gras, séparateurs) → texte brut. */
function toPlainText(markdown: string | null): string | null {
  if (!markdown) return null;
  const text = markdown
    .replace(/\r\n/g, '\n')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/^\s*-{3,}\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text ? text.slice(0, MAX_SYNOPSIS_LENGTH) : null;
}

function localizedEntries(manga: MangaDexManga): [string, string][] {
  const { title, altTitles } = manga.attributes;
  return [title, ...(altTitles ?? [])].flatMap((localized) => Object.entries(localized));
}

function displayTitle(manga: MangaDexManga): string {
  const english = localizedEntries(manga).find(([language, value]) => language === 'en' && clean(value));
  return clean(english?.[1]) ?? clean(Object.values(manga.attributes.title)[0]) ?? `MangaDex ${manga.id}`;
}

function originalTitle(manga: MangaDexManga): string | null {
  const original = manga.attributes.originalLanguage;
  const entry = original ? localizedEntries(manga).find(([language]) => language === original) : undefined;
  return clean(entry?.[1]);
}

/** Titres alternatifs dédoublonnés (insensible à la casse), sans le titre d'affichage. */
function alternativeTitles(manga: MangaDexManga, title: string): ExternalTitle[] {
  const seen = new Set([title.toLowerCase()]);
  const titles: ExternalTitle[] = [];
  for (const [language, value] of localizedEntries(manga)) {
    const candidate = clean(value);
    if (!candidate || candidate.length > 500 || seen.has(candidate.toLowerCase())) continue;
    seen.add(candidate.toLowerCase());
    titles.push({ title: candidate, language: titleLanguage(language) });
  }
  return titles.slice(0, MAX_ALTERNATIVE_TITLES);
}

function tagNames(manga: MangaDexManga, group: string): string[] {
  const names = (manga.attributes.tags ?? [])
    .filter((tag) => tag.attributes.group === group)
    .map((tag) => clean(tag.attributes.name['en']))
    .filter((name) => name !== null);
  return [...new Set(names)];
}

function coverUrl(manga: MangaDexManga): string | null {
  const cover = manga.relationships?.find((relationship) => relationship.type === 'cover_art');
  const fileName = cover?.attributes?.['fileName'];
  if (typeof fileName !== 'string' || !/^[\w.-]{1,200}$/.test(fileName)) return null;
  // Variante 512 px : largement suffisante pour une vignette, 5 à 10× plus légère que l'original.
  return `${COVERS_URL}/${manga.id}/${fileName}.512.jpg`;
}

/** L'id AniList (`links.al`) permet de reconnaître une œuvre déjà importée depuis AniList. */
function crossReferences(manga: MangaDexManga): ExternalRef[] {
  const anilistId = manga.attributes.links?.['al'];
  if (typeof anilistId !== 'string' || !/^[1-9]\d{0,9}$/.test(anilistId)) return [];
  return [{ provider: 'anilist', externalId: anilistId, url: `https://anilist.co/manga/${anilistId}` }];
}

function totalChapters(manga: MangaDexManga): number | null {
  // `lastChapter` n'est renseigné de façon fiable que pour une série terminée.
  const last = manga.attributes.lastChapter;
  if (manga.attributes.status !== 'completed' || !last || !/^\d{1,6}$/.test(last)) return null;
  return Number(last);
}

/** Traduit une fiche MangaDex dans le vocabulaire du domaine. */
export function toExternalManhwa(manga: MangaDexManga): ExternalManhwa {
  const title = displayTitle(manga);
  const { description, originalLanguage, status } = manga.attributes;
  const tags: ExternalTag[] = tagNames(manga, 'theme')
    .slice(0, MAX_TAGS)
    .map((name) => ({ name, relevance: THEME_TAG_RELEVANCE, isSpoiler: false }));

  return {
    provider: 'mangadex',
    externalId: manga.id.toLowerCase(),
    url: `${MANGADEX_SITE_URL}/title/${manga.id.toLowerCase()}`,
    title,
    originalTitle: originalTitle(manga),
    alternativeTitles: alternativeTitles(manga, title),
    synopsis: toPlainText(clean(description?.['en']) ?? clean(description?.['fr'])),
    coverUrl: coverUrl(manga),
    type: TYPE_BY_LANGUAGE[originalLanguage ?? ''] ?? 'manga',
    status: STATUS_MAP[status ?? ''] ?? 'ongoing',
    totalChapters: totalChapters(manga),
    rating: null, // exposée par un endpoint de statistiques séparé : pas d'appel supplémentaire
    startDate: null, // MangaDex ne donne que l'année : le domaine n'accepte que des dates complètes
    endDate: null,
    genres: tagNames(manga, 'genre'),
    tags,
    crossReferences: crossReferences(manga),
  };
}

/** Parution MangaDex → chapitre du domaine ; `null` pour un one-shot ou un numéro non numérique. */
export function toExternalChapter(chapter: MangaDexChapter): ExternalChapter | null {
  const { chapter: number, title, translatedLanguage, publishAt } = chapter.attributes;
  if (!number || !CHAPTER_NUMBER_PATTERN.test(number)) return null;

  const group = chapter.relationships?.find((relationship) => relationship.type === 'scanlation_group');
  const groupName = group?.attributes?.['name'];
  return {
    externalId: chapter.id,
    number: Number(number),
    title: clean(title)?.slice(0, 500) ?? null,
    language: translatedLanguage,
    url: `${MANGADEX_SITE_URL}/chapter/${chapter.id}`,
    scanlationGroup: typeof groupName === 'string' ? (clean(groupName)?.slice(0, 100) ?? null) : null,
    publishedAt: publishAt ? new Date(publishAt) : null,
  };
}

/**
 * Adaptateur MangaDex (API REST publique, sans clé) : catalogue ET flux de chapitres.
 * Particulièrement riche en manhwas (traductions communautaires), et il pointe vers AniList.
 */
export class MangaDexClient implements ExternalCatalogProvider, ExternalChapterFeed {
  readonly name: ExternalProvider = 'mangadex';
  readonly source: ExternalSource = { name: 'MangaDex', baseUrl: MANGADEX_SITE_URL, language: 'en' };
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxFeedPages: number;

  constructor(private readonly options: MangaDexClientOptions) {
    this.baseUrl = options.url.replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? 8_000;
    this.maxFeedPages = options.maxFeedPages ?? 10;
  }

  async search(query: string, limit: number): Promise<ExternalManhwa[]> {
    const url = this.url('/manga', { title: query, limit: String(limit), 'order[relevance]': 'desc' });
    url.searchParams.append('includes[]', 'cover_art');
    for (const rating of CONTENT_RATINGS) url.searchParams.append('contentRating[]', rating);

    const res = await this.get(url);
    const body = searchResponseSchema.safeParse(await this.json(res));
    if (!res.ok || !body.success) throw new BadGatewayError(`MangaDex search failed (HTTP ${res.status})`);
    return body.data.data.map(toExternalManhwa);
  }

  async findById(externalId: string): Promise<ExternalManhwa | null> {
    if (!UUID_PATTERN.test(externalId)) return null;
    const url = this.url(`/manga/${externalId.toLowerCase()}`);
    url.searchParams.append('includes[]', 'cover_art');

    const res = await this.get(url);
    if (res.status === 404) {
      await res.body?.cancel();
      return null;
    }
    const body = entityResponseSchema.safeParse(await this.json(res));
    if (!res.ok || !body.success) throw new BadGatewayError(`MangaDex lookup failed (HTTP ${res.status})`);
    // Une fiche lue par son id échappe au filtre `contentRating[]` de la recherche : on le réapplique.
    if (!CONTENT_RATINGS.includes(body.data.data.attributes.contentRating ?? 'safe')) return null;
    return toExternalManhwa(body.data.data);
  }

  workUrl(externalId: string): string {
    return `${MANGADEX_SITE_URL}/title/${externalId.toLowerCase()}`;
  }

  async listChapters(externalId: string): Promise<ExternalChapter[]> {
    if (!UUID_PATTERN.test(externalId)) throw new NotFoundError('MangaDex work', externalId);

    const chapters: ExternalChapter[] = [];
    for (let page = 0; page < this.maxFeedPages; page += 1) {
      const url = this.url(`/manga/${externalId.toLowerCase()}/feed`, {
        limit: String(FEED_PAGE_SIZE),
        offset: String(page * FEED_PAGE_SIZE),
        'order[chapter]': 'asc',
      });
      url.searchParams.append('includes[]', 'scanlation_group');
      for (const language of this.options.chapterLanguages) url.searchParams.append('translatedLanguage[]', language);
      for (const rating of CONTENT_RATINGS) url.searchParams.append('contentRating[]', rating);

      const res = await this.get(url);
      if (res.status === 404) {
        await res.body?.cancel();
        throw new NotFoundError('MangaDex work', externalId);
      }
      const body = feedResponseSchema.safeParse(await this.json(res));
      if (!res.ok || !body.success) throw new BadGatewayError(`MangaDex feed failed (HTTP ${res.status})`);

      for (const item of body.data.data) {
        const chapter = toExternalChapter(item);
        if (chapter) chapters.push(chapter);
      }
      if (body.data.data.length === 0 || body.data.offset + body.data.data.length >= body.data.total) break;
    }
    return chapters;
  }

  private url(path: string, params: Record<string, string> = {}): URL {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return url;
  }

  private async get(url: URL): Promise<Response> {
    const res = await this.options
      .fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(this.timeoutMs),
      })
      .catch((error: unknown) => {
        throw new BadGatewayError('MangaDex is unreachable', { cause: error });
      });

    if (res.status === 429) {
      await res.body?.cancel();
      throw new ServiceUnavailableError('MangaDex rate limit reached, retry later');
    }
    return res;
  }

  private async json(res: Response): Promise<unknown> {
    return res.json().catch((error: unknown) => {
      throw new BadGatewayError(`MangaDex returned an invalid body (HTTP ${res.status})`, { cause: error });
    });
  }
}
