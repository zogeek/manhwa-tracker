import { getTableName, is, sql } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import type { Database } from './index.js';
import * as schema from './schema.js';
import { firstOrThrow } from './utils.js';

// Toutes les tables déclarées dans le schéma : aucune liste à maintenir à la main.
const tableNames: string[] = [];
for (const value of Object.values<unknown>(schema)) {
  if (is(value, PgTable)) tableNames.push(`"${getTableName(value)}"`);
}

/** Vide toutes les tables (données de test uniquement). */
export async function resetDatabase(db: Database): Promise<void> {
  await db.execute(sql.raw(`TRUNCATE TABLE ${tableNames.join(', ')} RESTART IDENTITY CASCADE`));
}

/** Jeu de données de base rejoué avant chaque suite d'intégration. */
export async function seedCatalog(db: Database) {
  await resetDatabase(db);

  const manhwa = firstOrThrow(
    await db.insert(schema.manhwas).values({ title: 'Solo Leveling', type: 'manhwa' }).returning(),
  );
  const chapters = await db
    .insert(schema.chapters)
    .values([1, 2, 2.5, 3].map((number) => ({ manhwaId: manhwa.id, number })))
    .returning();
  // Taxonomie : vocabulaire hiérarchique « genre » avec Action > Martial arts, et un vocabulaire plat.
  const genreVocabulary = firstOrThrow(
    await db.insert(schema.vocabularies).values({ slug: 'genre', name: 'Genres', isHierarchical: true }).returning(),
  );
  const themeVocabulary = firstOrThrow(
    await db.insert(schema.vocabularies).values({ slug: 'theme', name: 'Thèmes' }).returning(),
  );
  const action = firstOrThrow(
    await db.insert(schema.terms).values({ vocabularyId: genreVocabulary.id, slug: 'action', name: 'Action' }).returning(),
  );
  const martialArts = firstOrThrow(
    await db
      .insert(schema.terms)
      .values({ vocabularyId: genreVocabulary.id, parentId: action.id, slug: 'martial-arts', name: 'Martial arts' })
      .returning(),
  );
  await db.insert(schema.manhwaTerms).values({ manhwaId: manhwa.id, termId: action.id });

  const source = firstOrThrow(
    await db.insert(schema.sources).values({ name: 'Asura Scans', baseUrl: 'https://asura.example' }).returning(),
  );
  const otherSource = firstOrThrow(
    await db.insert(schema.sources).values({ name: 'Phenix Scans', baseUrl: 'https://phenix.example' }).returning(),
  );

  const chapterByNumber = (number: number) => firstOrThrow(chapters.filter((chapter) => chapter.number === number));

  return {
    manhwa,
    chapterByNumber,
    taxonomy: { genreVocabulary, themeVocabulary, action, martialArts },
    source,
    otherSource,
  };
}

export type SeededCatalog = Awaited<ReturnType<typeof seedCatalog>>;
