import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import { chapterReads, readingProgress, readingStatusEnum } from '../../shared/db/schema.js';
import type { Manhwa } from '../manhwas/manhwa.schema.js';

export { chapterReads, readingProgress, readingStatusEnum };

export type ReadingProgress = InferSelectModel<typeof readingProgress>;
export type NewReadingProgress = InferInsertModel<typeof readingProgress>;
export type ChapterRead = InferSelectModel<typeof chapterReads>;
export type NewChapterRead = InferInsertModel<typeof chapterReads>;

/** Entrée de la bibliothèque d'un utilisateur : sa progression + la fiche du manhwa suivi. */
export type ReadingProgressWithManhwa = ReadingProgress & { manhwa: Manhwa };
