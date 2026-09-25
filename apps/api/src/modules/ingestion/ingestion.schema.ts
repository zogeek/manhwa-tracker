import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import {
  chapterReleases,
  ingestionBatches,
  scrapeRuns,
  sourceHealth,
  type IngestionBatchResult,
} from '../../shared/db/schema.js';

export { chapterReleases, ingestionBatches, scrapeRuns, sourceHealth };
export type { IngestionBatchResult };

export type ScrapeRun = InferSelectModel<typeof scrapeRuns>;
export type NewScrapeRun = InferInsertModel<typeof scrapeRuns>;
export type NewSourceHealth = InferInsertModel<typeof sourceHealth>;
export type IngestionBatch = InferSelectModel<typeof ingestionBatches>;
export type NewIngestionBatch = InferInsertModel<typeof ingestionBatches>;
export type NewChapterRelease = InferInsertModel<typeof chapterReleases>;

/** Auteur technique enregistré dans les colonnes d'audit (created_by / updated_by). */
export const SCRAPER_ACTOR = 'system:scraper';
