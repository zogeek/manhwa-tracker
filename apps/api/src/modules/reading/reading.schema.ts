import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import {
  readingProgress,
  chapterReads,
  readingLists,
  readingListItems,
  readingStatusEnum,
} from '../../shared/db/schema.js';

export { readingProgress, chapterReads, readingLists, readingListItems, readingStatusEnum };

export type ReadingProgress = InferSelectModel<typeof readingProgress>;
export type NewReadingProgress = InferInsertModel<typeof readingProgress>;
export type ChapterRead = InferSelectModel<typeof chapterReads>;
export type NewChapterRead = InferInsertModel<typeof chapterReads>;
export type ReadingList = InferSelectModel<typeof readingLists>;
export type NewReadingList = InferInsertModel<typeof readingLists>;
export type ReadingListItem = InferSelectModel<typeof readingListItems>;
export type NewReadingListItem = InferInsertModel<typeof readingListItems>;
