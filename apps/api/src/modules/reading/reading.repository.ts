import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '../../shared/db/index.js';
import { readingProgress, chapterReads, readingLists, readingListItems, chapters } from '../../shared/db/schema.js';
import type { NewReadingProgress, NewChapterRead, NewReadingList, NewReadingListItem } from './reading.schema.js';

export class ReadingRepository {
  async findProgressByUserAndManhwa(userId: string, manhwaId: string) {
    const result = await db
      .select()
      .from(readingProgress)
      .where(and(eq(readingProgress.userId, userId), eq(readingProgress.manhwaId, manhwaId)))
      .limit(1);
    return result[0] || null;
  }

  async findAllProgressByUser(userId: string) {
    return db
      .select()
      .from(readingProgress)
      .where(eq(readingProgress.userId, userId));
  }

  async upsertProgress(data: NewReadingProgress) {
    const result = await db
      .insert(readingProgress)
      .values(data)
      .onConflictDoUpdate({
        target: [readingProgress.userId, readingProgress.manhwaId],
        set: {
          status: data.status,
          currentChapter: data.currentChapter,
          furthestChapter: data.furthestChapter,
          rating: data.rating,
          notes: data.notes,
          startedAt: data.startedAt,
          completedAt: data.completedAt,
          updatedAt: new Date(),
          updatedBy: data.updatedBy,
        },
      })
      .returning();
    return result[0];
  }

  async updateProgress(userId: string, manhwaId: string, data: Partial<NewReadingProgress>) {
    const result = await db
      .update(readingProgress)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(readingProgress.userId, userId), eq(readingProgress.manhwaId, manhwaId)))
      .returning();
    return result[0] || null;
  }

  async insertRead(data: NewChapterRead) {
    const result = await db
      .insert(chapterReads)
      .values(data)
      .returning();
    return result[0];
  }

  async findReadsByUser(userId: string) {
    return db
      .select()
      .from(chapterReads)
      .where(eq(chapterReads.userId, userId))
      .orderBy(desc(chapterReads.readAt));
  }

  async findReadsByUserAndManhwa(userId: string, manhwaId: string) {
    return db
      .select({
        id: chapterReads.id,
        userId: chapterReads.userId,
        chapterId: chapterReads.chapterId,
        sourceId: chapterReads.sourceId,
        readAt: chapterReads.readAt,
        readingTimeSeconds: chapterReads.readingTimeSeconds,
      })
      .from(chapterReads)
      .innerJoin(chapters, eq(chapterReads.chapterId, chapters.id))
      .where(and(eq(chapterReads.userId, userId), eq(chapters.manhwaId, manhwaId)))
      .orderBy(desc(chapterReads.readAt));
  }

  async findAllListsByUser(userId: string) {
    return db
      .select()
      .from(readingLists)
      .where(and(eq(readingLists.userId, userId), isNull(readingLists.deletedAt)))
      .orderBy(readingLists.sortOrder);
  }

  async findListById(id: string) {
    const result = await db
      .select()
      .from(readingLists)
      .where(and(eq(readingLists.id, id), isNull(readingLists.deletedAt)))
      .limit(1);
    return result[0] || null;
  }

  async insertList(data: NewReadingList) {
    const result = await db
      .insert(readingLists)
      .values(data)
      .returning();
    return result[0];
  }

  async updateList(id: string, data: Partial<NewReadingList>) {
    const result = await db
      .update(readingLists)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(readingLists.id, id))
      .returning();
    return result[0] || null;
  }

  async softDeleteList(id: string) {
    const result = await db
      .update(readingLists)
      .set({ deletedAt: new Date() })
      .where(eq(readingLists.id, id))
      .returning();
    return result[0] || null;
  }

  async findListItems(listId: string) {
    return db
      .select()
      .from(readingListItems)
      .where(eq(readingListItems.listId, listId))
      .orderBy(readingListItems.sortOrder);
  }

  async insertListItem(data: NewReadingListItem) {
    const result = await db
      .insert(readingListItems)
      .values(data)
      .returning();
    return result[0];
  }

  async deleteListItem(listId: string, manhwaId: string) {
    const result = await db
      .delete(readingListItems)
      .where(and(eq(readingListItems.listId, listId), eq(readingListItems.manhwaId, manhwaId)))
      .returning();
    return result[0] || null;
  }
}
