import { describe, expect, it } from 'vitest';
import { BadGatewayError, ServiceUnavailableError } from '../../shared/lib/errors.js';
import { createFakeFetch } from '../../test/fake-fetch.js';
import { AniListClient } from './anilist.client.js';
import { aniListDetailsResponse, aniListMedia, aniListSearchResponse, readGraphQLRequest } from './anilist.fixture.test.js';

const ANILIST_URL = 'https://graphql.anilist.test';

describe('AniListClient', () => {
  it('maps an AniList media to the domain vocabulary', async () => {
    const { fetch, calls } = createFakeFetch(() => aniListSearchResponse([aniListMedia()]));
    const client = new AniListClient({ fetch, url: ANILIST_URL });

    const [manhwa] = await client.search('beginning after', 5);

    expect(readGraphQLRequest(calls[0]?.init).variables).toEqual({ search: 'beginning after', perPage: 5 });
    expect(manhwa).toEqual({
      provider: 'anilist',
      externalId: '105398',
      url: 'https://anilist.co/manga/105398',
      title: 'The Beginning After the End',
      originalTitle: '끝이 아닌 시작',
      alternativeTitles: [
        { title: 'Na Honjaman Level Up', language: null },
        { title: '끝이 아닌 시작', language: 'kr' },
        { title: 'TBATE', language: null },
      ],
      synopsis: 'King Grey has unrivaled strength.\n\n(Source: Tapas) & more',
      coverUrl: 'https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/105398.jpg',
      type: 'manhwa',
      status: 'completed',
      totalChapters: 201,
      rating: 8.4,
      startDate: '2018-07-17',
      endDate: null,
      genres: ['Action', 'Adventure', 'Fantasy'],
      // Tag de rang 30 écarté (sous le seuil de pertinence).
      tags: [
        { name: 'Reincarnation', relevance: 95, isSpoiler: false },
        { name: 'Magic', relevance: 90, isSpoiler: false },
      ],
      crossReferences: [],
    });
  });

  it('derives the type from the country of origin and falls back to the romaji title', async () => {
    const { fetch } = createFakeFetch(() =>
      aniListSearchResponse([
        aniListMedia({ id: 1, countryOfOrigin: 'CN', english: null }),
        aniListMedia({ id: 2, countryOfOrigin: 'JP', status: 'RELEASING' }),
      ]),
    );
    const [manhua, manga] = await new AniListClient({ fetch, url: ANILIST_URL }).search('x', 2);

    expect(manhua?.type).toBe('manhua');
    expect(manhua?.title).toBe('Na Honjaman Level Up');
    expect(manga).toMatchObject({ type: 'manga', status: 'ongoing' });
  });

  it('returns null for an unknown or malformed id without calling AniList for the latter', async () => {
    const { fetch, calls } = createFakeFetch(() => aniListDetailsResponse(null));
    const client = new AniListClient({ fetch, url: ANILIST_URL });

    expect(await client.findById('999999')).toBeNull();
    expect(await client.findById('not-a-number')).toBeNull();
    expect(await client.findById('99999999999')).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it('rejects an unexpected response shape (zero trust on third-party data)', async () => {
    const { fetch } = createFakeFetch(() => Response.json({ data: { Page: { media: [{ id: 'oops' }] } } }));

    await expect(new AniListClient({ fetch, url: ANILIST_URL }).search('x', 1)).rejects.toBeInstanceOf(BadGatewayError);
  });

  it('refuses a cover served over plain http', async () => {
    const media = { ...aniListMedia(), coverImage: { extraLarge: 'http://evil.example/cover.jpg', large: null } };
    const { fetch } = createFakeFetch(() => aniListSearchResponse([media]));

    await expect(new AniListClient({ fetch, url: ANILIST_URL }).search('x', 1)).rejects.toBeInstanceOf(BadGatewayError);
  });

  it('maps HTTP 429 to 503 and network failures to 502', async () => {
    const limited = createFakeFetch(() => new Response('Too Many Requests', { status: 429 }));
    await expect(new AniListClient({ fetch: limited.fetch, url: ANILIST_URL }).search('x', 1)).rejects.toBeInstanceOf(
      ServiceUnavailableError,
    );

    const down = createFakeFetch(() => {
      throw new TypeError('fetch failed');
    });
    await expect(new AniListClient({ fetch: down.fetch, url: ANILIST_URL }).search('x', 1)).rejects.toBeInstanceOf(
      BadGatewayError,
    );
  });
});
