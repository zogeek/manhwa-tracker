import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import { chapterReads, readingProgress, readingStatusEnum, sourceHealthStatusEnum } from '../../shared/db/schema.js';
import type { ManhwaView } from '../manhwas/manhwa.schema.js';

export { chapterReads, readingProgress, readingStatusEnum };

export type ReadingProgress = InferSelectModel<typeof readingProgress>;
export type NewReadingProgress = InferInsertModel<typeof readingProgress>;
export type ChapterRead = InferSelectModel<typeof chapterReads>;
export type NewChapterRead = InferInsertModel<typeof chapterReads>;

/** Entrée de la bibliothèque d'un utilisateur : sa progression + la fiche du manhwa suivi. */
export type ReadingProgressWithManhwa = ReadingProgress & { manhwa: ManhwaView };

export type SourceHealthStatus = (typeof sourceHealthStatusEnum.enumValues)[number];

/** Suivi des parutions d'une série, calculé sur ses chapitres et ses sources de scantrad actives. */
export type SeriesTracking = {
  /** Dernier chapitre connu : chapitres canoniques ou annoncé par une source (le plus élevé). */
  latestChapter: number | null;
  /** Dernier passage du scraper sur l'une des sources de la série. */
  lastScrapedAt: Date | null;
  /**
   * État de la MEILLEURE source (dernière vérification de chacune) : la série reste suivie tant
   * qu'une source répond. `null` : aucune source, ou aucune vérification encore enregistrée.
   */
  sourceStatus: SourceHealthStatus | null;
  /** Nombre de sources actives qui proposent la série. */
  sourceCount: number;
};

/** Ligne du tableau de bord : entrée de bibliothèque + suivi des parutions. */
export type TrackedSeries = ReadingProgressWithManhwa & { tracking: SeriesTracking };
