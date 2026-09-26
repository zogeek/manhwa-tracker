import { z } from 'zod';

// Pas de table Drizzle correspondante : schéma écrit à la main.
export const imageProxyQuerySchema = z.object({
  url: z.url({ protocol: /^https$/, error: 'URL https attendue' }).max(2_048),
});
