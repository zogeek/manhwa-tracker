import { createInsertSchema } from 'drizzle-zod';
import { z } from 'zod';
import { sources } from './source.schema.js';

export const createSourceSchema = createInsertSchema(sources, {
  name: z.string().min(1, 'Le nom est requis'),
  baseUrl: z.url('URL invalide'),
}).omit({
  id: true,
  createdAt: true,
  createdBy: true,
  updatedBy: true,
  deletedAt: true,
});

export const updateSourceSchema = createSourceSchema.partial();

export const sourceIdParamSchema = z.object({
  id: z.uuid('ID invalide'),
});

export type CreateSourceInput = z.infer<typeof createSourceSchema>;
export type UpdateSourceInput = z.infer<typeof updateSourceSchema>;
