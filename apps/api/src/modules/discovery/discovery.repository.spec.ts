import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { createDatabase } from '../../shared/db/index.js';
import { authors, manhwaAuthors, manhwas } from '../../shared/db/schema.js';
import { firstOrThrow } from '../../shared/db/utils.js';
import { resetDatabase } from '../../shared/db/seed.test.js';
import { DrizzleDiscoveryRepository } from './discovery.repository.js';
import { splitNativeName, type ExternalAuthor } from './external-catalog.js';

// Intégration sur le vrai Postgres : l'upsert par clé d'identité et l'ordre dépendent de la base.
const database = createDatabase(inject('databaseUrl'));
const repo = new DrizzleDiscoveryRepository(database.db);

afterAll(() => database.close());
beforeEach(() => resetDatabase(database.db));

const newManhwa = async (title: string) =>
  firstOrThrow(await database.db.insert(manhwas).values({ title }).returning({ id: manhwas.id })).id;

const fromMangaDex = (raw: string, role: ExternalAuthor['role']): ExternalAuthor => ({ ...splitNativeName(raw), role });

describe('DrizzleDiscoveryRepository.attachAuthors', () => {
  // Graphies réellement renvoyées pour Solo Leveling par AniList puis par MangaDex (septembre 2026).
  it('recognises the same people across catalogues through their native names', async () => {
    const anilistWork = await newManhwa('Solo Leveling');
    const mangadexWork = await newManhwa('Solo Leveling: Ragnarok');

    await repo.attachAuthors(anilistWork, [
      { name: 'Chu-Gong', nativeName: '추공', role: 'story' },
      { name: 'Seong-Rak Jang', nativeName: '장성락', role: 'art' },
    ]);
    await repo.attachAuthors(mangadexWork, [
      fromMangaDex('Chugong (추공)', 'story'),
      fromMangaDex('Jang Sung-Rak (장성락)', 'art'),
      fromMangaDex('REDICE Studio (레드아이스 스튜디오)', 'art'),
    ]);

    const rows = await database.db.select({ name: authors.name, nativeName: authors.nativeName }).from(authors);
    // Deux personnes partagées (nom affiché du premier import conservé) + le studio.
    expect(rows.map((row) => `${row.name}/${row.nativeName}`).sort()).toEqual([
      'Chu-Gong/추공',
      'REDICE Studio/레드아이스 스튜디오',
      'Seong-Rak Jang/장성락',
    ]);
    expect(await database.db.select().from(manhwaAuthors).where(eq(manhwaAuthors.manhwaId, mangadexWork))).toHaveLength(3);
  });

  it('keeps the catalogue order and merges a person listed twice into "both"', async () => {
    const work = await newManhwa('The Beginning After the End');

    await repo.attachAuthors(work, [
      { name: 'TurtleMe', nativeName: null, role: 'story' },
      { name: 'Fuyuki23', nativeName: null, role: 'art' },
      { name: 'Turtle-Me', nativeName: null, role: 'art' },
    ]);

    const links = await database.db
      .select({ name: authors.name, role: manhwaAuthors.role, position: manhwaAuthors.position })
      .from(manhwaAuthors)
      .innerJoin(authors, eq(authors.id, manhwaAuthors.authorId))
      .where(eq(manhwaAuthors.manhwaId, work))
      .orderBy(manhwaAuthors.position);
    expect(links).toEqual([
      { name: 'TurtleMe', role: 'both', position: 0 },
      { name: 'Fuyuki23', role: 'art', position: 1 },
    ]);
    expect(await repo.hasAuthors(work)).toBe(true);
    expect(await repo.hasAuthors(await newManhwa('No staff'))).toBe(false);
  });
});
