import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  authors,
  chapterReleases,
  chapters,
  externalLinks,
  jobs,
  manhwaAuthors,
  manhwaCovers,
  manhwaSources,
  manhwaTerms,
  manhwaTitles,
  manhwas as manhwasTable,
  sources,
  termAliases,
  terms,
  vocabularies,
} from '../../shared/db/schema.js';
import { firstOrThrow } from '../../shared/db/utils.js';
import { seedCatalog, type SeededCatalog } from '../../shared/db/seed.test.js';
import { createFakeFetch } from '../../test/fake-fetch.js';
import { createTestContext, signUp, signUpAdmin, type TestUser } from '../../test/integration.js';
import { aniListDetailsResponse, aniListMedia, aniListSearchResponse, readGraphQLRequest } from './anilist.fixture.test.js';
import {
  mangaDexChapter,
  mangaDexEntityResponse,
  mangaDexFeedResponse,
  mangaDexManga,
  mangaDexSearchResponse,
  TBATE_MANGADEX_ID,
} from './mangadex.fixture.test.js';
import { kitsuEntityResponse, kitsuManga, kitsuSearchResponse, TBATE_KITSU_ID } from './kitsu.fixture.test.js';

const TBATE_ID = '105398';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Faux Internet : AniList et MangaDex connaissent une seule œuvre, « The Beginning After the End »
// (MangaDex pointe vers son id AniList), et leurs CDN servent une couverture PNG.
let mangadexFeedDown = false;
// Constant d'un appel à l'autre, comme le vrai flux : mêmes parutions, mêmes ids.
const TBATE_FEED = [
  mangaDexChapter({ chapter: '1', translatedLanguage: 'en' }),
  mangaDexChapter({ chapter: '1', translatedLanguage: 'fr', group: 'Scan FR' }),
  mangaDexChapter({ chapter: '2' }),
  mangaDexChapter({ chapter: null }), // one-shot : ignoré
];
const upstream = createFakeFetch(({ url, init }) => {
  if (url.hostname === 'graphql.anilist.test') {
    const { query, variables } = readGraphQLRequest(init);
    if (query.includes('Page(')) {
      const search = String(variables['search']).toLowerCase();
      return aniListSearchResponse(search.includes('beginning') ? [aniListMedia()] : []);
    }
    return aniListDetailsResponse(String(variables['id']) === TBATE_ID ? aniListMedia() : null);
  }
  if (url.hostname === 'api.mangadex.test') {
    if (url.pathname === '/manga') {
      const title = (url.searchParams.get('title') ?? '').toLowerCase();
      return mangaDexSearchResponse(title.includes('beginning') ? [mangaDexManga()] : []);
    }
    if (url.pathname === `/manga/${TBATE_MANGADEX_ID}/feed`) {
      if (mangadexFeedDown) return new Response(null, { status: 503 });
      return mangaDexFeedResponse(TBATE_FEED);
    }
    return mangaDexEntityResponse(url.pathname === `/manga/${TBATE_MANGADEX_ID}` ? mangaDexManga() : null);
  }
  if (url.hostname === 'kitsu.test') {
    if (url.pathname === '/api/edge/manga') {
      const text = (url.searchParams.get('filter[text]') ?? '').toLowerCase();
      return kitsuSearchResponse(text.includes('beginning') ? [kitsuManga()] : []);
    }
    return kitsuEntityResponse(url.pathname === `/api/edge/manga/${TBATE_KITSU_ID}` ? kitsuManga() : null);
  }
  if (url.hostname === 's4.anilist.co' || url.hostname === 'uploads.mangadex.org' || url.hostname === 'media.kitsu.app') {
    return new Response(PNG, { headers: { 'Content-Type': 'image/png' } });
  }
  return new Response(null, { status: 404 });
});

const context = createTestContext({ fetch: upstream.fetch });
const { manhwas, taxonomy } = context.client;

let catalog: SeededCatalog;
let reader: TestUser;
let admin: TestUser;

beforeEach(async () => {
  catalog = await seedCatalog(context.db);
  reader = await signUp(context, 'reader');
  admin = await signUpAdmin(context, 'admin');
  upstream.calls.length = 0;
  mangadexFeedDown = false;
});

afterAll(() => context.close());

const search = (q: string, external?: 'true', providers?: string) =>
  manhwas.search.$get({ query: { q, ...(external ? { external } : {}), ...(providers ? { providers } : {}) } });

const importTbate = (user: TestUser) =>
  manhwas.import.$post({ json: { provider: 'anilist', externalId: TBATE_ID } }, { headers: user.headers });

const importTbateFromMangaDex = (user: TestUser) =>
  manhwas.import.$post({ json: { provider: 'mangadex', externalId: TBATE_MANGADEX_ID } }, { headers: user.headers });

async function termSlugsOf(manhwaId: string) {
  const rows = await context.db
    .select({ slug: terms.slug, vocabulary: vocabularies.slug, relevance: manhwaTerms.relevance, source: manhwaTerms.source })
    .from(manhwaTerms)
    .innerJoin(terms, eq(terms.id, manhwaTerms.termId))
    .innerJoin(vocabularies, eq(vocabularies.id, terms.vocabularyId))
    .where(eq(manhwaTerms.manhwaId, manhwaId));
  return rows.map((row) => `${row.vocabulary}:${row.slug}`).sort();
}

describe('GET /manhwas/search — local fuzzy search (pg_trgm)', () => {
  it('tolerates typos and answers locally without calling AniList', async () => {
    const res = await search('Solo Levling');

    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.local.map((hit) => hit.title)).toEqual(['Solo Leveling']);
    expect(data.local[0]?.score).toBeGreaterThan(0.4);
    expect(data.providers).toEqual([]);
    expect(upstream.calls).toHaveLength(0);
  });

  it('matches alternative titles and aliases', async () => {
    await context.db.insert(manhwaTitles).values({ manhwaId: catalog.manhwa.id, title: 'Only I Level Up', language: 'en' });

    const { data } = await (await search('only i levl up')).json();

    expect(data.local.map((hit) => hit.id)).toEqual([catalog.manhwa.id]);
  });

  it('treats LIKE wildcards literally', async () => {
    const { data } = await (await search('%_%')).json();

    expect(data.local).toEqual([]);
  });

  it('excludes soft-deleted manhwas', async () => {
    await context.client.manhwas[':id'].$delete({ param: { id: catalog.manhwa.id } }, { headers: admin.headers });

    const { data } = await (await search('Solo Leveling')).json();
    expect(data.local).toEqual([]);
  });

  it('validates the query', async () => {
    const tooShort = await search('a');
    expect(tooShort.status).toBe(400);
    expect(upstream.calls).toHaveLength(0);
  });
});

describe('GET /manhwas/search — external fallback (AniList + MangaDex + Kitsu)', () => {
  it('proposes results from every enabled provider when nothing matches locally', async () => {
    const { data } = await (await search('Beginning After')).json();

    expect(data.local).toEqual([]);
    expect(data.providers).toEqual([
      { provider: 'anilist', status: 'ok' },
      { provider: 'mangadex', status: 'ok' },
      { provider: 'kitsu', status: 'ok' },
    ]);
    expect(upstream.calls.map((call) => call.url.hostname).sort()).toEqual([
      'api.mangadex.test',
      'graphql.anilist.test',
      'kitsu.test',
    ]);
    expect(data.external).toMatchObject([
      { provider: 'anilist', externalId: TBATE_ID, title: 'The Beginning After the End', importedManhwaId: null },
      {
        provider: 'mangadex',
        externalId: TBATE_MANGADEX_ID,
        crossReferences: [{ provider: 'anilist', externalId: TBATE_ID }],
        importedManhwaId: null,
      },
      {
        provider: 'kitsu',
        externalId: TBATE_KITSU_ID,
        type: 'manhwa',
        crossReferences: [{ provider: 'anilist', externalId: TBATE_ID }],
        importedManhwaId: null,
      },
    ]);
  });

  it('queries only the providers requested by the client', async () => {
    const { data } = await (await search('Beginning After', undefined, 'mangadex')).json();

    expect(data.providers).toEqual([{ provider: 'mangadex', status: 'ok' }]);
    // (MangaDex a pu répondre depuis le cache de recherche : on vérifie seulement qu'AniList n'est pas sollicité.)
    expect(upstream.calls.filter((call) => call.url.hostname === 'graphql.anilist.test')).toEqual([]);

    const invalid = await search('Beginning After', undefined, 'anilist,mal');
    expect(invalid.status).toBe(400);
  });

  it('ignores providers disabled on the server', async () => {
    const anilistOnly = createTestContext({ fetch: upstream.fetch, discoveryProviders: ['anilist'] });
    const res = await anilistOnly.client.manhwas.search.$get({ query: { q: 'Beginning After', providers: 'mangadex' } });
    const importRes = await anilistOnly.client.manhwas.import.$post(
      { json: { provider: 'mangadex', externalId: TBATE_MANGADEX_ID } },
      { headers: reader.headers },
    );
    await anilistOnly.close();

    expect((await res.json()).data.providers).toEqual([]);
    expect(importRes.status).toBe(400);
  });

  it('reports each provider as unavailable instead of failing', async () => {
    const offline = createTestContext();
    const res = await offline.client.manhwas.search.$get({ query: { q: 'nothing like this' } });
    await offline.close();

    expect(res.status).toBe(200);
    expect((await res.json()).data.providers).toEqual([
      { provider: 'anilist', status: 'unavailable' },
      { provider: 'mangadex', status: 'unavailable' },
      { provider: 'kitsu', status: 'unavailable' },
    ]);
  });
});

describe('POST /manhwas/import', () => {
  it('answers 401 without a session, even with a forged x-user-id', async () => {
    const res = await manhwas.import.$post(
      { json: { provider: 'anilist', externalId: TBATE_ID } },
      { headers: { 'x-user-id': reader.id } },
    );

    expect(res.status).toBe(401);
    expect(upstream.calls).toHaveLength(0);
  });

  it('imports the work with its titles, cover, external link and taxonomy', async () => {
    const res = await importTbate(reader);

    expect(res.status).toBe(201);
    const { data: manhwa } = await res.json();
    expect(manhwa).toMatchObject({
      title: 'The Beginning After the End',
      originalTitle: '끝이 아닌 시작',
      type: 'manhwa',
      status: 'completed',
      totalChapters: 201,
      rating: 8.4,
      startDate: '2018-07-17',
      createdBy: reader.id,
    });

    const link = firstOrThrow(await context.db.select().from(externalLinks).where(eq(externalLinks.manhwaId, manhwa.id)));
    expect(link).toMatchObject({ provider: 'anilist', externalId: TBATE_ID });

    const titles = await context.db.select().from(manhwaTitles).where(eq(manhwaTitles.manhwaId, manhwa.id));
    expect(titles.map((title) => title.title).sort()).toEqual(['Na Honjaman Level Up', 'TBATE', '끝이 아닌 시작']);

    const covers = await context.db.select().from(manhwaCovers).where(eq(manhwaCovers.manhwaId, manhwa.id));
    expect(covers).toMatchObject([{ source: 'anilist', isPrimary: true }]);

    // Genres → vocabulaire « genre » (le terme seedé « action » est réutilisé), tags → « theme ».
    // Le tag « Tragedy » (rang 30) est sous le seuil de pertinence : ignoré.
    expect(await termSlugsOf(manhwa.id)).toEqual([
      'genre:action',
      'genre:adventure',
      'genre:fantasy',
      'theme:magic',
      'theme:reincarnation',
    ]);
    const actionTerms = await context.db
      .select()
      .from(terms)
      .where(and(eq(terms.vocabularyId, catalog.taxonomy.genreVocabulary.id), eq(terms.slug, 'action')));
    expect(actionTerms).toHaveLength(1);
  });

  it('resolves genre names through existing term aliases instead of creating duplicates', async () => {
    const aventure = firstOrThrow(
      await context.db
        .insert(terms)
        .values({ vocabularyId: catalog.taxonomy.genreVocabulary.id, slug: 'aventure', name: 'Aventure' })
        .returning(),
    );
    await context.db.insert(termAliases).values({ termId: aventure.id, alias: 'adventure' });

    const { data: manhwa } = await (await importTbate(reader)).json();

    expect(await termSlugsOf(manhwa.id)).toContain('genre:aventure');
    expect(await termSlugsOf(manhwa.id)).not.toContain('genre:adventure');
  });

  it('is idempotent: a second import returns the same manhwa (200) without calling AniList again', async () => {
    const first = await (await importTbate(reader)).json();
    const secondRes = await importTbate(admin);

    expect(secondRes.status).toBe(200);
    expect((await secondRes.json()).data.id).toBe(first.data.id);
    expect(upstream.calls).toHaveLength(1);

    // Désormais trouvée localement : plus d'appel externe.
    const { data } = await (await search('Beginning After the End')).json();
    expect(data.local.map((hit) => hit.id)).toEqual([first.data.id]);
    expect(data.providers).toEqual([]);

    // Recherche externe forcée : les trois résultats pointent vers la fiche locale
    // (MangaDex et Kitsu via leur référence croisée vers AniList).
    const forced = await (await search('Beginning After the End', 'true')).json();
    expect(forced.data.external.map((hit) => hit.importedManhwaId)).toEqual([first.data.id, first.data.id, first.data.id]);
  });

  it('serializes concurrent imports of the same work', async () => {
    const responses = await Promise.all([importTbate(reader), importTbate(admin)]);

    expect(responses.map((res) => res.status).sort()).toEqual([200, 201]);
    expect(await context.db.select().from(externalLinks).where(eq(externalLinks.externalId, TBATE_ID))).toHaveLength(1);
  });

  it('answers 404 for a work unknown to AniList and 400 for an unsupported provider', async () => {
    const unknown = await manhwas.import.$post(
      { json: { provider: 'anilist', externalId: '1' } },
      { headers: reader.headers },
    );
    expect(unknown.status).toBe(404);

    const res = await context.app.request('/manhwas/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...reader.headers },
      body: JSON.stringify({ provider: 'mal', externalId: '1' }),
    });
    expect(res.status).toBe(400);
  });

  it('refuses to re-import a work an admin removed from the catalogue (409)', async () => {
    const { data: manhwa } = await (await importTbate(reader)).json();
    await context.client.manhwas[':id'].$delete({ param: { id: manhwa.id } }, { headers: admin.headers });

    expect((await importTbate(reader)).status).toBe(409);
  });

  it('keeps the manhwa and its other tags intact when an imported term is deleted (pivot cascade)', async () => {
    const { data: manhwa } = await (await importTbate(reader)).json();
    const magic = firstOrThrow(await context.db.select().from(terms).where(eq(terms.slug, 'magic')));

    const deleted = await taxonomy.terms[':id'].$delete({ param: { id: magic.id } }, { headers: admin.headers });
    expect(deleted.status).toBe(204);

    expect((await context.client.manhwas[':id'].$get({ param: { id: manhwa.id } })).status).toBe(200);
    expect(await termSlugsOf(manhwa.id)).toEqual([
      'genre:action',
      'genre:adventure',
      'genre:fantasy',
      'theme:reincarnation',
    ]);
  });
});

describe('POST /manhwas/import — MangaDex and cross-provider deduplication', () => {
  it('imports a MangaDex work with its AniList cross reference and queues its follow-up jobs (outbox)', async () => {
    const res = await importTbateFromMangaDex(reader);

    expect(res.status).toBe(201);
    const { data: manhwa } = await res.json();
    expect(manhwa).toMatchObject({ title: 'The Beginning After the End', type: 'manhwa', status: 'completed' });

    const links = await context.db.select().from(externalLinks).where(eq(externalLinks.manhwaId, manhwa.id));
    expect(links.map((link) => `${link.provider}:${link.externalId}`).sort()).toEqual([
      `anilist:${TBATE_ID}`,
      `mangadex:${TBATE_MANGADEX_ID}`,
    ]);

    // Écrites dans la même transaction que la fiche : aucune tâche ne peut manquer à l'appel.
    const queued = await context.db.select().from(jobs);
    expect(queued.map((job) => job.type).sort()).toEqual(['chapters.sync', 'cover.mirror']);
    expect(queued.every((job) => job.status === 'pending')).toBe(true);
  });

  it('completes the manhwa imported from AniList instead of creating a duplicate', async () => {
    const { data: fromAniList } = await (await importTbate(reader)).json();

    const res = await importTbateFromMangaDex(admin);

    expect(res.status).toBe(200);
    expect((await res.json()).data.id).toBe(fromAniList.id);
    const links = await context.db.select().from(externalLinks).where(eq(externalLinks.manhwaId, fromAniList.id));
    expect(links).toHaveLength(2);
    // Et dans l'autre sens : l'import AniList retrouve la fiche créée depuis MangaDex.
    expect((await importTbate(reader)).status).toBe(200);
  });

  it('serializes concurrent imports of the same work from two providers', async () => {
    const responses = await Promise.all([importTbate(reader), importTbateFromMangaDex(admin)]);

    expect(responses.map((res) => res.status).sort()).toEqual([200, 201]);
    const ids = await Promise.all(responses.map(async (res) => (await res.json()).data.id));
    expect(new Set(ids).size).toBe(1);
  });
});

describe('background jobs after an import (worker)', () => {
  it('syncs the MangaDex chapters and mirrors the cover, then serves it locally', async () => {
    const { data: manhwa } = await (await importTbateFromMangaDex(reader)).json();

    expect(await context.worker.runOnce()).toBe(2);

    const finished = await context.db.select().from(jobs);
    expect(finished.map((job) => job.status)).toEqual(['succeeded', 'succeeded']);

    // Chapitres canoniques 1 et 2, trois parutions (chapitre 1 en anglais et en français).
    const synced = await context.db.select().from(chapters).where(eq(chapters.manhwaId, manhwa.id));
    expect(synced.map((chapter) => chapter.number).sort()).toEqual([1, 2]);
    const releases = await context.db
      .select({ language: chapterReleases.language, source: sources.name })
      .from(chapterReleases)
      .innerJoin(chapters, eq(chapters.id, chapterReleases.chapterId))
      .innerJoin(sources, eq(sources.id, chapterReleases.sourceId))
      .where(eq(chapters.manhwaId, manhwa.id));
    expect(releases.map((release) => `${release.source}:${release.language}`).sort()).toEqual([
      'MangaDex:en',
      'MangaDex:en',
      'MangaDex:fr',
    ]);
    const [sourceLink] = await context.db.select().from(manhwaSources).where(eq(manhwaSources.manhwaId, manhwa.id));
    expect(sourceLink).toMatchObject({ latestChapter: 2, manhwaUrl: `https://mangadex.org/title/${TBATE_MANGADEX_ID}` });

    const cover = firstOrThrow(await context.db.select().from(manhwaCovers).where(eq(manhwaCovers.manhwaId, manhwa.id)));
    expect(cover.storageKey).toMatch(/^[a-f0-9]{64}\.png$/);
    const media = await context.client.images.media[':key'].$get({ param: { key: cover.storageKey ?? '' } });
    expect(media.status).toBe(200);
    expect(media.headers.get('cache-control')).toContain('immutable');
    expect(new Uint8Array(await media.arrayBuffer())).toEqual(PNG);

    // Tâches rejouées (livraison « au moins une fois ») : aucun doublon.
    await context.db.update(jobs).set({ status: 'pending', runAt: new Date(0) });
    expect(await context.worker.runOnce()).toBe(2);
    expect(await context.db.select().from(chapterReleases)).toHaveLength(3);
  });

  it('keeps a failing job in the queue with its error, to be retried later', async () => {
    mangadexFeedDown = true;
    await importTbateFromMangaDex(reader);

    await context.worker.runOnce();

    const [sync] = await context.db.select().from(jobs).where(eq(jobs.type, 'chapters.sync'));
    expect(sync).toMatchObject({ status: 'pending', attempts: 1, lastError: expect.stringContaining('HTTP 503') });
    expect(sync?.runAt.getTime()).toBeGreaterThan(Date.now());
  });
});

describe('POST /manhwas/import — Kitsu (third provider, zero change in the service)', () => {
  const importTbateFromKitsu = (user: TestUser) =>
    manhwas.import.$post({ json: { provider: 'kitsu', externalId: TBATE_KITSU_ID } }, { headers: user.headers });

  it('imports a Kitsu work, mirrors its cover and ends its chapter sync cleanly without any chapter feed', async () => {
    const res = await importTbateFromKitsu(reader);

    expect(res.status).toBe(201);
    const { data: manhwa } = await res.json();
    expect(manhwa).toMatchObject({ title: 'The Beginning After the End', type: 'manhwa', rating: 8.4, startDate: '2018-07-17' });
    expect(await termSlugsOf(manhwa.id)).toEqual(['genre:action', 'genre:fantasy', 'theme:magic', 'theme:reincarnation']);
    // La synchronisation est demandée sans savoir qui fournit des chapitres…
    expect((await context.db.select().from(jobs)).map((job) => job.type).sort()).toEqual(['chapters.sync', 'cover.mirror']);

    expect(await context.worker.runOnce()).toBe(2);
    // … et se termine sans erreur : ni Kitsu ni AniList (lien croisé) ne listent de chapitres.
    expect((await context.db.select().from(jobs)).map((job) => job.status)).toEqual(['succeeded', 'succeeded']);
    expect(await context.db.select().from(chapters).where(eq(chapters.manhwaId, manhwa.id))).toEqual([]);
    const cover = firstOrThrow(await context.db.select().from(manhwaCovers).where(eq(manhwaCovers.manhwaId, manhwa.id)));
    expect(cover).toMatchObject({ source: 'kitsu', storageKey: expect.stringMatching(/\.png$/) });
  });

  it('attaches to the work already imported from AniList or MangaDex instead of duplicating it', async () => {
    const { data: fromMangaDex } = await (await importTbateFromMangaDex(reader)).json();

    const res = await importTbateFromKitsu(admin);

    expect(res.status).toBe(200);
    expect((await res.json()).data.id).toBe(fromMangaDex.id);
    const links = await context.db.select().from(externalLinks).where(eq(externalLinks.manhwaId, fromMangaDex.id));
    expect(links.map((link) => link.provider).sort()).toEqual(['anilist', 'kitsu', 'mangadex']);
  });
});

describe('chapter sync is provider-agnostic (driven by the work links)', () => {
  it('fetches MangaDex chapters for a work imported from AniList as soon as it gets a MangaDex link', async () => {
    const { data: fromAniList } = await (await importTbate(reader)).json();
    await context.worker.runOnce();
    // Importée depuis AniList : aucun flux de chapitres lié, la synchronisation n'a rien trouvé.
    expect(await context.db.select().from(chapters).where(eq(chapters.manhwaId, fromAniList.id))).toEqual([]);

    // Le même titre importé depuis MangaDex se rattache à la fiche AniList (référence croisée)…
    expect((await importTbateFromMangaDex(admin)).status).toBe(200);
    await context.worker.runOnce();

    // … et la synchronisation suivante trouve le lien MangaDex : chapitres de la fiche AniList.
    const synced = await context.db.select().from(chapters).where(eq(chapters.manhwaId, fromAniList.id));
    expect(synced.map((chapter) => chapter.number).sort()).toEqual([1, 2]);
    expect(upstream.calls.some((call) => call.url.pathname === `/manga/${TBATE_MANGADEX_ID}/feed`)).toBe(true);
  });
});

describe('authors — import, display and pivot integrity', () => {
  const TBATE_AUTHORS = [
    { name: 'TurtleMe', nativeName: '터틀미', role: 'story' },
    { name: 'Fuyuki23', nativeName: null, role: 'art' },
  ];

  it('imports the authors with their role and order, visible in every read of the manhwa', async () => {
    const { data: imported } = await (await importTbate(reader)).json();
    expect(imported.authors).toEqual(TBATE_AUTHORS);

    const detail = await (await manhwas[':id'].$get({ param: { id: imported.id } })).json();
    expect(detail.data.authors).toEqual(TBATE_AUTHORS);

    const list = await (await manhwas.$get()).json();
    expect(list.data.find((manhwa) => manhwa.id === imported.id)?.authors).toEqual(TBATE_AUTHORS);
    // Les autres fiches (sans auteurs connus) ont une liste vide, jamais `undefined`.
    expect(list.data.find((manhwa) => manhwa.id === catalog.manhwa.id)?.authors).toEqual([]);

    const found = await (await search('Beginning After the End')).json();
    expect(found.data.local[0]?.authors).toEqual(TBATE_AUTHORS);

    await context.client.reading.progress[':manhwaId'].$put(
      { param: { manhwaId: imported.id }, json: {} },
      { headers: reader.headers },
    );
    const library = await (await context.client.reading.progress.$get({}, { headers: reader.headers })).json();
    expect(library.data[0]?.manhwa.authors).toEqual(TBATE_AUTHORS);
  });

  it('keeps the first catalogue authors when the same work is imported again from another one', async () => {
    const { data: fromAniList } = await (await importTbate(reader)).json();
    await importTbateFromMangaDex(admin); // autres graphies (« Turtle-Me (터틀미) ») + « Studio Waveon »

    const detail = await (await manhwas[':id'].$get({ param: { id: fromAniList.id } })).json();
    expect(detail.data.authors).toEqual(TBATE_AUTHORS);
    const names = (await context.db.select({ name: authors.name }).from(authors)).map((row) => row.name).sort();
    expect(names).toEqual(['Fuyuki23', 'TurtleMe']);
  });

  it('gives authors to a work imported first from a catalogue without staff (Kitsu)', async () => {
    const { data: fromKitsu } = await (
      await manhwas.import.$post({ json: { provider: 'kitsu', externalId: TBATE_KITSU_ID } }, { headers: reader.headers })
    ).json();
    expect(fromKitsu.authors).toEqual([]);

    // MangaDex reconnaît la même œuvre (référence AniList commune) : ses auteurs complètent la fiche.
    // (Un import AniList ne passerait pas par là : Kitsu a déjà lié l'id AniList, l'interface propose « Voir la fiche ».)
    const res = await importTbateFromMangaDex(admin);
    expect(res.status).toBe(200);
    const detail = await (await manhwas[':id'].$get({ param: { id: fromKitsu.id } })).json();
    expect(detail.data.authors).toEqual([
      { name: 'Turtle-Me', nativeName: '터틀미', role: 'story' },
      { name: 'Fuyuki23', nativeName: null, role: 'art' },
      { name: 'Studio Waveon', nativeName: null, role: 'both' },
    ]);
  });

  it('keeps authors and manhwas consistent when either side is deleted (pivot cascade)', async () => {
    const { data: manhwa } = await (await importTbate(reader)).json();

    // Suppression d'un auteur : seul son lien disparaît, la fiche reste lisible.
    await context.db.delete(authors).where(eq(authors.name, 'Fuyuki23'));
    const detail = await manhwas[':id'].$get({ param: { id: manhwa.id } });
    expect(detail.status).toBe(200);
    expect((await detail.json()).data.authors).toEqual([{ name: 'TurtleMe', nativeName: '터틀미', role: 'story' }]);

    // Soft delete de la fiche (admin) : les liens sont conservés (restauration possible).
    await manhwas[':id'].$delete({ param: { id: manhwa.id } }, { headers: admin.headers });
    expect(await context.db.select().from(manhwaAuthors).where(eq(manhwaAuthors.manhwaId, manhwa.id))).toHaveLength(1);

    // Hard delete de la fiche : les liens partent en cascade, l'auteur (partageable) reste.
    await context.db.delete(manhwasTable).where(eq(manhwasTable.id, manhwa.id));
    expect(await context.db.select().from(manhwaAuthors)).toEqual([]);
    expect((await context.db.select({ name: authors.name }).from(authors)).map((row) => row.name)).toEqual(['TurtleMe']);
  });
});

describe('local covers — served by the API once mirrored', () => {
  it('exposes the local copy after the cover.mirror job, and it is actually served (no 404)', async () => {
    const { data: imported } = await (await importTbate(reader)).json();
    // Tant que la tâche n'a pas tourné : pas de copie locale, le front passe par le proxy.
    expect(imported.localCoverUrl).toBeNull();

    await context.worker.runOnce();

    const { data: detail } = await (await manhwas[':id'].$get({ param: { id: imported.id } })).json();
    expect(detail.localCoverUrl).toMatch(/^\/images\/media\/[a-f0-9]{64}\.png$/);
    const list = await (await manhwas.$get()).json();
    expect(list.data.find((manhwa) => manhwa.id === imported.id)?.localCoverUrl).toBe(detail.localCoverUrl);

    const image = await context.app.request(detail.localCoverUrl ?? '');
    expect(image.status).toBe(200);
    expect(image.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(PNG);
  });

  it('never serves a stale copy once the displayed cover changes', async () => {
    const { data: imported } = await (await importTbate(reader)).json();
    await context.worker.runOnce();

    await manhwas[':id'].$patch(
      { param: { id: imported.id }, json: { coverUrl: 'https://s4.anilist.co/file/new-cover.png' } },
      { headers: admin.headers },
    );

    const { data: detail } = await (await manhwas[':id'].$get({ param: { id: imported.id } })).json();
    expect(detail.localCoverUrl).toBeNull();
    expect(detail.coverUrl).toBe('https://s4.anilist.co/file/new-cover.png');
  });
});
