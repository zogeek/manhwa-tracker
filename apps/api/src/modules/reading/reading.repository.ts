import { and, asc, desc, eq, getTableColumns, isNull } from 'drizzle-orm';
import type { DbClient } from '../../shared/db/index.js';
import { chapters } from '../../shared/db/schema.js';
import { firstOrNull, firstOrThrow } from '../../shared/db/utils.js';
import {
  chapterReads,
  readingListItems,
  readingLists,
  readingProgress,
  type ChapterRead,
  type NewChapterRead,
  type NewReadingList,
  type NewReadingListItem,
  type NewReadingProgress,
  type ReadingList,
  type ReadingListItem,
  type ReadingProgress,
} from './reading.schema.js';

export interface ReadingRepository {
  findProgressByUserAndManhwa(userId: string, manhwaId: string): Promise<ReadingProgress | null>;
  findAllProgressByUser(userId: string): Promise<ReadingProgress[]>;
  upsertProgress(data: NewReadingProgress): Promise<ReadingProgress>;
  insertRead(data: NewChapterRead): Promise<ChapterRead>;
  findReadsByUser(userId: string): Promise<ChapterRead[]>;
  findReadsByUserAndManhwa(userId: string, manhwaId: string): Promise<ChapterRead[]>;
  findAllListsByUser(userId: string): Promise<ReadingList[]>;
  findListById(id: string): Promise<ReadingList | null>;
  insertList(data: NewReadingList): Promise<ReadingList>;
  updateList(id: string, data: Partial<NewReadingList>): Promise<ReadingList | null>;
  softDeleteList(id: string): Promise<ReadingList | null>;
  insertListItem(data: NewReadingListItem): Promise<ReadingListItem>;
  deleteListItem(listId: string, manhwaId: string): Promise<ReadingListItem | null>;
}

export class DrizzleReadingRepository implements ReadingRepository {
  constructor(private readonly db: DbClient) {}

  async findProgressByUserAndManhwa(userId: string, manhwaId: string): Promise<ReadingProgress | null> {
    const rows = await this.db
      .select()
      .from(readingProgress)
      .where(and(eq(readingProgress.userId, userId), eq(readingProgress.manhwaId, manhwaId)))
      .limit(1);
    return firstOrNull(rows);
  }

  async findAllProgressByUser(userId: string): Promise<ReadingProgress[]> {
    return this.db
      .select()
      .from(readingProgress)
      .where(eq(readingProgress.userId, userId));
  }

  async upsertProgress(data: NewReadingProgress): Promise<ReadingProgress> {
    const rows = await this.db
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
    return firstOrThrow(rows);
  }

  async insertRead(data: NewChapterRead): Promise<ChapterRead> {
    const rows = await this.db.insert(chapterReads).values(data).returning();
    return firstOrThrow(rows);
  }

  async findReadsByUser(userId: string): Promise<ChapterRead[]> {
    return this.db
      .select()
      .from(chapterReads)
      .where(eq(chapterReads.userId, userId))
      .orderBy(desc(chapterReads.readAt));
  }

  async findReadsByUserAndManhwa(userId: string, manhwaId: string): Promise<ChapterRead[]> {
    return this.db
      .select(getTableColumns(chapterReads))
      .from(chapterReads)
      .innerJoin(chapters, eq(chapterReads.chapterId, chapters.id))
      .where(and(eq(chapterReads.userId, userId), eq(chapters.manhwaId, manhwaId)))
      .orderBy(desc(chapterReads.readAt));
  }

  async findAllListsByUser(userId: string): Promise<ReadingList[]> {
    return this.db
      .select()
      .from(readingLists)
      .where(and(eq(readingLists.userId, userId), isNull(readingLists.deletedAt)))
      .orderBy(asc(readingLists.sortOrder));
  }

  async findListById(id: string): Promise<ReadingList | null> {
    const rows = await this.db
      .select()
      .from(readingLists)
      .where(and(eq(readingLists.id, id), isNull(readingLists.deletedAt)))
      .limit(1);
    return firstOrNull(rows);
  }

  async insertList(data: NewReadingList): Promise<ReadingList> {
    const rows = await this.db.insert(readingLists).values(data).returning();
    return firstOrThrow(rows);
  }

  async updateList(id: string, data: Partial<NewReadingList>): Promise<ReadingList | null> {
    const rows = await this.db
      .update(readingLists)
      .set(data)
      .where(and(eq(readingLists.id, id), isNull(readingLists.deletedAt)))
      .returning();
    return firstOrNull(rows);
  }

  async softDeleteList(id: string): Promise<ReadingList | null> {
    const rows = await this.db
      .update(readingLists)
      .set({ deletedAt: new Date() })
      .where(and(eq(readingLists.id, id), isNull(readingLists.deletedAt)))
      .returning();
    return firstOrNull(rows);
  }

  async insertListItem(data: NewReadingListItem): Promise<ReadingListItem> {
    const rows = await this.db.insert(readingListItems).values(data).returning();
    return firstOrThrow(rows);
  }

  async deleteListItem(listId: string, manhwaId: string): Promise<ReadingListItem | null> {
    const rows = await this.db
      .delete(readingListItems)
      .where(and(eq(readingListItems.listId, listId), eq(readingListItems.manhwaId, manhwaId)))
      .returning();
    return firstOrNull(rows);
  }
}
