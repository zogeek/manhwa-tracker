import { and, count, desc, eq, getTableColumns, inArray, isNull, max, sql } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import type { DbClient } from '../../shared/db/index.js';
import { chapters, manhwas, manhwaSources, sourceHealth, sources } from '../../shared/db/schema.js';
import { firstOrNull, firstOrThrow } from '../../shared/db/utils.js';
import { loadManhwaExtras } from '../manhwas/manhwa-extras.js';
import {
  chapterReads,
  readingProgress,
  type ChapterRead,
  type NewChapterRead,
  type ReadingProgress,
  type ReadingProgressWithManhwa,
  type SeriesTracking,
  type SourceHealthStatus,
  type TrackedSeries,
} from './reading-progress.schema.js';
import type { UpdateProgressInput } from './reading-progress.validator.js';

export type ChapterReadApplication = {
  userId: string;
  manhwaId: string;
  chapterNumber: number;
  readAt: Date;
};

export interface ReadingProgressRepository {
  findByUserAndManhwa(userId: string, manhwaId: string): Promise<ReadingProgress | null>;
  /** Bibliothèque de l'utilisateur, manhwas soft-deleted exclus. */
  findAllByUser(userId: string): Promise<ReadingProgressWithManhwa[]>;
  /** Bibliothèque + suivi des parutions (dernier chapitre, scraping, santé des sources). */
  findTrackedByUser(userId: string): Promise<TrackedSeries[]>;
  delete(userId: string, manhwaId: string): Promise<ReadingProgress | null>;
  /** Upsert atomique (un seul statement) : aucune fenêtre lecture → écriture. */
  upsert(userId: string, manhwaId: string, patch: UpdateProgressInput): Promise<ReadingProgress>;
  /** Répercute une lecture de chapitre sur la progression (upsert atomique). */
  applyChapterRead(read: ChapterReadApplication): Promise<ReadingProgress>;
  insertRead(data: NewChapterRead): Promise<ChapterRead>;
  findReadsByUser(userId: string): Promise<ChapterRead[]>;
  findReadsByUserAndManhwa(userId: string, manhwaId: string): Promise<ChapterRead[]>;
}

const NO_TRACKING: SeriesTracking = { latestChapter: null, lastScrapedAt: null, sourceStatus: null, sourceCount: 0 };

/** Plus grand de deux numéros de chapitre éventuellement inconnus. */
const highestChapter = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : Math.max(a, b));

export class DrizzleReadingProgressRepository implements ReadingProgressRepository {
  constructor(private readonly db: DbClient) {}

  async findByUserAndManhwa(userId: string, manhwaId: string): Promise<ReadingProgress | null> {
    const rows = await this.db
      .select()
      .from(readingProgress)
      .where(and(eq(readingProgress.userId, userId), eq(readingProgress.manhwaId, manhwaId)))
      .limit(1);
    return firstOrNull(rows);
  }

  async findAllByUser(userId: string): Promise<ReadingProgressWithManhwa[]> {
    const rows = await this.db
      .select({ progress: readingProgress, manhwa: manhwas })
      .from(readingProgress)
      .innerJoin(manhwas, and(eq(readingProgress.manhwaId, manhwas.id), isNull(manhwas.deletedAt)))
      .where(eq(readingProgress.userId, userId))
      .orderBy(desc(readingProgress.updatedAt));
    // Auteurs et couvertures locales de toute la bibliothèque en deux requêtes groupées (pas de N+1).
    const extras = await loadManhwaExtras(
      this.db,
      rows.map(({ manhwa }) => manhwa.id),
    );
    return rows.map(({ progress, manhwa }) => ({
      ...progress,
      manhwa: { ...manhwa, ...(extras.get(manhwa.id) ?? { authors: [], localCoverUrl: null }) },
    }));
  }

  async findTrackedByUser(userId: string): Promise<TrackedSeries[]> {
    const library = await this.findAllByUser(userId);
    const tracking = await this.loadTracking(library.map((entry) => entry.manhwaId));
    return library.map((entry) => ({ ...entry, tracking: tracking.get(entry.manhwaId) ?? NO_TRACKING }));
  }

  /**
   * Suivi des parutions d'une liste de séries en deux requêtes groupées (pas de N+1) :
   * le dernier chapitre canonique, puis l'agrégat de leurs sources actives.
   */
  private async loadTracking(manhwaIds: readonly string[]): Promise<Map<string, SeriesTracking>> {
    if (manhwaIds.length === 0) return new Map();
    const ids = [...new Set(manhwaIds)];

    // Dernière vérification de chaque source concernée (servie par l'index source_id, checked_at).
    const latestHealth = this.db
      .selectDistinctOn([sourceHealth.sourceId], { sourceId: sourceHealth.sourceId, status: sourceHealth.status })
      .from(sourceHealth)
      .where(
        inArray(
          sourceHealth.sourceId,
          this.db.select({ sourceId: manhwaSources.sourceId }).from(manhwaSources).where(inArray(manhwaSources.manhwaId, ids)),
        ),
      )
      .orderBy(sourceHealth.sourceId, desc(sourceHealth.checkedAt))
      .as('latest_health');

    const [chapterRows, sourceRows] = await Promise.all([
      this.db
        .select({ manhwaId: chapters.manhwaId, latestChapter: max(chapters.number) })
        .from(chapters)
        .where(and(inArray(chapters.manhwaId, ids), isNull(chapters.deletedAt)))
        .groupBy(chapters.manhwaId),
      this.db
        .select({
          manhwaId: manhwaSources.manhwaId,
          latestChapter: max(manhwaSources.latestChapter),
          lastScrapedAt: max(manhwaSources.lastScrapedAt),
          // L'enum Postgres est ordonné (up < degraded < blocked < down) : MIN = la meilleure source.
          sourceStatus: sql<SourceHealthStatus | null>`min(${latestHealth.status})`,
          sourceCount: count(),
        })
        .from(manhwaSources)
        .innerJoin(sources, and(eq(sources.id, manhwaSources.sourceId), isNull(sources.deletedAt)))
        .leftJoin(latestHealth, eq(latestHealth.sourceId, manhwaSources.sourceId))
        .where(inArray(manhwaSources.manhwaId, ids))
        .groupBy(manhwaSources.manhwaId),
    ]);

    const tracking = new Map<string, SeriesTracking>();
    for (const { manhwaId, latestChapter } of chapterRows) {
      tracking.set(manhwaId, { ...NO_TRACKING, latestChapter });
    }
    for (const { manhwaId, latestChapter, ...sourceTracking } of sourceRows) {
      const canonical = tracking.get(manhwaId)?.latestChapter ?? null;
      tracking.set(manhwaId, { ...sourceTracking, latestChapter: highestChapter(canonical, latestChapter) });
    }
    return tracking;
  }

  async delete(userId: string, manhwaId: string): Promise<ReadingProgress | null> {
    const rows = await this.db
      .delete(readingProgress)
      .where(and(eq(readingProgress.userId, userId), eq(readingProgress.manhwaId, manhwaId)))
      .returning();
    return firstOrNull(rows);
  }

  async upsert(userId: string, manhwaId: string, patch: UpdateProgressInput): Promise<ReadingProgress> {
    const { status, currentChapter, rating, notes } = patch;
    const now = new Date();
    // Saisir une progression (mise à jour absolue, ex. « j'en suis au 120 ») sur une série « à lire »
    // la fait passer « en cours », comme une lecture. Un statut fourni explicitement reste prioritaire.
    const startsReading = status === undefined && currentChapter !== undefined && currentChapter > 0;

    // Seuls les champs fournis écrasent l'existant ; `furthestChapter` ne peut jamais reculer.
    const set: PgUpdateSetSource<typeof readingProgress> = {
      updatedAt: now,
      updatedBy: userId,
      ...(status !== undefined ? { status } : {}),
      ...(startsReading
        ? {
            status: sql`CASE WHEN ${readingProgress.status} = 'plan_to_read' THEN 'reading'::reading_status ELSE ${readingProgress.status} END`,
          }
        : {}),
      // Date de début de lecture : posée une seule fois, dès qu'une lecture commence réellement.
      ...(startsReading || status === 'reading'
        ? { startedAt: sql`COALESCE(${readingProgress.startedAt}, ${now})` }
        : {}),
      ...(currentChapter !== undefined
        ? {
            currentChapter,
            furthestChapter: sql`GREATEST(${readingProgress.furthestChapter}, ${currentChapter})`,
          }
        : {}),
      ...(rating !== undefined ? { rating } : {}),
      ...(notes !== undefined ? { notes } : {}),
    };

    const rows = await this.db
      .insert(readingProgress)
      .values({
        userId,
        manhwaId,
        status: startsReading ? 'reading' : status,
        currentChapter: currentChapter ?? 0,
        furthestChapter: currentChapter ?? 0,
        startedAt: startsReading || status === 'reading' ? now : null,
        rating,
        notes,
        updatedBy: userId,
      })
      .onConflictDoUpdate({ target: [readingProgress.userId, readingProgress.manhwaId], set })
      .returning();
    return firstOrThrow(rows);
  }

  async applyChapterRead({ userId, manhwaId, chapterNumber, readAt }: ChapterReadApplication): Promise<ReadingProgress> {
    const rows = await this.db
      .insert(readingProgress)
      .values({
        userId,
        manhwaId,
        status: 'reading',
        currentChapter: chapterNumber,
        furthestChapter: chapterNumber,
        startedAt: readAt,
        updatedBy: userId,
      })
      .onConflictDoUpdate({
        target: [readingProgress.userId, readingProgress.manhwaId],
        set: {
          currentChapter: chapterNumber,
          furthestChapter: sql`GREATEST(${readingProgress.furthestChapter}, ${chapterNumber})`,
          // Commencer à lire une série « à lire » la fait passer « en cours » ; les autres statuts sont conservés.
          status: sql`CASE WHEN ${readingProgress.status} = 'plan_to_read' THEN 'reading'::reading_status ELSE ${readingProgress.status} END`,
          startedAt: sql`COALESCE(${readingProgress.startedAt}, ${readAt})`,
          updatedAt: new Date(),
          updatedBy: userId,
        },
      })
      .returning();
    return firstOrThrow(rows);
  }

  async insertRead(data: NewChapterRead): Promise<ChapterRead> {
    const rows = await this.db.insert(chapterReads).values(data).returning();
    return firstOrThrow(rows);
  }

  async findReadsByUser(userId: string): Promise<ChapterRead[]> {
    return this.db
      .select()
      .from(chapterReads)
      .where(eq(chapterReads.userId, userId))
      .orderBy(desc(chapterReads.readAt));
  }

  async findReadsByUserAndManhwa(userId: string, manhwaId: string): Promise<ChapterRead[]> {
    return this.db
      .select(getTableColumns(chapterReads))
      .from(chapterReads)
      .innerJoin(chapters, eq(chapterReads.chapterId, chapters.id))
      .where(and(eq(chapterReads.userId, userId), eq(chapters.manhwaId, manhwaId)))
      .orderBy(desc(chapterReads.readAt));
  }
}
