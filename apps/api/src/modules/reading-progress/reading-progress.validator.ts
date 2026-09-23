import { createInsertSchema } from 'drizzle-zod';
import { z } from 'zod';
import { chapterNumberSchema } from '../../shared/lib/validation.js';
import { chapterReads, readingProgress } from './reading-progress.schema.js';

// Mise à jour manuelle : seuls les champs fournis sont modifiés.
export const updateProgressSchema = createInsertSchema(readingProgress, {
  currentChapter: chapterNumberSchema,
  rating: z.number().int().min(1).max(10),
  notes: z.string().max(5_000),
})
  .pick({ status: true, currentChapter: true, rating: true, notes: true })
  .partial();

export const logChapterReadSchema = createInsertSchema(chapterReads, {
  chapterId: z.uuid(),
  sourceId: z.uuid().nullish(),
  readingTimeSeconds: z.number().int().positive().max(86_400).nullish(),
}).pick({ chapterId: true, sourceId: true, readingTimeSeconds: true });

export const manhwaIdParamSchema = z.object({
  manhwaId: z.uuid(),
});

export type UpdateProgressInput = z.infer<typeof updateProgressSchema>;
export type LogChapterReadInput = z.infer<typeof logChapterReadSchema>;
