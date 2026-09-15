import { eq, isNull, and } from 'drizzle-orm';
import { db } from '../../shared/db/index.js';
import { chapters, type Chapter, type NewChapter } from './chapter.schema.js';

export class ChapterRepository {
  async findAll(): Promise<Chapter[]> {
    return await db.select().from(chapters).where(isNull(chapters.deletedAt));
  }

  async findByManhwaId(manhwaId: string): Promise<Chapter[]> {
    return await db
      .select()
      .from(chapters)
      .where(and(eq(chapters.manhwaId, manhwaId), isNull(chapters.deletedAt)));
  }

  async findById(id: string): Promise<Chapter | null> {
    const result = await db
      .select()
      .from(chapters)
      .where(and(eq(chapters.id, id), isNull(chapters.deletedAt)))
      .limit(1);
    
    return result[0] ?? null;
  }

  async insert(data: NewChapter): Promise<Chapter> {
    const result = await db.insert(chapters).values(data).returning();
    return result[0];
  }

  async update(id: string, data: Partial<NewChapter>): Promise<Chapter> {
    const result = await db
      .update(chapters)
      .set(data)
      .where(eq(chapters.id, id))
      .returning();
    return result[0];
  }

  async softDelete(id: string): Promise<void> {
    await db
      .update(chapters)
      .set({ deletedAt: new Date() })
      .where(eq(chapters.id, id));
  }
}
