import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  externalLinks,
  manhwaCovers,
  manhwaTerms,
  manhwaTitles,
  termAliases,
  terms,
  vocabularies,
} from '../../shared/db/schema.js';
import { firstOrThrow } from '../../shared/db/utils.js';
import { seedCatalog, type SeededCatalog } from '../../shared/db/seed.test.js';
import { createFakeFetch } from '../../test/fake-fetch.js';
import { createTestContext, signUp, signUpAdmin, type TestUser } from '../../test/integration.js';
import { aniListDetailsResponse, aniListMedia, aniListSearchResponse, readGraphQLRequest } from './anilist.fixture.test.js';

const TBATE_ID = '105398';

// Faux AniList : connaît une seule œuvre, « The Beginning After the End ».
const anilist = createFakeFetch(({ url, init }) => {
  if (url.hostname !== 'graphql.anilist.test') return new Response(null, { status: 404 });
  const { query, variables } = readGraphQLRequest(init);
  if (query.includes('Page(')) {
    const search = String(variables['search']).toLowerCase();
    return aniListSearchResponse(search.includes('beginning') ? [aniListMedia()] : []);
  }
  return aniListDetailsResponse(String(variables['id']) === TBATE_ID ? aniListMedia() : null);
});

const context = createTestContext({ fetch: anilist.fetch });
const { manhwas, taxonomy } = context.client;

let catalog: SeededCatalog;
let reader: TestUser;
let admin: TestUser;

beforeEach(async () => {
  catalog = await seedCatalog(context.db);
  reader = await signUp(context, 'reader');
  admin = await signUpAdmin(context, 'admin');
  anilist.calls.length = 0;
});

afterAll(() => context.close());

const search = (q: string, external?: 'true') => manhwas.search.$get({ query: { q, ...(external ? { external } : {}) } });

const importTbate = (user: TestUser) =>
  manhwas.import.$post({ json: { provider: 'anilist', externalId: TBATE_ID } }, { headers: user.headers });

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
    expect(anilist.calls).toHaveLength(0);
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
    expect(anilist.calls).toHaveLength(0);
  });
});

describe('GET /manhwas/search — external fallback (AniList)', () => {
  it('proposes AniList results when nothing matches locally', async () => {
    const { data } = await (await search('Beginning After')).json();

    expect(data.local).toEqual([]);
    expect(data.providers).toEqual([{ provider: 'anilist', status: 'ok' }]);
    expect(data.external).toMatchObject([
      { provider: 'anilist', externalId: TBATE_ID, title: 'The Beginning After the End', importedManhwaId: null },
    ]);
  });

  it('reports the provider as unavailable instead of failing', async () => {
    const offline = createTestContext();
    const res = await offline.client.manhwas.search.$get({ query: { q: 'nothing like this' } });
    await offline.close();

    expect(res.status).toBe(200);
    expect((await res.json()).data.providers).toEqual([{ provider: 'anilist', status: 'unavailable' }]);
  });
});

describe('POST /manhwas/import', () => {
  it('answers 401 without a session, even with a forged x-user-id', async () => {
    const res = await manhwas.import.$post(
      { json: { provider: 'anilist', externalId: TBATE_ID } },
      { headers: { 'x-user-id': reader.id } },
    );

    expect(res.status).toBe(401);
    expect(anilist.calls).toHaveLength(0);
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
    expect(anilist.calls).toHaveLength(1);

    // Désormais trouvée localement : plus d'appel externe.
    const { data } = await (await search('Beginning After the End')).json();
    expect(data.local.map((hit) => hit.id)).toEqual([first.data.id]);
    expect(data.providers).toEqual([]);

    // Recherche externe forcée : le résultat AniList pointe vers la fiche locale.
    const forced = await (await search('Beginning After the End', 'true')).json();
    expect(forced.data.external[0]?.importedManhwaId).toBe(first.data.id);
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
