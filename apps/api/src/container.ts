import type { Database } from './shared/db/index.js';
import { createAuth, type AuthOptions } from './shared/auth/index.js';
import { createTransactionRunner } from './shared/db/transaction.js';
import { DrizzleChapterRepository } from './modules/chapters/chapter.repository.js';
import { ChapterService } from './modules/chapters/chapter.service.js';
import { DrizzleManhwaRepository } from './modules/manhwas/manhwa.repository.js';
import { ManhwaService } from './modules/manhwas/manhwa.service.js';
import { DrizzleReadingListRepository } from './modules/reading-lists/reading-list.repository.js';
import { ReadingListService } from './modules/reading-lists/reading-list.service.js';
import { DrizzleReadingProgressRepository } from './modules/reading-progress/reading-progress.repository.js';
import { ReadingProgressService } from './modules/reading-progress/reading-progress.service.js';
import { DrizzleSourceRepository } from './modules/sources/source.repository.js';
import { SourceService } from './modules/sources/source.service.js';
import { DrizzleTaxonomyRepository } from './modules/taxonomy/taxonomy.repository.js';
import { TaxonomyService } from './modules/taxonomy/taxonomy.service.js';

export type ContainerOptions = {
  db: Database;
  auth: Omit<AuthOptions, 'db'>;
};

/**
 * Composition root : le seul endroit où les implémentations concrètes sont instanciées et câblées.
 * Les tests peuvent construire les services directement avec des repositories factices.
 */
export function createContainer({ db, auth }: ContainerOptions) {
  const logReadTransactions = createTransactionRunner(db, (client) => ({
    progress: new DrizzleReadingProgressRepository(client),
    chapters: new DrizzleChapterRepository(client),
  }));

  return {
    auth: createAuth({ ...auth, db }),
    services: {
      sources: new SourceService(new DrizzleSourceRepository(db)),
      manhwas: new ManhwaService(new DrizzleManhwaRepository(db)),
      chapters: new ChapterService(new DrizzleChapterRepository(db)),
      taxonomy: new TaxonomyService(new DrizzleTaxonomyRepository(db)),
      readingProgress: new ReadingProgressService(new DrizzleReadingProgressRepository(db), logReadTransactions),
      readingLists: new ReadingListService(new DrizzleReadingListRepository(db)),
    },
  };
}

export type Container = ReturnType<typeof createContainer>;
export type Services = Container['services'];
