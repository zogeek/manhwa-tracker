import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import { manhwaSources } from '../../shared/db/schema.js';

export { manhwaSources };

export type ManhwaSource = InferSelectModel<typeof manhwaSources>;
export type NewManhwaSource = InferInsertModel<typeof manhwaSources>;

/** Lien œuvre ↔ source + l'URL de base de la source (pour vérifier qu'une correction reste sur son site). */
export type ManhwaSourceLink = ManhwaSource & { sourceBaseUrl: string };
