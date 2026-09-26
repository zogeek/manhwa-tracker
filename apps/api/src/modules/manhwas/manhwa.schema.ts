import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import { manhwas, manhwaStatusEnum, manhwaTypeEnum } from '../../shared/db/schema.js';

export { manhwas, manhwaStatusEnum, manhwaTypeEnum };

export type Manhwa = InferSelectModel<typeof manhwas>;
export type NewManhwa = InferInsertModel<typeof manhwas>;

/** Résultat de la recherche floue : la fiche + son score de pertinence (0 → 1, pg_trgm). */
export type ManhwaSearchHit = Manhwa & { score: number };
