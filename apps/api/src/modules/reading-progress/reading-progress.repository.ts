import { and, desc, eq, getTableColumns, isNull, sql } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import type { DbClient } from '../../shared/db/index.js';
import { chapters, manhwas } from '../../shared/db/schema.js';
import { firstOrNull, firstOrThrow } from '../../shared/db/utils.js';
import {
  chapterReads,
  readingProgress,
  type ChapterRead,
  type NewChapterRead,
  type ReadingProgress,
  type ReadingProgressWithManhwa,
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
  delete(userId: string, manhwaId: string): Promise<ReadingProgress | null>;
  /** Upsert atomique (un seul statement) : aucune fenêtre lecture → écriture. */
  upsert(userId: string, manhwaId: string, patch: UpdateProgressInput): Promise<ReadingProgress>;
  /** Répercute une lecture de chapitre sur la progression (upsert atomique). */
  applyChapterRead(read: ChapterReadApplication): Promise<ReadingProgress>;
  insertRead(data: NewChapterRead): Promise<ChapterRead>;
  findReadsByUser(userId: string): Promise<ChapterRead[]>;
  findReadsByUserAndManhwa(userId: string, manhwaId: string): Promise<ChapterRead[]>;
}

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
    return rows.map(({ progress, manhwa }) => ({ ...progress, manhwa }));
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

    // Seuls les champs fournis écrasent l'existant ; `furthestChapter` ne peut jamais reculer.
    const set: PgUpdateSetSource<typeof readingProgress> = {
      updatedAt: new Date(),
      updatedBy: userId,
      ...(status !== undefined ? { status } : {}),
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
        status,
        currentChapter: currentChapter ?? 0,
        furthestChapter: currentChapter ?? 0,
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
