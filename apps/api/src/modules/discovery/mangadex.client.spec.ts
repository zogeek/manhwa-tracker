import { describe, expect, it } from 'vitest';
import { BadGatewayError, NotFoundError, ServiceUnavailableError } from '../../shared/lib/errors.js';
import { createFakeFetch, type FakeHandler } from '../../test/fake-fetch.js';
import {
  mangaDexChapter,
  mangaDexEntityResponse,
  mangaDexFeedResponse,
  mangaDexManga,
  mangaDexSearchResponse,
  TBATE_MANGADEX_ID,
} from './mangadex.fixture.test.js';
import { MangaDexClient } from './mangadex.client.js';

function createClient(handler: FakeHandler, maxFeedPages?: number) {
  const fake = createFakeFetch(handler);
  const client = new MangaDexClient({
    fetch: fake.fetch,
    url: 'https://api.mangadex.test/',
    chapterLanguages: ['fr', 'en'],
    maxFeedPages,
  });
  return { client, calls: fake.calls };
}

describe('MangaDexClient.search', () => {
  it('maps a MangaDex work into the domain vocabulary', async () => {
    const { client, calls } = createClient(() => mangaDexSearchResponse([mangaDexManga()]));

    const [manhwa] = await client.search('beginning after', 5);

    const url = calls[0]?.url;
    expect(url?.pathname).toBe('/manga');
    expect(url?.searchParams.get('title')).toBe('beginning after');
    expect(url?.searchParams.get('limit')).toBe('5');
    expect(url?.searchParams.getAll('contentRating[]')).toEqual(['safe', 'suggestive']);
    expect(url?.searchParams.getAll('includes[]')).toEqual(['cover_art', 'author', 'artist']);
    expect(calls[0]?.init?.headers).toMatchObject({ 'User-Agent': expect.stringContaining('manhwa-tracker') });

    expect(manhwa).toEqual({
      provider: 'mangadex',
      externalId: TBATE_MANGADEX_ID,
      url: `https://mangadex.org/title/${TBATE_MANGADEX_ID}`,
      title: 'The Beginning After the End',
      originalTitle: '끝이 아닌 시작',
      alternativeTitles: [
        { title: '끝이 아닌 시작', language: 'kr' },
        { title: 'Kkeut-i Anin Sijak', language: null },
        { title: 'TBATE', language: 'en' },
        { title: 'Le Commencement après la fin', language: 'fr' },
      ],
      synopsis: 'King Grey has unrivaled strength.\n\nOfficial',
      coverUrl: `https://uploads.mangadex.org/covers/${TBATE_MANGADEX_ID}/b1461071-cover.jpg.512.jpg`,
      type: 'manhwa',
      status: 'completed',
      totalChapters: 175,
      rating: null,
      startDate: null,
      endDate: null,
      genres: ['Action', 'Fantasy'],
      // Les tags de format (« Long Strip ») ne sont pas des thèmes.
      tags: [
        { name: 'Reincarnation', relevance: 75, isSpoiler: false },
        { name: 'Magic', relevance: 75, isSpoiler: false },
      ],
      // Une même personne citée comme « author » ET « artist » devient un seul auteur « both ».
      authors: [
        { name: 'Turtle-Me', nativeName: '터틀미', role: 'story' }, // « Turtle-Me (터틀미) » côté MangaDex
        { name: 'Fuyuki23', nativeName: null, role: 'art' },
        { name: 'Studio Waveon', nativeName: null, role: 'both' },
      ],
      crossReferences: [{ provider: 'anilist', externalId: '105398', url: 'https://anilist.co/manga/105398' }],
    });
  });

  it('tolerates the PHP quirks of the API (empty objects serialized as [])', async () => {
    const { client } = createClient(() =>
      mangaDexSearchResponse([
        mangaDexManga({ links: [], description: [], originalLanguage: 'zh', status: 'ongoing', title: { 'zh-ro': 'Wu Dong Qian Kun' } }),
      ]),
    );

    const [manhwa] = await client.search('wu dong', 5);

    expect(manhwa).toMatchObject({
      // Pas de titre anglais dans `title` : le premier titre anglais des altTitles l'emporte sur la romanisation.
      title: 'TBATE',
      type: 'manhua',
      status: 'ongoing',
      synopsis: null,
      totalChapters: null, // `lastChapter` ignoré tant que la série n'est pas terminée
      crossReferences: [],
    });
  });

  it('turns a 429 into a rate-limit error and an unexpected body into a bad gateway', async () => {
    await expect(createClient(() => new Response(null, { status: 429 })).client.search('x', 5)).rejects.toBeInstanceOf(
      ServiceUnavailableError,
    );
    await expect(createClient(() => Response.json({ data: [{ id: 'nope' }] })).client.search('x', 5)).rejects.toBeInstanceOf(
      BadGatewayError,
    );
    await expect(
      createClient(() => {
        throw new TypeError('fetch failed');
      }).client.search('x', 5),
    ).rejects.toBeInstanceOf(BadGatewayError);
  });
});

describe('MangaDexClient.findById', () => {
  it('reads a work by its UUID (case-insensitive) and returns its canonical lowercase id', async () => {
    const { client, calls } = createClient(() => mangaDexEntityResponse(mangaDexManga()));

    const manhwa = await client.findById(TBATE_MANGADEX_ID.toUpperCase());

    expect(calls[0]?.url.pathname).toBe(`/manga/${TBATE_MANGADEX_ID}`);
    expect(manhwa?.externalId).toBe(TBATE_MANGADEX_ID);
  });

  it('returns null for an unknown work, a malformed id (without calling MangaDex) or adult content', async () => {
    const missing = createClient(() => mangaDexEntityResponse(null));
    expect(await missing.client.findById(TBATE_MANGADEX_ID)).toBeNull();

    const malformed = createClient(() => mangaDexEntityResponse(mangaDexManga()));
    expect(await malformed.client.findById('../manga')).toBeNull();
    expect(malformed.calls).toHaveLength(0);

    const adult = createClient(() => mangaDexEntityResponse(mangaDexManga({ contentRating: 'pornographic' })));
    expect(await adult.client.findById(TBATE_MANGADEX_ID)).toBeNull();
  });
});

describe('MangaDexClient.listChapters', () => {
  it('maps releases and skips one-shots and non-numeric chapters', async () => {
    const { client, calls } = createClient(() =>
      mangaDexFeedResponse([
        mangaDexChapter({ chapter: '1', translatedLanguage: 'fr', group: 'Scan FR' }),
        mangaDexChapter({ chapter: '10.5', title: '  ', group: null }),
        mangaDexChapter({ chapter: null }),
        mangaDexChapter({ chapter: 'Extra' }),
      ]),
    );

    const chapters = await client.listChapters(TBATE_MANGADEX_ID);

    const url = calls[0]?.url;
    expect(url?.pathname).toBe(`/manga/${TBATE_MANGADEX_ID}/feed`);
    expect(url?.searchParams.getAll('translatedLanguage[]')).toEqual(['fr', 'en']);
    expect(url?.searchParams.get('order[chapter]')).toBe('asc');
    expect(chapters).toEqual([
      {
        externalId: expect.any(String),
        number: 1,
        title: 'Prologue',
        language: 'fr',
        url: expect.stringMatching(/^https:\/\/mangadex\.org\/chapter\//),
        scanlationGroup: 'Scan FR',
        publishedAt: new Date('2021-03-05T14:57:57Z'),
      },
      expect.objectContaining({ number: 10.5, title: null, scanlationGroup: null, language: 'en' }),
    ]);
  });

  it('follows the pagination, bounded by maxFeedPages', async () => {
    const { client, calls } = createClient(
      ({ url }) =>
        mangaDexFeedResponse([mangaDexChapter({ chapter: url.searchParams.get('offset') === '0' ? '1' : '2' })], Number(url.searchParams.get('offset')), 5_000),
      2,
    );

    const chapters = await client.listChapters(TBATE_MANGADEX_ID);

    expect(calls.map((call) => call.url.searchParams.get('offset'))).toEqual(['0', '500']);
    expect(chapters.map((chapter) => chapter.number)).toEqual([1, 2]);
  });

  it('throws NotFoundError for an unknown work', async () => {
    const { client } = createClient(() => new Response(null, { status: 404 }));

    await expect(client.listChapters(TBATE_MANGADEX_ID)).rejects.toBeInstanceOf(NotFoundError);
    await expect(client.listChapters('not-a-uuid')).rejects.toBeInstanceOf(NotFoundError);
  });
});
