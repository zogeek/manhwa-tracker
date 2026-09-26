import { createInsertSchema } from 'drizzle-zod';
import { z } from 'zod';
import { externalLinks } from '../../shared/db/schema.js';
import { EXTERNAL_PROVIDERS } from './external-catalog.js';

// Recherche classée par pertinence : on renvoie le « top N » (N borné côté serveur).
// Une pagination par curseur n'a pas de sens sur un score de similarité.
export const catalogSearchQuerySchema = z.object({
  q: z.string().trim().min(2, 'Au moins 2 caractères').max(100),
  limit: z.coerce.number().int().min(1).max(25).default(10),
  /** `true` : interroge aussi les catalogues externes même si la recherche locale a trouvé des résultats. */
  external: z.stringbool().default(false),
  /** Sous-ensemble des fournisseurs à interroger (`anilist,mangadex,kitsu`) ; défaut : tous ceux activés côté serveur. */
  providers: z
    .string()
    .max(100)
    .transform((value) => [...new Set(value.split(',').map((name) => name.trim()).filter(Boolean))])
    .pipe(z.array(z.enum(EXTERNAL_PROVIDERS)).min(1, 'Au moins un fournisseur'))
    .optional(),
});

// Import par référence uniquement : le contenu vient du fournisseur, jamais du client.
export const importManhwaSchema = createInsertSchema(externalLinks, {
  provider: z.enum(EXTERNAL_PROVIDERS),
  externalId: z.string().trim().regex(/^[A-Za-z0-9_-]{1,64}$/, 'Identifiant externe invalide'),
}).pick({ provider: true, externalId: true });

export type CatalogSearchQuery = z.infer<typeof catalogSearchQuerySchema>;
export type ImportManhwaInput = z.infer<typeof importManhwaSchema>;
