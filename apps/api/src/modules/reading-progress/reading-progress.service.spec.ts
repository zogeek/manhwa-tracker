import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { TransactionRunner } from '../../shared/db/transaction.js';
import { NotFoundError } from '../../shared/lib/errors.js';
import type { ChapterReadApplication, ReadingProgressRepository } from './reading-progress.repository.js';
import type {
  ChapterRead,
  NewChapterRead,
  ReadingProgress,
  ReadingProgressWithManhwa,
  SeriesTracking,
  TrackedSeries,
} from './reading-progress.schema.js';
import { ReadingProgressService, type LogReadRepositories } from './reading-progress.service.js';
import type { UpdateProgressInput } from './reading-progress.validator.js';

const now = new Date('2026-10-10T12:00:00Z');

const progressOf = (userId: string, manhwaId: string): ReadingProgress => ({
  id: randomUUID(),
  userId,
  manhwaId,
  status: 'reading',
  currentChapter: 12,
  furthestChapter: 12,
  rating: null,
  notes: null,
  startedAt: now,
  completedAt: null,
  updatedAt: now,
  updatedBy: userId,
});

const trackedOf = (progress: ReadingProgress, tracking: TrackedSeries['tracking']): TrackedSeries => ({
  ...progress,
  manhwa: {
    id: progress.manhwaId,
    title: 'Solo Leveling',
    originalTitle: null,
    synopsis: null,
    coverUrl: null,
    type: 'manhwa',
    status: 'ongoing',
    country: 'KR',
    totalChapters: null,
    rating: null,
    startDate: null,
    endDate: null,
    createdAt: now,
    updatedAt: now,
    createdBy: null,
    updatedBy: null,
    deletedAt: null,
    authors: [],
    localCoverUrl: null,
  },
  tracking,
});

/** Repository en mémoire : seules les lectures utiles au service sont implémentées. */
class InMemoryReadingProgressRepository implements ReadingProgressRepository {
  readonly tracked: TrackedSeries[] = [];

  async findByUserAndManhwa(userId: string, manhwaId: string): Promise<ReadingProgress | null> {
    return this.tracked.find((entry) => entry.userId === userId && entry.manhwaId === manhwaId) ?? null;
  }

  async findAllByUser(userId: string): Promise<ReadingProgressWithManhwa[]> {
    return this.tracked.filter((entry) => entry.userId === userId);
  }

  async findTrackedByUser(userId: string): Promise<TrackedSeries[]> {
    return this.tracked.filter((entry) => entry.userId === userId);
  }

  async delete(userId: string, manhwaId: string): Promise<ReadingProgress | null> {
    const index = this.tracked.findIndex((entry) => entry.userId === userId && entry.manhwaId === manhwaId);
    return index === -1 ? null : (this.tracked.splice(index, 1)[0] ?? null);
  }

  async upsert(userId: string, manhwaId: string, _patch: UpdateProgressInput): Promise<ReadingProgress> {
    return progressOf(userId, manhwaId);
  }

  async applyChapterRead({ userId, manhwaId }: ChapterReadApplication): Promise<ReadingProgress> {
    return progressOf(userId, manhwaId);
  }

  async insertRead(data: NewChapterRead): Promise<ChapterRead> {
    return {
      id: randomUUID(),
      userId: data.userId,
      chapterId: data.chapterId,
      sourceId: data.sourceId ?? null,
      readAt: now,
      readingTimeSeconds: data.readingTimeSeconds ?? null,
    };
  }

  async findReadsByUser(): Promise<ChapterRead[]> {
    return [];
  }

  async findReadsByUserAndManhwa(): Promise<ChapterRead[]> {
    return [];
  }
}

let repo: InMemoryReadingProgressRepository;
let service: ReadingProgressService;

beforeEach(() => {
  repo = new InMemoryReadingProgressRepository();
  const transactions: TransactionRunner<LogReadRepositories> = {
    run: (work) => {
      const repositories: LogReadRepositories = { progress: repo, chapters: { findById: async () => null } };
      return work(repositories, (inner) => inner(repositories));
    },
  };
  service = new ReadingProgressService(repo, transactions);
});

describe('ReadingProgressService.getDashboard', () => {
  it("returns only the user's tracked series, with their release tracking", async () => {
    const tracking: SeriesTracking = { latestChapter: 180, lastScrapedAt: now, sourceStatus: 'up', sourceCount: 2 };
    repo.tracked.push(
      trackedOf(progressOf('reader', randomUUID()), tracking),
      trackedOf(progressOf('someone-else', randomUUID()), tracking),
    );

    const dashboard = await service.getDashboard('reader');

    expect(dashboard).toHaveLength(1);
    expect(dashboard[0]).toMatchObject({ userId: 'reader', tracking });
  });

  it('returns an empty dashboard for a new user', async () => {
    expect(await service.getDashboard('newcomer')).toEqual([]);
  });
});

describe('ReadingProgressService — not found cases', () => {
  it('refuses to remove a series that is not in the library', async () => {
    await expect(service.removeProgress('reader', randomUUID())).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses to log a read for an unknown chapter', async () => {
    await expect(service.logRead('reader', { chapterId: randomUUID() })).rejects.toBeInstanceOf(NotFoundError);
  });
});
