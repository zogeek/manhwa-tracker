import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { manhwas, manhwaSources, readingProgress } from '../../shared/db/schema.js';
import { seedCatalog, type SeededCatalog } from '../../shared/db/seed.test.js';
import { firstOrThrow } from '../../shared/db/utils.js';
import { createTestContext, signUp, signUpAdmin, type TestUser } from '../../test/integration.js';

const context = createTestContext();
const link = context.client.manhwas[':manhwaId'].sources[':sourceId'];

const WRONG_URL = 'https://asura.example/series/not-solo-leveling';
const RIGHT_URL = 'https://asura.example/series/solo-leveling';

let catalog: SeededCatalog;
let follower: TestUser;
let stranger: TestUser;
let admin: TestUser;
let param: { manhwaId: string; sourceId: string };

beforeAll(async () => {
  catalog = await seedCatalog(context.db);
  follower = await signUp(context, 'follower');
  stranger = await signUp(context, 'stranger');
  admin = await signUpAdmin(context, 'admin');
  await context.db.insert(readingProgress).values({ userId: follower.id, manhwaId: catalog.manhwa.id });
  param = { manhwaId: catalog.manhwa.id, sourceId: catalog.source.id };
});

// Le Dorking a lié Solo Leveling à la mauvaise fiche d'Asura.
beforeEach(async () => {
  await context.db.delete(manhwaSources);
  await context.db
    .insert(manhwaSources)
    .values({ ...param, manhwaUrl: WRONG_URL, latestChapter: 412, lastScrapedAt: new Date() });
});

afterAll(() => context.close());

async function storedLink() {
  return firstOrThrow(
    await context.db
      .select()
      .from(manhwaSources)
      .where(and(eq(manhwaSources.manhwaId, param.manhwaId), eq(manhwaSources.sourceId, param.sourceId))),
  );
}

describe('PATCH /manhwas/:manhwaId/sources/:sourceId — authorization', () => {
  it('answers 401 without a session, even with a forged x-user-id', async () => {
    const res = await link.$patch(
      { param, json: { manhwaUrl: RIGHT_URL } },
      { headers: { 'x-user-id': follower.id } },
    );

    expect(res.status).toBe(401);
    expect((await storedLink()).manhwaUrl).toBe(WRONG_URL);
  });

  it('answers 403 to a signed-in user who does not follow the series, and changes nothing', async () => {
    const res = await link.$patch({ param, json: { manhwaUrl: RIGHT_URL } }, { headers: stranger.headers });

    expect(res.status).toBe(403);
    expect((await storedLink()).manhwaUrl).toBe(WRONG_URL);
  });

  it('lets an admin correct a series they do not follow', async () => {
    const res = await link.$patch({ param, json: { manhwaUrl: RIGHT_URL } }, { headers: admin.headers });

    expect(res.status).toBe(200);
  });
});

describe('PATCH /manhwas/:manhwaId/sources/:sourceId — correction', () => {
  it('answers 200 with the corrected link and resets what was scraped on the wrong page', async () => {
    const res = await link.$patch({ param, json: { manhwaUrl: RIGHT_URL } }, { headers: follower.headers });

    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ ...param, manhwaUrl: RIGHT_URL, latestChapter: null, lastScrapedAt: null });
    expect(await storedLink()).toMatchObject({ manhwaUrl: RIGHT_URL, latestChapter: null, lastScrapedAt: null });
  });

  it('accepts null: the worker will search the series again', async () => {
    const res = await link.$patch({ param, json: { manhwaUrl: null } }, { headers: follower.headers });

    expect(res.status).toBe(200);
    expect((await storedLink()).manhwaUrl).toBeNull();
  });

  it('answers 404 when the manhwa is not linked to the source', async () => {
    const responses = await Promise.all([
      link.$patch(
        { param: { ...param, sourceId: catalog.otherSource.id }, json: { manhwaUrl: null } },
        { headers: follower.headers },
      ),
      link.$patch(
        { param: { ...param, manhwaId: randomUUID() }, json: { manhwaUrl: null } },
        { headers: admin.headers },
      ),
    ]);

    expect(responses.map((res) => res.status)).toEqual([404, 404]);
  });

  it('answers 404 once the manhwa is soft-deleted', async () => {
    const other = firstOrThrow(await context.db.insert(manhwas).values({ title: 'Gone', deletedAt: new Date() }).returning());
    await context.db.insert(manhwaSources).values({ manhwaId: other.id, sourceId: param.sourceId, manhwaUrl: null });

    const res = await link.$patch(
      { param: { ...param, manhwaId: other.id }, json: { manhwaUrl: null } },
      { headers: admin.headers },
    );

    expect(res.status).toBe(404);
  });

  it('answers 400 on a missing or malformed URL', async () => {
    const responses = await Promise.all([
      link.$patch({ param, json: { manhwaUrl: 'not a url' } }, { headers: follower.headers }),
      link.$patch({ param, json: { manhwaUrl: 'ftp://asura.example/series/x' } }, { headers: follower.headers }),
      context.app.request(`/manhwas/${param.manhwaId}/sources/${param.sourceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...follower.headers },
        body: '{}',
      }),
    ]);

    expect(responses.map((res) => res.status)).toEqual([400, 400, 400]);
  });

  it('answers 422 when the URL is not on the source site', async () => {
    const res = await link.$patch(
      { param, json: { manhwaUrl: 'https://phenix.example/series/solo-leveling' } },
      { headers: follower.headers },
    );

    expect(res.status).toBe(422);
    expect((await storedLink()).manhwaUrl).toBe(WRONG_URL);
  });

  it('answers 409 when the URL already belongs to another series on this source', async () => {
    const other = firstOrThrow(await context.db.insert(manhwas).values({ title: 'Other' }).returning());
    await context.db.insert(manhwaSources).values({ manhwaId: other.id, sourceId: param.sourceId, manhwaUrl: RIGHT_URL });

    const res = await link.$patch({ param, json: { manhwaUrl: RIGHT_URL } }, { headers: follower.headers });

    expect(res.status).toBe(409);
  });
});
