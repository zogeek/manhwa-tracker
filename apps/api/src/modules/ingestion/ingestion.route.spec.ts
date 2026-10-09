import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  chapterReleaseGroups,
  chapterReleases,
  chapters,
  ingestionBatches,
  manhwaSources,
  manhwas,
  readingListItems,
  readingLists,
  scanlationGroups,
  sourceHealth,
} from '../../shared/db/schema.js';
import { seedCatalog, type SeededCatalog } from '../../shared/db/seed.test.js';
import { firstOrThrow } from '../../shared/db/utils.js';
import { createTestContext, signUp, TEST_SCRAPER_API_KEY } from '../../test/integration.js';
import { trackedSeriesPageSchema } from './ingestion.validator.js';

const context = createTestContext();
let catalog: SeededCatalog;

beforeEach(async () => {
  catalog = await seedCatalog(context.db);
});

afterAll(() => context.close());

type Options = { key?: string | null; idempotencyKey?: string; method?: string };

/** Appel machine : clé d'API valide par défaut, `key: null` pour l'omettre. */
function ingest(path: string, body: unknown, { key = TEST_SCRAPER_API_KEY, idempotencyKey, method = 'POST' }: Options = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (key !== null) headers['x-api-key'] = key;
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  return context.app.request(`/api/ingest${path}`, { method, headers, body: JSON.stringify(body) });
}

const batchResultSchema = z.object({
  data: z.object({
    manhwas: z.array(z.object({ manhwaId: z.uuid(), created: z.boolean() })),
    chaptersCreated: z.number(),
    releasesCreated: z.number(),
    releasesUpdated: z.number(),
    coversAdded: z.number(),
  }),
});

const SERIES_URL = 'https://asura.example/series/solo-leveling';

function soloLevelingBatch(sourceId: string, chapterNumbers: number[], extra: Record<string, unknown> = {}) {
  return {
    sourceId,
    manhwas: [
      {
        sourceManhwaUrl: SERIES_URL,
        manhwaId: catalog.manhwa.id,
        title: 'Solo Leveling',
        synopsis: 'Synopsis scrapé',
        coverUrl: 'https://cdn.example/solo-leveling.webp',
        totalChapters: 200,
        chapters: chapterNumbers.map((number) => ({
          number,
          url: `${SERIES_URL}/chapter-${number}`,
          language: 'fr',
          scanlationGroup: 'Asura Team',
          publishedAt: '2026-09-01T12:00:00+02:00',
        })),
        ...extra,
      },
    ],
  };
}

describe('M2M authentication (x-api-key)', () => {
  it.each([
    ['no key', null],
    ['a wrong key', 'definitely-not-the-scraper-key-0123456789'],
  ])('rejects a batch sent with %s (401) and writes nothing', async (_label, key) => {
    const res = await ingest('/batches', soloLevelingBatch(catalog.source.id, [1]), {
      key,
      idempotencyKey: randomUUID(),
    });

    expect(res.status).toBe(401);
    expect(await context.db.select().from(ingestionBatches)).toEqual([]);
  });

  it('does not accept a Better Auth session instead of the key', async () => {
    const res = await context.app.request('/api/ingest/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: 'better-auth.session_token=forged' },
      body: JSON.stringify({ sourceId: catalog.source.id }),
    });

    expect(res.status).toBe(401);
  });
});

describe('POST /api/ingest/batches', () => {
  it('requires an Idempotency-Key header', async () => {
    const res = await ingest('/batches', soloLevelingBatch(catalog.source.id, [1]));

    expect(res.status).toBe(400);
  });

  it('upserts canonical chapters, releases, scanlation group, cover and source link', async () => {
    const res = await ingest('/batches', soloLevelingBatch(catalog.source.id, [3, 4, 4.5]), {
      idempotencyKey: randomUUID(),
    });

    expect(res.status).toBe(201);
    const { data } = batchResultSchema.parse(await res.json());
    // Chapitre 3 existe déjà dans le seed : seuls 4 et 4.5 sont créés.
    expect(data).toMatchObject({ chaptersCreated: 2, releasesCreated: 3, releasesUpdated: 0, coversAdded: 1 });

    const [link] = await context.db.select().from(manhwaSources).where(eq(manhwaSources.manhwaId, catalog.manhwa.id));
    expect(link).toMatchObject({ manhwaUrl: SERIES_URL, latestChapter: 4.5 });
    const [asura] = await context.db.select().from(scanlationGroups);
    expect(asura).toMatchObject({ slug: 'asura-team', name: 'Asura Team', provider: null, externalId: null });
    // Chaque parution est créditée à la team (table de liaison).
    const credits = await context.db.select().from(chapterReleaseGroups);
    expect(credits).toHaveLength(3);
    expect(credits.every((credit) => credit.groupId === asura?.id)).toBe(true);
  });

  it('credits collaborations and never duplicates a team across batches', async () => {
    const collab = soloLevelingBatch(catalog.source.id, [6]);
    const [manhwa] = collab.manhwas;
    const [chapter] = manhwa?.chapters ?? [];
    if (!chapter) throw new Error('chapter expected');
    Object.assign(chapter, { scanlationGroup: undefined, scanlationGroups: ['Asura Team', 'Flame Comics'] });

    expect((await ingest('/batches', soloLevelingBatch(catalog.source.id, [5]), { idempotencyKey: randomUUID() })).status).toBe(201);
    expect((await ingest('/batches', collab, { idempotencyKey: randomUUID() })).status).toBe(201);

    const names = (await context.db.select({ name: scanlationGroups.name }).from(scanlationGroups)).map((row) => row.name);
    expect(names.sort()).toEqual(['Asura Team', 'Flame Comics']);
    const [release] = await context.db
      .select({ id: chapterReleases.id })
      .from(chapterReleases)
      .where(eq(chapterReleases.url, `${SERIES_URL}/chapter-6`));
    const credits = await context.db
      .select({ name: scanlationGroups.name, position: chapterReleaseGroups.position })
      .from(chapterReleaseGroups)
      .innerJoin(scanlationGroups, eq(scanlationGroups.id, chapterReleaseGroups.groupId))
      .where(eq(chapterReleaseGroups.releaseId, release?.id ?? ''))
      .orderBy(chapterReleaseGroups.position);
    expect(credits).toEqual([
      { name: 'Asura Team', position: 0 },
      { name: 'Flame Comics', position: 1 },
    ]);
  });

  it('is idempotent: replaying the same key returns the same result and writes nothing new', async () => {
    const idempotencyKey = randomUUID();
    const body = soloLevelingBatch(catalog.source.id, [4, 5]);

    const first = await ingest('/batches', body, { idempotencyKey });
    const replay = await ingest('/batches', body, { idempotencyKey });

    expect(first.status).toBe(201);
    expect(replay.status).toBe(200);
    expect(replay.headers.get('Idempotent-Replayed')).toBe('true');
    expect(await replay.json()).toEqual(await first.json());
    expect(await context.db.select().from(chapterReleases)).toHaveLength(2);
  });

  it('rejects the same key with a different payload (409)', async () => {
    const idempotencyKey = randomUUID();

    await ingest('/batches', soloLevelingBatch(catalog.source.id, [4]), { idempotencyKey });
    const res = await ingest('/batches', soloLevelingBatch(catalog.source.id, [4, 5]), { idempotencyKey });

    expect(res.status).toBe(409);
  });

  it('keeps one canonical chapter with one release per source', async () => {
    await ingest('/batches', soloLevelingBatch(catalog.source.id, [5]), { idempotencyKey: randomUUID() });
    await ingest(
      '/batches',
      soloLevelingBatch(catalog.otherSource.id, [5], {
        sourceManhwaUrl: 'https://phenix.example/manga/solo-leveling',
        chapters: [{ number: 5, url: 'https://phenix.example/manga/solo-leveling/5', language: 'fr' }],
      }),
      { idempotencyKey: randomUUID() },
    );

    const chapterFive = await context.db
      .select()
      .from(chapters)
      .where(and(eq(chapters.manhwaId, catalog.manhwa.id), eq(chapters.number, 5)));
    expect(chapterFive).toHaveLength(1);
    const releases = await context.db
      .select()
      .from(chapterReleases)
      .where(eq(chapterReleases.chapterId, chapterFive[0]?.id ?? ''));
    expect(releases.map((release) => release.sourceId).sort()).toEqual(
      [catalog.source.id, catalog.otherSource.id].sort(),
    );
  });

  it('fills empty catalogue fields but never overwrites curated ones', async () => {
    await context.db.update(manhwas).set({ synopsis: 'Synopsis écrit par un admin' }).where(eq(manhwas.id, catalog.manhwa.id));

    await ingest('/batches', soloLevelingBatch(catalog.source.id, [1]), { idempotencyKey: randomUUID() });

    const [manhwa] = await context.db.select().from(manhwas).where(eq(manhwas.id, catalog.manhwa.id));
    expect(manhwa).toMatchObject({
      synopsis: 'Synopsis écrit par un admin',
      coverUrl: 'https://cdn.example/solo-leveling.webp',
      totalChapters: 200,
      updatedBy: 'system:scraper',
    });
  });

  it('creates an unknown series and maps it for the next batches', async () => {
    const newSeries = {
      sourceId: catalog.source.id,
      manhwas: [{ sourceManhwaUrl: 'https://asura.example/series/eleceed', title: 'Eleceed', chapters: [] }],
    };

    const first = batchResultSchema.parse(await (await ingest('/batches', newSeries, { idempotencyKey: randomUUID() })).json());
    const second = batchResultSchema.parse(await (await ingest('/batches', newSeries, { idempotencyKey: randomUUID() })).json());

    expect(first.data.manhwas[0]?.created).toBe(true);
    expect(second.data.manhwas[0]).toEqual({ ...first.data.manhwas[0], created: false });
  });

  it('rolls the whole batch back on error and leaves the key reusable', async () => {
    const idempotencyKey = randomUUID();
    const failing = { ...soloLevelingBatch(catalog.source.id, [6]), scrapeRunId: randomUUID() };

    const res = await ingest('/batches', failing, { idempotencyKey });

    expect(res.status).toBe(422); // scrape run inconnu (FK) → rien n'est écrit
    expect(await context.db.select().from(chapterReleases)).toEqual([]);
    expect(await context.db.select().from(ingestionBatches)).toEqual([]);

    const retry = await ingest('/batches', soloLevelingBatch(catalog.source.id, [6]), { idempotencyKey });
    expect(retry.status).toBe(201);
  });
});

describe('scrape runs and source health', () => {
  const runSchema = z.object({ data: z.object({ id: z.uuid(), status: z.string() }) });

  it('starts and finishes a run, and refuses to finish it twice', async () => {
    const started = runSchema.parse(await (await ingest('/runs', { sourceId: catalog.source.id, workerVersion: '0.1.0' })).json());
    expect(started.data.status).toBe('running');

    const finish = (status: string) =>
      ingest(`/runs/${started.data.id}`, { status, stats: { manhwasSeen: 12 } }, { method: 'PATCH' });

    expect((await finish('succeeded')).status).toBe(200);
    expect((await finish('failed')).status).toBe(409);
  });

  it('records health samples', async () => {
    const res = await ingest('/health', {
      samples: [
        { sourceId: catalog.source.id, status: 'up', httpStatus: 200, latencyMs: 350 },
        { sourceId: catalog.otherSource.id, status: 'blocked', httpStatus: 403, blockedBy: 'cloudflare' },
      ],
    });

    expect(res.status).toBe(201);
    expect(await context.db.select().from(sourceHealth)).toHaveLength(2);
  });
});

describe('GET /api/ingest/tracked', () => {
  /** Appel machine en lecture : clé valide par défaut, `key: null` pour l'omettre. */
  function tracked(query: Record<string, string>, { key = TEST_SCRAPER_API_KEY }: { key?: string | null } = {}) {
    const headers: Record<string, string> = {};
    if (key !== null) headers['x-api-key'] = key;
    return context.app.request(`/api/ingest/tracked?${new URLSearchParams(query)}`, { headers });
  }

  async function createManhwa(title: string, deletedAt: Date | null = null) {
    return firstOrThrow(await context.db.insert(manhwas).values({ title, deletedAt }).returning()).id;
  }

  async function createList(userId: string, manhwaIds: string[], deletedAt: Date | null = null) {
    const list = firstOrThrow(
      await context.db.insert(readingLists).values({ userId, name: 'À lire', deletedAt }).returning(),
    );
    await context.db.insert(readingListItems).values(manhwaIds.map((manhwaId) => ({ listId: list.id, manhwaId })));
  }

  /**
   * Catalogue de la source Asura :
   * - Solo Leveling : URL connue, dans les listes d'Alice ET de Bob → renvoyée une seule fois ;
   * - « Sans URL » : suivie, lien créé sans URL → renvoyée avec `manhwaUrl: null` ;
   * - « Personne » : liée à la source mais dans aucune liste → écartée ;
   * - « Liste supprimée » : seulement dans une liste soft-deleted → écartée ;
   * - « Fiche supprimée » : suivie mais fiche soft-deleted → écartée ;
   * - « Autre source » : suivie, mais liée uniquement à Phenix → écartée.
   */
  async function seedTracking() {
    const alice = await signUp(context, 'alice');
    const bob = await signUp(context, 'bob');
    const noUrl = await createManhwa('Sans URL');
    const untracked = await createManhwa('Personne');
    const deletedListOnly = await createManhwa('Liste supprimée');
    const deletedManhwa = await createManhwa('Fiche supprimée', new Date());
    const otherSourceOnly = await createManhwa('Autre source');

    const sourceId = catalog.source.id;
    await context.db.insert(manhwaSources).values([
      { manhwaId: catalog.manhwa.id, sourceId, manhwaUrl: SERIES_URL, latestChapter: 3 },
      { manhwaId: noUrl, sourceId, manhwaUrl: null },
      { manhwaId: untracked, sourceId, manhwaUrl: 'https://asura.example/series/personne' },
      { manhwaId: deletedListOnly, sourceId, manhwaUrl: 'https://asura.example/series/liste-supprimee' },
      { manhwaId: deletedManhwa, sourceId, manhwaUrl: 'https://asura.example/series/fiche-supprimee' },
      { manhwaId: otherSourceOnly, sourceId: catalog.otherSource.id, manhwaUrl: 'https://phenix.example/autre' },
    ]);

    await createList(alice.id, [catalog.manhwa.id, noUrl, deletedManhwa, otherSourceOnly]);
    await createList(bob.id, [catalog.manhwa.id]);
    await createList(bob.id, [deletedListOnly], new Date());

    return { noUrl };
  }

  it.each([
    ['no key', null],
    ['a wrong key', 'definitely-not-the-scraper-key-0123456789'],
  ])('rejects a request sent with %s (401)', async (_label, key) => {
    const res = await tracked({ sourceId: catalog.source.id }, { key });

    expect(res.status).toBe(401);
  });

  it('does not accept a Better Auth session instead of the key', async () => {
    const alice = await signUp(context, 'alice');
    const res = await context.app.request(`/api/ingest/tracked?sourceId=${catalog.source.id}`, {
      headers: alice.headers,
    });

    expect(res.status).toBe(401);
  });

  it('returns only the series of this source that sit in an active reading list, once each', async () => {
    const { noUrl } = await seedTracking();

    const res = await tracked({ sourceId: catalog.source.id });

    expect(res.status).toBe(200);
    // La réponse respecte le contrat consommé par le worker Python.
    const page = trackedSeriesPageSchema.parse(await res.json());
    expect(page.nextCursor).toBeNull();
    expect(page.data).toHaveLength(2);
    expect(page.data).toEqual(
      expect.arrayContaining([
        {
          manhwaId: catalog.manhwa.id,
          title: 'Solo Leveling',
          manhwaUrl: SERIES_URL,
          latestChapter: 3,
          lastScrapedAt: null,
        },
        { manhwaId: noUrl, title: 'Sans URL', manhwaUrl: null, latestChapter: null, lastScrapedAt: null },
      ]),
    );
  });

  it('returns an empty page once nobody follows the series of the source anymore', async () => {
    await seedTracking();
    await context.db.delete(readingListItems);

    const res = await tracked({ sourceId: catalog.source.id });

    expect(trackedSeriesPageSchema.parse(await res.json())).toEqual({ data: [], nextCursor: null });
  });

  it('pages through the tracked series with a cursor', async () => {
    await seedTracking();

    const first = trackedSeriesPageSchema.parse(await (await tracked({ sourceId: catalog.source.id, limit: '1' })).json());
    expect(first.data).toHaveLength(1);
    expect(first.nextCursor).toBe(first.data[0]?.manhwaId);

    const cursor = first.nextCursor ?? '';
    const second = trackedSeriesPageSchema.parse(
      await (await tracked({ sourceId: catalog.source.id, limit: '1', cursor })).json(),
    );
    expect(second.data).toHaveLength(1);
    expect(second.data[0]?.manhwaId).not.toBe(first.data[0]?.manhwaId);
    expect(second.nextCursor).toBeNull();
  });

  it('answers 404 for an unknown source', async () => {
    const unknown = await tracked({ sourceId: randomUUID() });

    expect(unknown.status).toBe(404);
  });

  it.each([
    ['a missing sourceId', {}],
    ['a malformed sourceId', { sourceId: 'not-a-uuid' }],
    ['a limit above the maximum', { sourceId: '00000000-0000-4000-8000-000000000000', limit: '501' }],
  ])('rejects %s (400)', async (_label, query) => {
    const res = await tracked(query);

    expect(res.status).toBe(400);
  });
});
