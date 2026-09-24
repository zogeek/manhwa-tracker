import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import { chapterReads, readingProgress, readingStatusEnum } from '../../shared/db/schema.js';

export { chapterReads, readingProgress, readingStatusEnum };

export type ReadingProgress = InferSelectModel<typeof readingProgress>;
export type NewReadingProgress = InferInsertModel<typeof readingProgress>;
export type ChapterRead = InferSelectModel<typeof chapterReads>;
export type NewChapterRead = InferInsertModel<typeof chapterReads>;
