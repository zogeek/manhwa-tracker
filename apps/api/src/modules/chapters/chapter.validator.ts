import { createInsertSchema } from 'drizzle-zod';
import { z } from 'zod';
import { chapterNumberSchema } from '../../shared/lib/validation.js';
import { chapters } from './chapter.schema.js';

export const createChapterSchema = createInsertSchema(chapters, {
  manhwaId: z.uuid(),
  number: chapterNumberSchema,
  title: z.string().trim().max(500).nullish(),
  releaseDate: z.iso.date().nullish(),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  createdBy: true,
  updatedBy: true,
  deletedAt: true,
});

// Un chapitre ne change pas de manhwa.
export const updateChapterSchema = createChapterSchema.omit({ manhwaId: true }).partial();

export const chapterIdParamSchema = z.object({
  id: z.uuid(),
});

export const manhwaIdParamSchema = z.object({
  manhwaId: z.uuid(),
});

export type CreateChapterInput = z.infer<typeof createChapterSchema>;
export type UpdateChapterInput = z.infer<typeof updateChapterSchema>;
