import { z } from 'zod';
import { createInsertSchema } from 'drizzle-zod';
import { genres } from './genre.schema.js';

export const createGenreSchema = createInsertSchema(genres, {
  name: z.string().min(1),
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/),
  color: z.string().optional(),
}).omit({ id: true });

export const updateGenreSchema = createGenreSchema.partial();

export const genreIdParamSchema = z.object({
  id: z.string().uuid(),
});

export type CreateGenreInput = z.infer<typeof createGenreSchema>;
export type UpdateGenreInput = z.infer<typeof updateGenreSchema>;
