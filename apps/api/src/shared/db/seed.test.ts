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
  const genre = firstOrThrow(
    await db.insert(schema.genres).values({ name: 'Action', slug: 'action' }).returning(),
  );
  await db.insert(schema.manhwaGenres).values({ manhwaId: manhwa.id, genreId: genre.id });

  const chapterByNumber = (number: number) => firstOrThrow(chapters.filter((chapter) => chapter.number === number));

  return { manhwa, genre, chapterByNumber };
}

export type SeededCatalog = Awaited<ReturnType<typeof seedCatalog>>;
