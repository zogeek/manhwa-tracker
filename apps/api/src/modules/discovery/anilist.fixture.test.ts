// Réponses AniList factices (forme réelle de l'API GraphQL), partagées par les tests unitaires et d'intégration.

type MediaOverrides = Partial<{
  id: number;
  english: string | null;
  romaji: string | null;
  native: string | null;
  countryOfOrigin: string;
  status: string;
  genres: string[];
  tags: { name: string; rank: number; isMediaSpoiler: boolean }[];
}>;

export function aniListMedia(overrides: MediaOverrides = {}) {
  const id = overrides.id ?? 105398;
  return {
    id,
    siteUrl: `https://anilist.co/manga/${id}`,
    format: 'MANGA',
    status: overrides.status ?? 'FINISHED',
    countryOfOrigin: overrides.countryOfOrigin ?? 'KR',
    chapters: 201,
    averageScore: 84,
    title: {
      romaji: overrides.romaji === undefined ? 'Na Honjaman Level Up' : overrides.romaji,
      english: overrides.english === undefined ? 'The Beginning After the End' : overrides.english,
      native: overrides.native === undefined ? '끝이 아닌 시작' : overrides.native,
    },
    synonyms: ['TBATE', 'the beginning after the end'],
    description: 'King Grey has unrivaled strength.<br><br><i>(Source: Tapas)</i> &amp; more',
    startDate: { year: 2018, month: 7, day: 17 },
    endDate: { year: null, month: null, day: null },
    coverImage: { extraLarge: `https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/${id}.jpg`, large: null },
    genres: overrides.genres ?? ['Action', 'Adventure', 'Fantasy'],
    tags: overrides.tags ?? [
      { name: 'Reincarnation', rank: 95, isMediaSpoiler: false },
      { name: 'Magic', rank: 90, isMediaSpoiler: false },
      { name: 'Tragedy', rank: 30, isMediaSpoiler: true },
    ],
  };
}

export const aniListSearchResponse = (media: ReturnType<typeof aniListMedia>[]) =>
  Response.json({ data: { Page: { media } } });

export const aniListDetailsResponse = (media: ReturnType<typeof aniListMedia> | null) =>
  Response.json({ data: { Media: media } }, { status: media ? 200 : 404 });

/** Lit la requête GraphQL envoyée à AniList (le faux `fetch` route selon la présence de `$search`). */
export function readGraphQLRequest(init: RequestInit | undefined): { query: string; variables: Record<string, unknown> } {
  const raw = typeof init?.body === 'string' ? init.body : '{}';
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null || !('query' in parsed) || typeof parsed.query !== 'string') {
    return { query: '', variables: {} };
  }
  const variables =
    'variables' in parsed && typeof parsed.variables === 'object' && parsed.variables !== null
      ? Object.fromEntries(Object.entries(parsed.variables))
      : {};
  return { query: parsed.query, variables };
}
