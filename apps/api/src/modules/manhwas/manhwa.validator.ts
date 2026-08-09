import { createInsertSchema } from 'drizzle-zod';
import { z } from 'zod';
import { manhwas } from './manhwa.schema.js';

export const createManhwaSchema = createInsertSchema(manhwas, {
  title: z.string().min(1, 'Le titre est requis'),
}).omit({
  id: true,
  createdAt: true,
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
