import { createInsertSchema } from 'drizzle-zod';
import { z } from 'zod';
import { manhwas } from './manhwa.schema.js';

export const createManhwaSchema = createInsertSchema(manhwas, {
  title: z.string().trim().min(1, 'Le titre est requis').max(500),
  coverUrl: z.url('URL invalide').nullish(),
  totalChapters: z.number().int().nonnegative().nullish(),
  rating: z.number().min(0).max(10).nullish(),
  startDate: z.iso.date().nullish(),
  endDate: z.iso.date().nullish(),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  createdBy: true,
  updatedBy: true,
  deletedAt: true,
});

export const updateManhwaSchema = createManhwaSchema.partial();

export const manhwaIdParamSchema = z.object({
  id: z.uuid('ID invalide'),
});

export type CreateManhwaInput = z.infer<typeof createManhwaSchema>;
export type UpdateManhwaInput = z.infer<typeof updateManhwaSchema>;
