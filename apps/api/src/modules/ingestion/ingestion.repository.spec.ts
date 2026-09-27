import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { createDatabase } from '../../shared/db/index.js';
import { chapterReleaseGroups, chapterReleases, scanlationGroups } from '../../shared/db/schema.js';
import { seedCatalog, type SeededCatalog } from '../../shared/db/seed.test.js';
import { DrizzleIngestionRepository, type TeamInput } from './ingestion.repository.js';

// Intégration sur le vrai Postgres : idempotence (ON CONFLICT), index uniques et cascades.
const database = createDatabase(inject('databaseUrl'));
const repo = new DrizzleIngestionRepository(database.db);

let catalog: SeededCatalog;

beforeEach(async () => {
  catalog = await seedCatalog(database.db);
});
afterAll(() => database.close());

const scraperTeam = (name: string): TeamInput => ({ name, websiteUrl: null, provider: null, externalId: null });
const mangadexTeam = (externalId: string, name: string | null, websiteUrl: string | null = null): TeamInput => ({
  name,
  websiteUrl,
  provider: 'mangadex',
  externalId,
});

const teams = () => database.db.select().from(scanlationGroups);

const newRelease = async (url: string) =>
  (
    await repo.upsertRelease({
      chapterId: catalog.chapterByNumber(1).id,
      sourceId: catalog.source.id,
      url,
      language: 'en',
    })
  ).id;

describe('DrizzleIngestionRepository.upsertTeam — idempotent, never duplicated', () => {
  it('returns the same team however many chapters it is credited on', async () => {
    const ids = await Promise.all(Array.from({ length: 5 }, () => repo.upsertTeam(scraperTeam('Asura Scans'))));
    // Même nom à la casse / aux espaces près : même team.
    ids.push(await repo.upsertTeam(scraperTeam('  asura   SCANS ')));

    expect(new Set(ids).size).toBe(1);
    expect(await teams()).toHaveLength(1);
  });

  it('recognises a provider team by its id even after it was renamed', async () => {
    const before = await repo.upsertTeam(mangadexTeam('uuid-asura', 'Asura Scans'));
    const after = await repo.upsertTeam(mangadexTeam('uuid-asura', 'Asura Comics'));

    expect(after).toBe(before);
    expect((await teams()).map((team) => team.name)).toEqual(['Asura Scans']);
  });

  it('gives an id to a team first met by name (scraper), without duplicating it', async () => {
    const fromScraper = await repo.upsertTeam(scraperTeam('Flame Comics'));
    const fromMangaDex = await repo.upsertTeam(mangadexTeam('uuid-flame', 'Flame Comics', 'https://flamecomics.xyz'));

    expect(fromMangaDex).toBe(fromScraper);
    expect(await teams()).toEqual([
      expect.objectContaining({
        name: 'Flame Comics',
        provider: 'mangadex',
        externalId: 'uuid-flame',
        websiteUrl: 'https://flamecomics.xyz',
      }),
    ]);
  });

  it('returns null for an unknown id without a name (deleted group), instead of creating a nameless team', async () => {
    expect(await repo.upsertTeam(mangadexTeam('uuid-deleted', null))).toBeNull();
    expect(await teams()).toEqual([]);
  });
});

describe('DrizzleIngestionRepository.setReleaseTeams — collaborations', () => {
  it('credits several teams in order, and follows the source when the credits change', async () => {
    const release = await newRelease('https://asura.example/solo-leveling/1');
    const asura = await repo.upsertTeam(scraperTeam('Asura Scans'));
    const flame = await repo.upsertTeam(scraperTeam('Flame Comics'));
    const reaper = await repo.upsertTeam(scraperTeam('Reaper Scans'));
    if (!asura || !flame || !reaper) throw new Error('teams expected');

    await repo.setReleaseTeams(release, [asura, flame]);
    await repo.setReleaseTeams(release, [asura, flame]); // rejeu : aucun doublon
    const credits = () =>
      database.db
        .select({ groupId: chapterReleaseGroups.groupId, position: chapterReleaseGroups.position })
        .from(chapterReleaseGroups)
        .where(eq(chapterReleaseGroups.releaseId, release))
        .orderBy(chapterReleaseGroups.position);
    expect(await credits()).toEqual([
      { groupId: asura, position: 0 },
      { groupId: flame, position: 1 },
    ]);

    await repo.setReleaseTeams(release, [reaper, asura]);
    expect(await credits()).toEqual([
      { groupId: reaper, position: 0 },
      { groupId: asura, position: 1 },
    ]);

    // Une source qui ne crédite personne n'efface pas les crédits connus.
    await repo.setReleaseTeams(release, []);
    expect(await credits()).toHaveLength(2);
  });

  it('keeps releases and teams consistent when either side is deleted (pivot cascade)', async () => {
    const release = await newRelease('https://asura.example/solo-leveling/2');
    const asura = await repo.upsertTeam(scraperTeam('Asura Scans'));
    const flame = await repo.upsertTeam(scraperTeam('Flame Comics'));
    if (!asura || !flame) throw new Error('teams expected');
    await repo.setReleaseTeams(release, [asura, flame]);

    // Team supprimée : seul son crédit disparaît, la parution et l'autre team restent.
    await database.db.delete(scanlationGroups).where(eq(scanlationGroups.id, flame));
    expect(await database.db.select().from(chapterReleases).where(eq(chapterReleases.id, release))).toHaveLength(1);
    expect(await database.db.select().from(chapterReleaseGroups)).toEqual([
      expect.objectContaining({ releaseId: release, groupId: asura }),
    ]);

    // Parution supprimée : ses crédits partent, la team reste (elle a d'autres chapitres).
    await database.db.delete(chapterReleases).where(eq(chapterReleases.id, release));
    expect(await database.db.select().from(chapterReleaseGroups)).toEqual([]);
    expect((await teams()).map((team) => team.name)).toEqual(['Asura Scans']);
  });
});
