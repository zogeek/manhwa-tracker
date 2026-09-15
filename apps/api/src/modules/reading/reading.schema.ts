import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
export { readingProgress, chapterReads, readingLists, readingListItems } from '../../shared/db/schema.js';
import { readingProgress, chapterReads, readingLists, readingListItems } from '../../shared/db/schema.js';

export type ReadingProgress = InferSelectModel<typeof readingProgress>;
export type NewReadingProgress = InferInsertModel<typeof readingProgress>;
export type ChapterRead = InferSelectModel<typeof chapterReads>;
export type NewChapterRead = InferInsertModel<typeof chapterReads>;
export type ReadingList = InferSelectModel<typeof readingLists>;
export type NewReadingList = InferInsertModel<typeof readingLists>;
export type ReadingListItem = InferSelectModel<typeof readingListItems>;
export type NewReadingListItem = InferInsertModel<typeof readingListItems>;
