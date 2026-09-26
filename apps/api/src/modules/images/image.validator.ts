import { z } from 'zod';
import { MEDIA_KEY_PATTERN } from '../../shared/storage/media-storage.js';

// Pas de table Drizzle correspondante : schémas écrits à la main.
export const imageProxyQuerySchema = z.object({
  url: z.url({ protocol: /^https$/, error: 'URL https attendue' }).max(2_048),
});

export const mediaKeyParamSchema = z.object({
  key: z.string().regex(MEDIA_KEY_PATTERN, 'Clé de média invalide'),
});
