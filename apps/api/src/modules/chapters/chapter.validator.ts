import { z } from 'zod';
import { createInsertSchema } from 'drizzle-zod';
import { chapters } from './chapter.schema.js';

export const createChapterSchema = createInsertSchema(chapters)
  .omit({
    id: true,
    createdAt: true,
    createdBy: true,
    deletedAt: true,
  })
  .extend({
    manhwaId: z.string().uuid(),
    number: z.number().int().positive(),
  });

export const updateChapterSchema = createChapterSchema.partial();

export const chapterIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const manhwaIdParamSchema = z.object({
  manhwaId: z.string().uuid(),
});

export type CreateChapterInput = z.infer<typeof createChapterSchema>;
export type UpdateChapterInput = z.infer<typeof updateChapterSchema>;
