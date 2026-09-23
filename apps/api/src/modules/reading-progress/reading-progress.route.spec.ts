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
