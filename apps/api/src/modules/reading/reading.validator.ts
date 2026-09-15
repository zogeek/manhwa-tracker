import { z } from 'zod';

export const readingStatusSchema = z.enum(['reading', 'completed', 'on_hold', 'dropped', 'plan_to_read']);

export const updateProgressSchema = z.object({
  status: readingStatusSchema,
  currentChapter: z.number().int().min(0),
  rating: z.number().int().min(1).max(10).optional(),
  notes: z.string().optional(),
}).partial();

export const logChapterReadSchema = z.object({
  chapterId: z.string().uuid(),
  sourceId: z.string().uuid().optional(),
  readingTimeSeconds: z.number().int().positive().optional(),
});

export const createReadingListSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  color: z.string().optional(),
  icon: z.string().optional(),
});

export const updateReadingListSchema = createReadingListSchema.partial();

export const addListItemSchema = z.object({
  manhwaId: z.string().uuid(),
  sortOrder: z.number().int().optional(),
});

export const progressParamSchema = z.object({
  manhwaId: z.string().uuid(),
});

export const readingListIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const listAndManhwaParamSchema = z.object({
  id: z.string().uuid(),
  manhwaId: z.string().uuid(),
});

export type UpdateProgressInput = z.infer<typeof updateProgressSchema>;
export type LogChapterReadInput = z.infer<typeof logChapterReadSchema>;
export type CreateReadingListInput = z.infer<typeof createReadingListSchema>;
export type UpdateReadingListInput = z.infer<typeof updateReadingListSchema>;
export type AddListItemInput = z.infer<typeof addListItemSchema>;
