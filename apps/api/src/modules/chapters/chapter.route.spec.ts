import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chapterReleaseGroups, chapterReleases, scanlationGroups } from '../../shared/db/schema.js';
import { seedCatalog, type SeededCatalog } from '../../shared/db/seed.test.js';
import { firstOrThrow } from '../../shared/db/utils.js';
import { createTestContext } from '../../test/integration.js';

const context = createTestContext();
const chapters = context.client.chapters;

let catalog: SeededCatalog;

beforeAll(async () => {
  catalog = await seedCatalog(context.db);
});

afterAll(() => context.close());

describe('GET /chapters/manhwa/:manhwaId — public list with releases and teams', () => {
  it('returns each chapter with its releases and credited teams, without a session', async () => {
    const teams = await context.db
      .insert(scanlationGroups)
      .values([
        { name: 'Asura Scans', slug: 'asura-scans' },
        { name: 'Flame Comics', slug: 'flame-comics' },
      ])
      .returning();
    const release = firstOrThrow(
      await context.db
        .insert(chapterReleases)
        .values({ chapterId: catalog.chapterByNumber(1).id, sourceId: catalog.source.id, url: 'https://asura.example/1' })
        .returning(),
    );
    await context.db
      .insert(chapterReleaseGroups)
      .values(teams.map((team, position) => ({ releaseId: release.id, groupId: team.id, position })));

    const res = await chapters.manhwa[':manhwaId'].$get({ param: { manhwaId: catalog.manhwa.id } });

    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.map((chapter) => chapter.number)).toEqual([1, 2, 2.5, 3]);
    expect(data[0]?.releases.map((entry) => ({ language: entry.language, teams: entry.teams.map((team) => team.name) }))).toEqual([
      { language: 'fr', teams: ['Asura Scans', 'Flame Comics'] },
    ]);
    expect(data[1]?.releases).toEqual([]);
  });

  it('answers 400 on a malformed manhwa id', async () => {
    const res = await chapters.manhwa[':manhwaId'].$get({ param: { manhwaId: 'not-a-uuid' } });

    expect(res.status).toBe(400);
  });
});
