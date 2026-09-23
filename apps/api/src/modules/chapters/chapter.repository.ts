import { and, asc, eq, isNull } from 'drizzle-orm';
import type { DbClient } from '../../shared/db/index.js';
import { firstOrNull, firstOrThrow } from '../../shared/db/utils.js';
import { chapters, type NewChapter, type Chapter } from './chapter.schema.js';

export interface ChapterRepository {
  findAll(): Promise<Chapter[]>;
  findByManhwaId(manhwaId: Chapter['manhwaId']): Promise<Chapter[]>;
  findById(id: Chapter['id']): Promise<Chapter | null>;
  insert(data: NewChapter): Promise<Chapter>;
  update(id: Chapter['id'], data: Partial<NewChapter>): Promise<Chapter | null>;
  /** `deletedBy` est tracé dans `updated_by`. */
  softDelete(id: Chapter['id'], deletedBy: string | null): Promise<Chapter | null>;
}

/** Implémentation Drizzle. Toutes les lectures/écritures ignorent les chapters soft-deleted. */
export class DrizzleChapterRepository implements ChapterRepository {
  constructor(private readonly db: DbClient) {}

  async findAll(): Promise<Chapter[]> {
    return this.db.select().from(chapters).where(isNull(chapters.deletedAt));
  }

  async findByManhwaId(manhwaId: Chapter['manhwaId']): Promise<Chapter[]> {
    return this.db
      .select()
      .from(chapters)
      .where(and(eq(chapters.manhwaId, manhwaId), isNull(chapters.deletedAt)))
      .orderBy(asc(chapters.number));
  }

  async findById(id: Chapter['id']): Promise<Chapter | null> {
    const rows = await this.db
      .select()
      .from(chapters)
      .where(and(eq(chapters.id, id), isNull(chapters.deletedAt)))
      .limit(1);
    return firstOrNull(rows);
  }

  async insert(data: NewChapter): Promise<Chapter> {
    const rows = await this.db.insert(chapters).values(data).returning();
    return firstOrThrow(rows);
  }

  async update(id: Chapter['id'], data: Partial<NewChapter>): Promise<Chapter | null> {
    const rows = await this.db
      .update(chapters)
      .set(data)
      .where(and(eq(chapters.id, id), isNull(chapters.deletedAt)))
      .returning();
    return firstOrNull(rows);
  }

  async softDelete(id: Chapter['id'], deletedBy: string | null): Promise<Chapter | null> {
    const rows = await this.db
      .update(chapters)
      .set({ deletedAt: new Date(), updatedBy: deletedBy })
      .where(and(eq(chapters.id, id), isNull(chapters.deletedAt)))
      .returning();
    return firstOrNull(rows);
  }
}
