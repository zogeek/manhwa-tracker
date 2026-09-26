import { describe, expect, it } from 'vitest';
import { BadGatewayError, ServiceUnavailableError } from '../../shared/lib/errors.js';
import { createFakeFetch, type FakeHandler } from '../../test/fake-fetch.js';
import { KitsuClient } from './kitsu.client.js';
import { kitsuEntityResponse, kitsuManga, kitsuSearchResponse, TBATE_KITSU_ID } from './kitsu.fixture.test.js';

function createClient(handler: FakeHandler) {
  const fake = createFakeFetch(handler);
  return { client: new KitsuClient({ fetch: fake.fetch, url: 'https://kitsu.test/api/edge/' }), calls: fake.calls };
}

describe('KitsuClient.search', () => {
  it('maps a Kitsu work (and its included resources) into the domain vocabulary', async () => {
    const { client, calls } = createClient(() => kitsuSearchResponse([kitsuManga()]));

    const [manhwa] = await client.search('beginning after', 5);

    const url = calls[0]?.url;
    expect(url?.pathname).toBe('/api/edge/manga');
    expect(url?.searchParams.get('filter[text]')).toBe('beginning after');
    expect(url?.searchParams.get('page[limit]')).toBe('5');
    expect(url?.searchParams.get('include')).toBe('categories,mappings');
    expect(calls[0]?.init?.headers).toMatchObject({ Accept: 'application/vnd.api+json' });

    expect(manhwa).toEqual({
      provider: 'kitsu',
      externalId: TBATE_KITSU_ID,
      url: `https://kitsu.app/manga/${TBATE_KITSU_ID}`,
      title: 'The Beginning After the End',
      originalTitle: '끝이 아닌 시작',
      alternativeTitles: [
        { title: 'Kkeut-i Anin Sijak', language: null },
        { title: '끝이 아닌 시작', language: 'kr' },
        { title: 'TBATE', language: null },
      ],
      synopsis: 'King Grey has unrivaled strength, wealth, and prestige.',
      coverUrl: `https://media.kitsu.app/manga/poster_images/${TBATE_KITSU_ID}/large.jpg`,
      type: 'manhwa',
      status: 'ongoing',
      totalChapters: null,
      rating: 8.4,
      startDate: '2018-07-17',
      endDate: null,
      genres: ['Action', 'Fantasy'],
      tags: [
        { name: 'Magic', relevance: 60, isSpoiler: false },
        { name: 'Reincarnation', relevance: 60, isSpoiler: false },
      ],
      // Seule la correspondance AniList nous concerne (MyAnimeList n'est pas un de nos fournisseurs).
      crossReferences: [{ provider: 'anilist', externalId: '105398', url: 'https://anilist.co/manga/105398' }],
    });
  });

  it('caps the page size to the Kitsu maximum and filters out novels and adult works', async () => {
    const { client, calls } = createClient(() =>
      kitsuSearchResponse([
        kitsuManga({ id: '1', subtype: 'novel' }),
        kitsuManga({ id: '2', ageRating: 'R18' }),
        kitsuManga({ id: '3', subtype: 'manhua', status: 'finished', titles: { en_cn: 'Wu Dong Qian Kun' }, averageRating: null, startDate: '2014' }),
      ]),
    );

    const results = await client.search('x', 25);

    expect(calls[0]?.url.searchParams.get('page[limit]')).toBe('20');
    expect(results).toMatchObject([
      // Pas de titre anglais : le titre canonique prend le relais ; date partielle et note absente → null.
      { externalId: '3', type: 'manhua', status: 'completed', title: 'The Beginning After The End', rating: null, startDate: null },
    ]);
  });

  it('turns a 429 into a rate-limit error and an unexpected body into a bad gateway', async () => {
    await expect(createClient(() => new Response(null, { status: 429 })).client.search('x', 5)).rejects.toBeInstanceOf(
      ServiceUnavailableError,
    );
    await expect(
      createClient(() => Response.json({ data: [{ id: 'abc', type: 'manga' }] })).client.search('x', 5),
    ).rejects.toBeInstanceOf(BadGatewayError);
    await expect(
      createClient(() => {
        throw new TypeError('fetch failed');
      }).client.search('x', 5),
    ).rejects.toBeInstanceOf(BadGatewayError);
  });
});

describe('KitsuClient.findById', () => {
  it('reads a work with its categories and mappings', async () => {
    const { client, calls } = createClient(() => kitsuEntityResponse(kitsuManga()));

    const manhwa = await client.findById(TBATE_KITSU_ID);

    expect(calls[0]?.url.pathname).toBe(`/api/edge/manga/${TBATE_KITSU_ID}`);
    expect(manhwa).toMatchObject({ externalId: TBATE_KITSU_ID, genres: ['Action', 'Fantasy'] });
  });

  it('returns null for an unknown work, a malformed id (without calling Kitsu) or an adult work', async () => {
    expect(await createClient(() => kitsuEntityResponse(null)).client.findById('999')).toBeNull();

    const malformed = createClient(() => kitsuEntityResponse(kitsuManga()));
    expect(await malformed.client.findById('../users')).toBeNull();
    expect(malformed.calls).toHaveLength(0);

    expect(await createClient(() => kitsuEntityResponse(kitsuManga({ ageRating: 'R18' }))).client.findById('1')).toBeNull();
  });
});
