import { z } from 'zod';
import type { HttpFetch } from '../../shared/http/outbound.js';
import { BadGatewayError, ServiceUnavailableError } from '../../shared/lib/errors.js';
import type { Manhwa } from '../manhwas/manhwa.schema.js';
import type {
  ExternalCatalogProvider,
  ExternalManhwa,
  ExternalProvider,
  ExternalTag,
  ExternalTitle,
} from './external-catalog.js';

export type AniListClientOptions = {
  fetch: HttpFetch;
  /** Endpoint GraphQL (`https://graphql.anilist.co`). */
  url: string;
  timeoutMs?: number;
};

// Seuls les tags jugés pertinents par la communauté AniList sont importés (évite le bruit).
const MIN_TAG_RANK = 60;
const MAX_TAGS = 10;
const MAX_ALTERNATIVE_TITLES = 20;
const MAX_SYNOPSIS_LENGTH = 10_000;

const MEDIA_FIELDS = `
  id siteUrl format status countryOfOrigin chapters averageScore
  title { romaji english native }
  synonyms
  description(asHtml: false)
  startDate { year month day }
  endDate { year month day }
  coverImage { extraLarge large }
  genres
  tags { name rank isMediaSpoiler }
`;

// Filtres côté AniList : mangas uniquement, ni romans ni contenu adulte.
const SEARCH_QUERY = `query ($search: String!, $perPage: Int!) {
  Page(perPage: $perPage) {
    media(search: $search, type: MANGA, format_not: NOVEL, isAdult: false, sort: SEARCH_MATCH) { ${MEDIA_FIELDS} }
  }
}`;

const DETAILS_QUERY = `query ($id: Int!) {
  Media(id: $id, type: MANGA, format_not: NOVEL, isAdult: false) { ${MEDIA_FIELDS} }
}`;

// Zero Trust : la réponse d'un tiers est validée comme n'importe quelle entrée client.
const fuzzyDateSchema = z
  .object({ year: z.number().int().nullable(), month: z.number().int().nullable(), day: z.number().int().nullable() })
  .nullable();

const httpsUrlSchema = z.url({ protocol: /^https$/ });

const mediaSchema = z.object({
  id: z.number().int().positive(),
  siteUrl: httpsUrlSchema.nullable(),
  format: z.string().nullable(),
  status: z.string().nullable(),
  countryOfOrigin: z.string().nullable(),
  chapters: z.number().int().nonnegative().nullable(),
  averageScore: z.number().min(0).max(100).nullable(),
  title: z.object({ romaji: z.string().nullable(), english: z.string().nullable(), native: z.string().nullable() }),
  synonyms: z.array(z.string()).nullable(),
  description: z.string().nullable(),
  startDate: fuzzyDateSchema,
  endDate: fuzzyDateSchema,
  coverImage: z.object({ extraLarge: httpsUrlSchema.nullable(), large: httpsUrlSchema.nullable() }).nullable(),
  genres: z.array(z.string()).nullable(),
  tags: z
    .array(z.object({ name: z.string(), rank: z.number().nullable(), isMediaSpoiler: z.boolean().nullable() }))
    .nullable(),
});

type AniListMedia = z.infer<typeof mediaSchema>;

const searchResponseSchema = z.object({ data: z.object({ Page: z.object({ media: z.array(mediaSchema) }) }) });
const detailsResponseSchema = z.object({ data: z.object({ Media: mediaSchema.nullable() }) });

const STATUS_MAP: Partial<Record<string, Manhwa['status']>> = {
  RELEASING: 'ongoing',
  NOT_YET_RELEASED: 'ongoing',
  FINISHED: 'completed',
  HIATUS: 'hiatus',
  CANCELLED: 'cancelled',
};

// Le pays d'origine distingue manhwa (Corée), manhua (Chine/Taïwan) et manga (Japon, défaut).
const TYPE_BY_COUNTRY: Partial<Record<string, Manhwa['type']>> = { KR: 'manhwa', CN: 'manhua', TW: 'manhua' };
const LANGUAGE_BY_COUNTRY: Partial<Record<string, string>> = { KR: 'kr', JP: 'jp', CN: 'cn', TW: 'cn' };

const clean = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

function toIsoDate(date: AniListMedia['startDate']): string | null {
  if (!date?.year || !date.month || !date.day) return null;
  return `${String(date.year).padStart(4, '0')}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
}

/** Descriptions AniList : HTML léger (`<br>`, `<i>`…) → texte brut. */
function toPlainText(description: string | null): string | null {
  if (!description) return null;
  const text = description
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text ? text.slice(0, MAX_SYNOPSIS_LENGTH) : null;
}

/** Titres alternatifs dédoublonnés (insensible à la casse), sans le titre d'affichage. */
function alternativeTitles(media: AniListMedia, displayTitle: string): ExternalTitle[] {
  const nativeLanguage = LANGUAGE_BY_COUNTRY[media.countryOfOrigin ?? ''] ?? null;
  const candidates: ExternalTitle[] = [
    { title: clean(media.title.english) ?? '', language: 'en' },
    { title: clean(media.title.romaji) ?? '', language: null },
    { title: clean(media.title.native) ?? '', language: nativeLanguage },
    ...(media.synonyms ?? []).map((synonym) => ({ title: clean(synonym) ?? '', language: null })),
  ];

  const seen = new Set([displayTitle.toLowerCase()]);
  const titles: ExternalTitle[] = [];
  for (const candidate of candidates) {
    const key = candidate.title.toLowerCase();
    if (!candidate.title || candidate.title.length > 500 || seen.has(key)) continue;
    seen.add(key);
    titles.push(candidate);
  }
  return titles.slice(0, MAX_ALTERNATIVE_TITLES);
}

function relevantTags(media: AniListMedia): ExternalTag[] {
  return (media.tags ?? [])
    .filter((tag) => (tag.rank ?? 0) >= MIN_TAG_RANK)
    .sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0))
    .slice(0, MAX_TAGS)
    .map((tag) => ({
      name: tag.name.trim(),
      relevance: Math.min(100, Math.max(0, Math.round(tag.rank ?? 0))),
      isSpoiler: tag.isMediaSpoiler ?? false,
    }));
}

/** Traduit une fiche AniList dans le vocabulaire du domaine. */
export function toExternalManhwa(media: AniListMedia): ExternalManhwa {
  const title =
    clean(media.title.english) ?? clean(media.title.romaji) ?? clean(media.title.native) ?? `AniList #${media.id}`;

  return {
    provider: 'anilist',
    externalId: String(media.id),
    url: media.siteUrl,
    title,
    originalTitle: clean(media.title.native),
    alternativeTitles: alternativeTitles(media, title),
    synopsis: toPlainText(media.description),
    coverUrl: media.coverImage?.extraLarge ?? media.coverImage?.large ?? null,
    type: TYPE_BY_COUNTRY[media.countryOfOrigin ?? ''] ?? 'manga',
    status: STATUS_MAP[media.status ?? ''] ?? 'ongoing',
    totalChapters: media.chapters,
    rating: media.averageScore === null ? null : Math.round(media.averageScore) / 10,
    startDate: toIsoDate(media.startDate),
    endDate: toIsoDate(media.endDate),
    genres: [...new Set((media.genres ?? []).map((genre) => genre.trim()).filter(Boolean))],
    tags: relevantTags(media),
  };
}

/** Adaptateur AniList (API GraphQL publique, sans clé) du port `ExternalCatalogProvider`. */
export class AniListClient implements ExternalCatalogProvider {
  readonly name: ExternalProvider = 'anilist';
  private readonly timeoutMs: number;

  constructor(private readonly options: AniListClientOptions) {
    this.timeoutMs = options.timeoutMs ?? 8_000;
  }

  async search(query: string, limit: number): Promise<ExternalManhwa[]> {
    const res = await this.post(SEARCH_QUERY, { search: query, perPage: limit });
    const body = searchResponseSchema.safeParse(await this.json(res));
    if (!res.ok || !body.success) throw new BadGatewayError(`AniList search failed (HTTP ${res.status})`);
    return body.data.data.Page.media.map(toExternalManhwa);
  }

  async findById(externalId: string): Promise<ExternalManhwa | null> {
    // Les identifiants AniList sont des entiers : tout le reste ne peut pas exister chez eux.
    if (!/^[1-9]\d{0,9}$/.test(externalId)) return null;
    const id = Number(externalId);
    if (!Number.isSafeInteger(id) || id > 2_147_483_647) return null;

    const res = await this.post(DETAILS_QUERY, { id });
    if (res.status === 404) return null;
    const body = detailsResponseSchema.safeParse(await this.json(res));
    if (!res.ok || !body.success) throw new BadGatewayError(`AniList lookup failed (HTTP ${res.status})`);
    return body.data.data.Media ? toExternalManhwa(body.data.data.Media) : null;
  }

  private async post(query: string, variables: Record<string, string | number>): Promise<Response> {
    const res = await this.options
      .fetch(this.options.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
      .catch((error: unknown) => {
        throw new BadGatewayError('AniList is unreachable', { cause: error });
      });

    if (res.status === 429) {
      await res.body?.cancel();
      throw new ServiceUnavailableError('AniList rate limit reached, retry later');
    }
    return res;
  }

  private async json(res: Response): Promise<unknown> {
    return res.json().catch((error: unknown) => {
      throw new BadGatewayError(`AniList returned an invalid body (HTTP ${res.status})`, { cause: error });
    });
  }
}
