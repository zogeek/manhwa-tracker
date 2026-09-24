import { and, asc, eq, isNull } from 'drizzle-orm';
import type { DbClient } from '../../shared/db/index.js';
import { firstOrNull, firstOrThrow } from '../../shared/db/utils.js';
import {
  readingListItems,
  readingLists,
  type NewReadingList,
  type NewReadingListItem,
  type ReadingList,
  type ReadingListItem,
} from './reading-list.schema.js';

export interface ReadingListRepository {
  findAllByUser(userId: string): Promise<ReadingList[]>;
  findById(id: string): Promise<ReadingList | null>;
  insert(data: NewReadingList): Promise<ReadingList>;
  update(id: string, data: Partial<NewReadingList>): Promise<ReadingList | null>;
  softDelete(id: string): Promise<ReadingList | null>;
  findItems(listId: string): Promise<ReadingListItem[]>;
  insertItem(data: NewReadingListItem): Promise<ReadingListItem>;
  deleteItem(listId: string, manhwaId: string): Promise<ReadingListItem | null>;
}

/** Implémentation Drizzle. Les listes soft-deleted sont invisibles. */
export class DrizzleReadingListRepository implements ReadingListRepository {
  constructor(private readonly db: DbClient) {}

  async findAllByUser(userId: string): Promise<ReadingList[]> {
    return this.db
      .select()
      .from(readingLists)
      .where(and(eq(readingLists.userId, userId), isNull(readingLists.deletedAt)))
      .orderBy(asc(readingLists.sortOrder), asc(readingLists.createdAt));
  }

  async findById(id: string): Promise<ReadingList | null> {
    const rows = await this.db
      .select()
      .from(readingLists)
      .where(and(eq(readingLists.id, id), isNull(readingLists.deletedAt)))
      .limit(1);
    return firstOrNull(rows);
  }

  async insert(data: NewReadingList): Promise<ReadingList> {
    const rows = await this.db.insert(readingLists).values(data).returning();
    return firstOrThrow(rows);
  }

  async update(id: string, data: Partial<NewReadingList>): Promise<ReadingList | null> {
    const rows = await this.db
      .update(readingLists)
      .set(data)
      .where(and(eq(readingLists.id, id), isNull(readingLists.deletedAt)))
      .returning();
    return firstOrNull(rows);
  }

  async softDelete(id: string): Promise<ReadingList | null> {
    const rows = await this.db
      .update(readingLists)
      .set({ deletedAt: new Date() })
      .where(and(eq(readingLists.id, id), isNull(readingLists.deletedAt)))
      .returning();
    return firstOrNull(rows);
  }

  async findItems(listId: string): Promise<ReadingListItem[]> {
    return this.db
      .select()
      .from(readingListItems)
      .where(eq(readingListItems.listId, listId))
      .orderBy(asc(readingListItems.sortOrder), asc(readingListItems.addedAt));
  }

  async insertItem(data: NewReadingListItem): Promise<ReadingListItem> {
    const rows = await this.db.insert(readingListItems).values(data).returning();
    return firstOrThrow(rows);
  }

  async deleteItem(listId: string, manhwaId: string): Promise<ReadingListItem | null> {
    const rows = await this.db
      .delete(readingListItems)
      .where(and(eq(readingListItems.listId, listId), eq(readingListItems.manhwaId, manhwaId)))
      .returning();
    return firstOrNull(rows);
  }
}
