import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';
import {
  chapterKindEnum,
  chapterReleases,
  manhwaSources,
  manhwas,
  scrapeRuns,
  sourceHealth,
} from '../../shared/db/schema.js';
import { chapterNumberSchema } from '../../shared/lib/validation.js';

// Les `.meta({ id })` nomment les définitions du contrat exporté en JSON Schema (`ingestion.contract.ts`) :
// le worker Python en génère ses modèles Pydantic, avec des types nommés (ex. `ManhwaStatus`).

// Dates ISO 8601 (avec fuseau) envoyées par le worker Python → Date.
const isoDateTime = z.iso.datetime({ offset: true }).transform((value) => new Date(value));

// ---- Exécutions (scrape_runs) ----

export const startRunSchema = createInsertSchema(scrapeRuns, {
  sourceId: z.uuid(),
  workerVersion: z.string().max(50).nullish(),
})
  .pick({ sourceId: true, workerVersion: true })
  .meta({ id: 'StartRun' });

export const finishRunSchema = createInsertSchema(scrapeRuns, {
  // Une exécution se termine : `running` n'est plus une valeur acceptée.
  status: z.enum(['succeeded', 'partial', 'failed']).meta({ id: 'RunOutcome' }),
  stats: z.record(z.string(), z.number().int().nonnegative()).nullish(),
  error: z.string().max(10_000).nullish(),
})
  .pick({ status: true, stats: true, error: true })
  .meta({ id: 'FinishRun' });

// ---- Santé des sources (source_health) ----

const healthSampleSchema = createInsertSchema(sourceHealth, {
  sourceId: z.uuid(),
  scrapeRunId: z.uuid().nullish(),
  status: (schema) => schema.meta({ id: 'HealthStatus' }),
  httpStatus: z.number().int().min(100).max(599).nullish(),
  latencyMs: z.number().int().nonnegative().max(600_000).nullish(),
  blockedBy: z.string().max(50).nullish(),
  checkedAt: isoDateTime.optional(),
}).pick({
  sourceId: true,
  scrapeRunId: true,
  status: true,
  httpStatus: true,
  latencyMs: true,
  blockedBy: true,
  checkedAt: true,
}).meta({ id: 'HealthSample' });

export const recordHealthSchema = z
  .object({
    samples: z.array(healthSampleSchema).min(1).max(500),
  })
  .meta({ id: 'RecordHealth' });

// ---- Lots d'ingestion ----

const chapterItemSchema = createInsertSchema(chapterReleases, {
  url: z.url(),
  language: z.string().min(2).max(10),
  // Un callback remplace le schéma de la colonne : on rétablit l'optionnalité due au `.default()` SQL.
  quality: (schema) => schema.meta({ id: 'ChapterQuality' }).optional(),
  publishedAt: isoDateTime.nullish(),
})
  .pick({ url: true, language: true, quality: true, publishedAt: true })
  .extend({
    number: chapterNumberSchema,
    title: z.string().trim().max(500).nullish(),
    kind: z.enum(chapterKindEnum.enumValues).meta({ id: 'ChapterKind' }).optional(),
    /** Team unique (forme historique du contrat, toujours acceptée). */
    scanlationGroup: z.string().trim().min(1).max(100).nullish(),
    /** Teams créditées, dans l'ordre (collaboration) ; combinées avec `scanlationGroup` si les deux sont fournis. */
    scanlationGroups: z.array(z.string().trim().min(1).max(100)).max(5).optional(),
  })
  .meta({ id: 'IngestChapter' });

const manhwaItemSchema = createInsertSchema(manhwas, {
  title: z.string().trim().min(1).max(500),
  originalTitle: z.string().trim().max(500).nullish(),
  synopsis: z.string().max(10_000).nullish(),
  coverUrl: z.url().nullish(),
  totalChapters: z.number().int().nonnegative().nullish(),
  type: (schema) => schema.meta({ id: 'ManhwaType' }).optional(),
  status: (schema) => schema.meta({ id: 'ManhwaStatus' }).optional(),
})
  .pick({ title: true, originalTitle: true, synopsis: true, coverUrl: true, type: true, status: true, totalChapters: true })
  .extend({
    /** Identité de l'œuvre sur la source : clé de rapprochement avec le catalogue. */
    sourceManhwaUrl: z.url(),
    /** Rattachement explicite à une fiche existante (sinon : rapprochement par URL, ou création). */
    manhwaId: z.uuid().optional(),
    chapters: z.array(chapterItemSchema).max(2_000).default([]),
  })
  .meta({ id: 'IngestManhwa' });

export const ingestBatchSchema = z
  .object({
    sourceId: z.uuid(),
    scrapeRunId: z.uuid().optional(),
    manhwas: z.array(manhwaItemSchema).min(1).max(100),
  })
  .meta({ id: 'IngestBatch' });

// ---- Séries suivies (GET /tracked) ----

export const TRACKED_SERIES_MAX_LIMIT = 500;

export const trackedSeriesQuerySchema = z
  .object({
    sourceId: z.uuid(),
    /** `nextCursor` de la page précédente ; absent pour la première page. */
    cursor: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(TRACKED_SERIES_MAX_LIMIT).default(100),
  })
  .meta({ id: 'TrackedSeriesQuery' });

/** Œuvre de la source présente dans au moins une liste de lecture : à re-scraper en priorité. */
const trackedSeriesSchema = createSelectSchema(manhwaSources, {
  /** URL de la fiche sur la source ; `null` si elle n'a pas encore été découverte. */
  manhwaUrl: z.url().nullable(),
  latestChapter: chapterNumberSchema.nullable(),
  lastScrapedAt: z.iso.datetime({ offset: true }).nullable(),
})
  .pick({ manhwaId: true, manhwaUrl: true, latestChapter: true, lastScrapedAt: true })
  .extend(createSelectSchema(manhwas).pick({ title: true }).shape)
  .meta({ id: 'TrackedSeries' });

export const trackedSeriesPageSchema = z
  .object({
    data: z.array(trackedSeriesSchema),
    /** À renvoyer en `?cursor=` pour la page suivante ; `null` sur la dernière page. */
    nextCursor: z.uuid().nullable(),
  })
  .meta({ id: 'TrackedSeriesPage' });

export const idempotencyHeaderSchema = z.object({
  'idempotency-key': z.string().min(8).max(200),
});

export const runIdParamSchema = z.object({ id: z.uuid() });

export type StartRunInput = z.infer<typeof startRunSchema>;
export type FinishRunInput = z.infer<typeof finishRunSchema>;
export type RecordHealthInput = z.infer<typeof recordHealthSchema>;
export type IngestBatchInput = z.infer<typeof ingestBatchSchema>;
export type TrackedSeriesQuery = z.infer<typeof trackedSeriesQuerySchema>;
export type IngestManhwaItem = IngestBatchInput['manhwas'][number];
export type IngestChapterItem = IngestManhwaItem['chapters'][number];
