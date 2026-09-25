import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  chapterReleases,
  chapters,
  ingestionBatches,
  manhwaSources,
  manhwas,
  scanlationGroups,
  sourceHealth,
} from '../../shared/db/schema.js';
import { seedCatalog, type SeededCatalog } from '../../shared/db/seed.test.js';
import { createTestContext, TEST_SCRAPER_API_KEY } from '../../test/integration.js';

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
    expect(await context.db.select().from(scanlationGroups)).toEqual([
      expect.objectContaining({ slug: 'asura-team', name: 'Asura Team' }),
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
