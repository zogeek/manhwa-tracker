import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { chapterReads } from '../../shared/db/schema.js';
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
