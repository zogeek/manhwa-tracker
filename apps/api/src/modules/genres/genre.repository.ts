import { asc, eq } from 'drizzle-orm';
import type { DbClient } from '../../shared/db/index.js';
import { firstOrNull, firstOrThrow } from '../../shared/db/utils.js';
import { genres, type Genre, type NewGenre } from './genre.schema.js';

export interface GenreRepository {
  findAll(): Promise<Genre[]>;
  findById(id: Genre['id']): Promise<Genre | null>;
  insert(data: NewGenre): Promise<Genre>;
  update(id: Genre['id'], data: Partial<NewGenre>): Promise<Genre | null>;
  /** Hard delete : les liaisons `manhwa_genres` partent en cascade. */
  remove(id: Genre['id']): Promise<Genre | null>;
}

export class DrizzleGenreRepository implements GenreRepository {
  constructor(private readonly db: DbClient) {}

  async findAll(): Promise<Genre[]> {
    return this.db.select().from(genres).orderBy(asc(genres.name));
  }

  async findById(id: Genre['id']): Promise<Genre | null> {
    const rows = await this.db.select().from(genres).where(eq(genres.id, id)).limit(1);
    return firstOrNull(rows);
  }

  async insert(data: NewGenre): Promise<Genre> {
    const rows = await this.db.insert(genres).values(data).returning();
    return firstOrThrow(rows);
  }

  async update(id: Genre['id'], data: Partial<NewGenre>): Promise<Genre | null> {
    const rows = await this.db.update(genres).set(data).where(eq(genres.id, id)).returning();
    return firstOrNull(rows);
  }

  async remove(id: Genre['id']): Promise<Genre | null> {
    const rows = await this.db.delete(genres).where(eq(genres.id, id)).returning();
    return firstOrNull(rows);
  }
}
