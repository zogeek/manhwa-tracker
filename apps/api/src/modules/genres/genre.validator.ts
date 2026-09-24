import { createInsertSchema } from 'drizzle-zod';
import { z } from 'zod';
import { genres } from './genre.schema.js';

export const createGenreSchema = createInsertSchema(genres, {
  name: z.string().trim().min(1).max(100),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Couleur hexadécimale attendue (#rrggbb)').nullish(),
}).omit({ id: true });

export const updateGenreSchema = createGenreSchema.partial();

export const genreIdParamSchema = z.object({
  id: z.uuid(),
});

export type CreateGenreInput = z.infer<typeof createGenreSchema>;
export type UpdateGenreInput = z.infer<typeof updateGenreSchema>;
