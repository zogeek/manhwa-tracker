import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { chapterReads, manhwaSources, sourceHealth, sources } from '../../shared/db/schema.js';
import { seedCatalog, type SeededCatalog } from '../../shared/db/seed.test.js';
import { createTestContext, signUp, type TestUser } from '../../test/integration.js';

const context = createTestContext();
const reading = context.client.reading;

let catalog: SeededCatalog;
let reader: TestUser;

beforeEach(async () => {
  catalog = await seedCatalog(context.db);
  reader = await signUp(context, 'reader');
});

afterAll(() => context.close());

const logRead = (chapterId: string, user: TestUser) =>
  reading.reads.$post({ json: { chapterId } }, { headers: user.headers });

describe('reading progress — authentication', () => {
  it('answers 401 without a session', async () => {
    const manhwaId = catalog.manhwa.id;
    const responses = await Promise.all([
      reading.progress.$get(),
      reading.progress[':manhwaId'].$get({ param: { manhwaId } }),
      reading.progress[':manhwaId'].$put({ param: { manhwaId }, json: { currentChapter: 1 } }),
      reading.reads.$post({ json: { chapterId: catalog.chapterByNumber(1).id } }),
      reading.reads.$get(),
      reading.dashboard.$get(),
    ]);

    expect(responses.map((res) => res.status)).toEqual(Array(responses.length).fill(401));
  });
});

describe('POST /reading/reads — atomic read + progress', () => {
  it('logs the read and updates the progress in the same transaction', async () => {
    const res = await logRead(catalog.chapterByNumber(2.5).id, reader);

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.read.userId).toBe(reader.id);
    expect(body.data.progress).toMatchObject({
      manhwaId: catalog.manhwa.id,
      status: 'reading',
      currentChapter: 2.5,
      furthestChapter: 2.5,
    });
  });

  it('never moves furthestChapter backwards when re-reading an older chapter', async () => {
    await logRead(catalog.chapterByNumber(3).id, reader);
    const res = await logRead(catalog.chapterByNumber(1).id, reader);

    const body = await res.json();
    expect(body.data.progress).toMatchObject({ currentChapter: 1, furthestChapter: 3 });
  });

  it('rolls everything back when the chapter does not exist', async () => {
    const res = await logRead(randomUUID(), reader);

    expect(res.status).toBe(404);
    const reads = await context.db.select().from(chapterReads).where(eq(chapterReads.userId, reader.id));
    expect(reads).toEqual([]);
    const progress = await reading.progress.$get({}, { headers: reader.headers });
    expect((await progress.json()).data).toEqual([]);
  });

  it('keeps each user progress isolated', async () => {
    const other = await signUp(context, 'other');
    await logRead(catalog.chapterByNumber(3).id, other);

    const res = await reading.progress.$get({}, { headers: reader.headers });

    expect((await res.json()).data).toEqual([]);
  });
});

describe('library (GET / DELETE /reading/progress)', () => {
  it('embeds the tracked manhwa in each entry', async () => {
    await logRead(catalog.chapterByNumber(1).id, reader);

    const res = await reading.progress.$get({}, { headers: reader.headers });
    const body = await res.json();

    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.manhwa).toMatchObject({ id: catalog.manhwa.id, title: 'Solo Leveling' });
  });

  it('removes a series from the library but keeps the read history', async () => {
    await logRead(catalog.chapterByNumber(1).id, reader);
    const remove = () =>
      reading.progress[':manhwaId'].$delete({ param: { manhwaId: catalog.manhwa.id } }, { headers: reader.headers });

    expect((await remove()).status).toBe(204);
    expect((await remove()).status).toBe(404);
    const history = await reading.reads.$get({}, { headers: reader.headers });
    expect((await history.json()).data).toHaveLength(1);
  });
});

describe('PUT /reading/progress/:manhwaId — partial atomic upsert', () => {
  it('only updates provided fields and keeps furthestChapter monotonic', async () => {
    const put = (json: { currentChapter?: number; rating?: number; status?: 'completed' }) =>
      reading.progress[':manhwaId'].$put(
        { param: { manhwaId: catalog.manhwa.id }, json },
        { headers: reader.headers },
      );

    await put({ currentChapter: 3, rating: 9 });
    const res = await put({ currentChapter: 1, status: 'completed' });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toMatchObject({ currentChapter: 1, furthestChapter: 3, rating: 9, status: 'completed' });
  });
});

describe('PUT /reading/progress/:manhwaId — absolute progress (quick edit, "read up to here")', () => {
  const put = (json: { currentChapter?: number; status?: 'reading' | 'on_hold' | 'plan_to_read' }) =>
    reading.progress[':manhwaId'].$put({ param: { manhwaId: catalog.manhwa.id }, json }, { headers: reader.headers });

  it('jumps straight to any chapter and starts reading a "plan to read" series', async () => {
    await put({}); // ajout à la bibliothèque : « à lire », chapitre 0
    const res = await put({ currentChapter: 120 });

    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data).toMatchObject({ currentChapter: 120, furthestChapter: 120, status: 'reading' });
    expect(data.startedAt).not.toBeNull();
  });

  it('creates the entry as "reading" when the first update already sets a chapter', async () => {
    const { data } = await (await put({ currentChapter: 42.5 })).json();

    expect(data).toMatchObject({ currentChapter: 42.5, status: 'reading' });
    expect(data.startedAt).not.toBeNull();
  });

  it('lets the user correct a typo backwards, keeping the high-water mark and the start date', async () => {
    const first = (await (await put({ currentChapter: 1200 })).json()).data;
    const { data } = await (await put({ currentChapter: 120 })).json();

    expect(data).toMatchObject({ currentChapter: 120, furthestChapter: 1200, status: 'reading' });
    expect(data.startedAt).toBe(first.startedAt);
  });

  it('keeps an explicit status and does not override a paused series', async () => {
    expect((await (await put({ currentChapter: 10, status: 'plan_to_read' })).json()).data.status).toBe('plan_to_read');

    await put({ status: 'on_hold' });
    expect((await (await put({ currentChapter: 11 })).json()).data.status).toBe('on_hold');
  });

  it('rejects chapter numbers the column cannot store', async () => {
    const invalid = await Promise.all([put({ currentChapter: -1 }), put({ currentChapter: 1.234 }), put({ currentChapter: 1e7 })]);

    expect(invalid.map((res) => res.status)).toEqual([400, 400, 400]);
  });
});

describe('GET /reading/dashboard — tracked series and release tracking', () => {
  const addToLibrary = (user: TestUser) =>
    reading.progress[':manhwaId'].$put({ param: { manhwaId: catalog.manhwa.id }, json: {} }, { headers: user.headers });
  const dashboard = async (user: TestUser) => {
    const res = await reading.dashboard.$get({}, { headers: user.headers });
    expect(res.status).toBe(200);
    return (await res.json()).data;
  };

  it('tracks the latest chapter even before any source is scraped', async () => {
    await addToLibrary(reader);

    const [entry] = await dashboard(reader);

    expect(entry?.manhwa.title).toBe('Solo Leveling');
    expect(entry?.tracking).toEqual({ latestChapter: 3, lastScrapedAt: null, sourceStatus: null, sourceCount: 0 });
  });

  it('aggregates the active sources: highest chapter, latest scrape, best current health', async () => {
    await addToLibrary(reader);
    await context.db.insert(manhwaSources).values([
      { manhwaId: catalog.manhwa.id, sourceId: catalog.source.id, latestChapter: 4, lastScrapedAt: new Date('2026-10-01T08:00:00Z') },
      { manhwaId: catalog.manhwa.id, sourceId: catalog.otherSource.id, lastScrapedAt: new Date('2026-10-09T08:00:00Z') },
    ]);
    await context.db.insert(sourceHealth).values([
      // Asura : bloquée hier, rétablie depuis → seule la dernière vérification compte.
      { sourceId: catalog.source.id, status: 'blocked', checkedAt: new Date('2026-10-08T08:00:00Z') },
      { sourceId: catalog.source.id, status: 'up', checkedAt: new Date('2026-10-09T08:00:00Z') },
      { sourceId: catalog.otherSource.id, status: 'down', checkedAt: new Date('2026-10-09T09:00:00Z') },
    ]);

    const [entry] = await dashboard(reader);

    expect(entry?.tracking).toEqual({
      latestChapter: 4,
      lastScrapedAt: '2026-10-09T08:00:00.000Z',
      sourceStatus: 'up',
      sourceCount: 2,
    });
  });

  it('ignores soft-deleted sources', async () => {
    await addToLibrary(reader);
    await context.db.insert(manhwaSources).values([
      { manhwaId: catalog.manhwa.id, sourceId: catalog.source.id, latestChapter: 9 },
      { manhwaId: catalog.manhwa.id, sourceId: catalog.otherSource.id },
    ]);
    await context.db.insert(sourceHealth).values([
      { sourceId: catalog.source.id, status: 'up' },
      { sourceId: catalog.otherSource.id, status: 'degraded' },
    ]);
    await context.db.update(sources).set({ deletedAt: new Date() }).where(eq(sources.id, catalog.source.id));

    const [entry] = await dashboard(reader);

    expect(entry?.tracking).toMatchObject({ latestChapter: 3, sourceStatus: 'degraded', sourceCount: 1 });
  });

  it("never shows another user's library (the session decides, there is no user parameter)", async () => {
    const other = await signUp(context, 'other');
    await addToLibrary(other);

    expect(await dashboard(reader)).toEqual([]);
    expect(await dashboard(other)).toHaveLength(1);
  });
});
