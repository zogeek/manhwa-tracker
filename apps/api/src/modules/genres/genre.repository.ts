import { eq } from 'drizzle-orm';
import { db } from '../../shared/db/index.js';
import { genres } from './genre.schema.js';
import type { Genre, NewGenre } from './genre.schema.js';

export class GenreRepository {
  async findAll(): Promise<Genre[]> {
    return db.select().from(genres);
  }

  async findById(id: string): Promise<Genre | null> {
    const [result] = await db
      .select()
      .from(genres)
      .where(eq(genres.id, id));

    return result || null;
  }

  async findBySlug(slug: string): Promise<Genre | null> {
    const [result] = await db
      .select()
      .from(genres)
      .where(eq(genres.slug, slug));

    return result || null;
  }

  async insert(data: Omit<NewGenre, 'id'>): Promise<Genre> {
    const [result] = await db
      .insert(genres)
      .values(data)
      .returning();

    return result!;
  }

  async update(id: string, data: Partial<Omit<NewGenre, 'id'>>): Promise<Genre> {
    const [result] = await db
      .update(genres)
      .set(data)
      .where(eq(genres.id, id))
      .returning();

    return result!;
  }

  async remove(id: string): Promise<void> {
    await db
      .delete(genres)
      .where(eq(genres.id, id));
  }
}
