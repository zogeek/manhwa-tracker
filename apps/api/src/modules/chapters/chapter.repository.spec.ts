import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, inject, it } from 'vitest';
import * as schema from '../../shared/db/schema.js';
import { chapterReleaseGroups, chapterReleases, chapters, scanlationGroups, sources } from '../../shared/db/schema.js';
import { seedCatalog, type SeededCatalog } from '../../shared/db/seed.test.js';
import { firstOrThrow } from '../../shared/db/utils.js';
import { DrizzleChapterRepository } from './chapter.repository.js';

// Postgres réel : les LEFT JOIN et le regroupement parution → teams ne se vérifient pas avec un fake.
// Le logger Drizzle compte les requêtes envoyées : c'est la preuve qu'il n'y a pas de N+1.
let queryCount = 0;
const pool = new Pool({ connectionString: inject('databaseUrl') });
const db = drizzle(pool, { schema, logger: { logQuery: () => void queryCount++ } });
const repo = new DrizzleChapterRepository(db);

let catalog: SeededCatalog;

beforeEach(async () => {
  catalog = await seedCatalog(db);
});
afterAll(() => pool.end());

const insertTeam = async (name: string, websiteUrl: string | null = null) =>
  firstOrThrow(
    await db
      .insert(scanlationGroups)
      .values({ name, slug: name.toLowerCase().replaceAll(' ', '-'), websiteUrl })
      .returning(),
  );

const insertRelease = async (chapterNumber: number, url: string, language = 'fr', sourceId = catalog.source.id) =>
  firstOrThrow(
    await db
      .insert(chapterReleases)
      .values({ chapterId: catalog.chapterByNumber(chapterNumber).id, sourceId, url, language })
      .returning(),
  );

const credit = (releaseId: string, teamIds: string[]) =>
  db.insert(chapterReleaseGroups).values(teamIds.map((groupId, position) => ({ releaseId, groupId, position })));

describe('DrizzleChapterRepository.findByManhwaId — chapters with releases and teams', () => {
  it('attaches every release with its teams in credit order, and neutral empty lists otherwise', async () => {
    const asura = await insertTeam('Asura Scans', 'https://asura.example');
    const flame = await insertTeam('Flame Comics');
    const collab = await insertRelease(2, 'https://asura.example/ch-2');
    // Crédit inversé à l'insertion : l'ordre doit venir de `position`, pas de l'ordre physique.
    await db.insert(chapterReleaseGroups).values([
      { releaseId: collab.id, groupId: flame.id, position: 1 },
      { releaseId: collab.id, groupId: asura.id, position: 0 },
    ]);
    const uncredited = await insertRelease(2, 'https://phenix.example/ch-2', 'en', catalog.otherSource.id);

    const result = await repo.findByManhwaId(catalog.manhwa.id);

    expect(result.map((chapter) => chapter.number)).toEqual([1, 2, 2.5, 3]);
    expect(result.find((chapter) => chapter.number === 1)?.releases).toEqual([]);
    expect(result.find((chapter) => chapter.number === 2)?.releases).toEqual([
      { id: uncredited.id, url: 'https://phenix.example/ch-2', language: 'en', sourceName: 'Phenix Scans', teams: [] },
      {
        id: collab.id,
        url: 'https://asura.example/ch-2',
        language: 'fr',
        sourceName: 'Asura Scans',
        teams: [
          { id: asura.id, name: 'Asura Scans', websiteUrl: 'https://asura.example' },
          { id: flame.id, name: 'Flame Comics', websiteUrl: null },
        ],
      },
    ]);
  });

  it('sends exactly two queries, however many chapters, releases and teams there are', async () => {
    const teams = await Promise.all(['Team A', 'Team B', 'Team C'].map((name) => insertTeam(name)));
    for (const number of [1, 2, 2.5, 3]) {
      const release = await insertRelease(number, `https://asura.example/${number}`);
      await credit(
        release.id,
        teams.map((team) => team.id),
      );
    }

    queryCount = 0;
    const result = await repo.findByManhwaId(catalog.manhwa.id);

    expect(queryCount).toBe(2);
    expect(result.every((chapter) => chapter.releases[0]?.teams.length === 3)).toBe(true);
  });

  it('hides releases removed from their source, from a deleted source, or of a deleted chapter', async () => {
    const removed = await insertRelease(1, 'https://asura.example/removed');
    await db.update(chapterReleases).set({ removedAt: new Date() }).where(eq(chapterReleases.id, removed.id));
    await insertRelease(2, 'https://phenix.example/2', 'fr', catalog.otherSource.id);
    await db.update(sources).set({ deletedAt: new Date() }).where(eq(sources.id, catalog.otherSource.id));
    await insertRelease(3, 'https://asura.example/3');
    await db.update(chapters).set({ deletedAt: new Date() }).where(eq(chapters.id, catalog.chapterByNumber(3).id));

    const result = await repo.findByManhwaId(catalog.manhwa.id);

    expect(result.map((chapter) => chapter.number)).toEqual([1, 2, 2.5]);
    expect(result.flatMap((chapter) => chapter.releases)).toEqual([]);
  });

  it('keeps chapters intact when a credited team is deleted (pivot cascade)', async () => {
    const team = await insertTeam('Gone Scans');
    const release = await insertRelease(1, 'https://asura.example/1');
    await credit(release.id, [team.id]);

    await db.delete(scanlationGroups).where(eq(scanlationGroups.id, team.id));
    const result = await repo.findByManhwaId(catalog.manhwa.id);

    expect(result.find((chapter) => chapter.number === 1)?.releases).toEqual([
      { id: release.id, url: 'https://asura.example/1', language: 'fr', sourceName: 'Asura Scans', teams: [] },
    ]);
  });
});
