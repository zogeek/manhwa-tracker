import { createInsertSchema } from 'drizzle-zod';
import { z } from 'zod';
import { manhwaSources } from './manhwa-source.schema.js';

/**
 * Correction manuelle de l'URL d'une œuvre sur une source.
 * `null` efface le lien : le worker cherchera de nouveau la fiche au prochain run.
 */
export const updateManhwaSourceUrlSchema = createInsertSchema(manhwaSources, {
  manhwaUrl: z.url({ protocol: /^https?$/, error: 'URL invalide' }).nullable(),
})
  .pick({ manhwaUrl: true })
  .required();

export const manhwaSourceParamSchema = z.object({
  manhwaId: z.uuid('ID invalide'),
  sourceId: z.uuid('ID invalide'),
});

export type UpdateManhwaSourceUrlInput = z.infer<typeof updateManhwaSourceUrlSchema>;
