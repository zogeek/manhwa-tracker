import { z } from 'zod';
import { chapterNumberSchema } from '../../shared/lib/validation.js';
import { readingStatusEnum } from './reading.schema.js';

// Dérivé de l'enum Postgres : une seule source de vérité.
export const readingStatusSchema = z.enum(readingStatusEnum.enumValues);

export const updateProgressSchema = z.object({
  status: readingStatusSchema,
  currentChapter: chapterNumberSchema,
  rating: z.number().int().min(1).max(10),
  notes: z.string().max(5_000),
}).partial();

export const logChapterReadSchema = z.object({
  chapterId: z.uuid(),
  sourceId: z.uuid().optional(),
  readingTimeSeconds: z.number().int().positive().max(86_400).optional(),
});

export const createReadingListSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().max(1_000).optional(),
  color: z.string().max(32).optional(),
  icon: z.string().max(64).optional(),
});

export const updateReadingListSchema = createReadingListSchema.partial();

export const addListItemSchema = z.object({
  manhwaId: z.uuid(),
  sortOrder: z.number().int().nonnegative().optional(),
});

export const progressParamSchema = z.object({
  manhwaId: z.uuid(),
});

export const readingListIdParamSchema = z.object({
  id: z.uuid(),
});

export const listAndManhwaParamSchema = z.object({
  id: z.uuid(),
  manhwaId: z.uuid(),
});

export type UpdateProgressInput = z.infer<typeof updateProgressSchema>;
export type LogChapterReadInput = z.infer<typeof logChapterReadSchema>;
export type CreateReadingListInput = z.infer<typeof createReadingListSchema>;
export type UpdateReadingListInput = z.infer<typeof updateReadingListSchema>;
export type AddListItemInput = z.infer<typeof addListItemSchema>;
