import type { TransactionRunner } from '../../shared/db/transaction.js';
import { NotFoundError } from '../../shared/lib/errors.js';
import type { ChapterRepository } from '../chapters/chapter.repository.js';
import type { ReadingProgressRepository } from './reading-progress.repository.js';
import type { ChapterRead, ReadingProgress, ReadingProgressWithManhwa } from './reading-progress.schema.js';
import type { LogChapterReadInput, UpdateProgressInput } from './reading-progress.validator.js';

/** Repositories liés à une même transaction pour l'enregistrement d'une lecture. */
export type LogReadRepositories = {
  progress: ReadingProgressRepository;
  chapters: Pick<ChapterRepository, 'findById'>;
};

export type LoggedRead = {
  read: ChapterRead;
  progress: ReadingProgress;
};

export class ReadingProgressService {
  constructor(
    private readonly repo: ReadingProgressRepository,
    private readonly transactions: TransactionRunner<LogReadRepositories>,
  ) {}

  async getProgress(userId: string, manhwaId: string): Promise<ReadingProgress | null> {
    return this.repo.findByUserAndManhwa(userId, manhwaId);
  }

  async getAllProgress(userId: string): Promise<ReadingProgressWithManhwa[]> {
    return this.repo.findAllByUser(userId);
  }

  /** Retire une série de la bibliothèque (l'historique des lectures est conservé). */
  async removeProgress(userId: string, manhwaId: string): Promise<void> {
    const removed = await this.repo.delete(userId, manhwaId);
    if (!removed) throw new NotFoundError('ReadingProgress', manhwaId);
  }

  async updateProgress(userId: string, manhwaId: string, data: UpdateProgressInput): Promise<ReadingProgress> {
    return this.repo.upsert(userId, manhwaId, data);
  }

  /**
   * Transaction atomique : l'entrée du journal de lecture et la mise à jour de la progression
   * sont commitées ensemble, ou pas du tout.
   */
  async logRead(userId: string, data: LogChapterReadInput): Promise<LoggedRead> {
    return this.transactions.run(async ({ progress, chapters }) => {
      const chapter = await chapters.findById(data.chapterId);
      if (!chapter) throw new NotFoundError('Chapter', data.chapterId);

      const read = await progress.insertRead({
        userId,
        chapterId: chapter.id,
        sourceId: data.sourceId ?? null,
        readingTimeSeconds: data.readingTimeSeconds ?? null,
      });

      const updatedProgress = await progress.applyChapterRead({
        userId,
        manhwaId: chapter.manhwaId,
        chapterNumber: chapter.number,
        readAt: read.readAt,
      });

      return { read, progress: updatedProgress };
    });
  }

  async getReadHistory(userId: string, manhwaId?: string): Promise<ChapterRead[]> {
    if (manhwaId) {
      return this.repo.findReadsByUserAndManhwa(userId, manhwaId);
    }
    return this.repo.findReadsByUser(userId);
  }
}
