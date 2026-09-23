import type { Database } from './shared/db/index.js';
import { DrizzleChapterRepository } from './modules/chapters/chapter.repository.js';
import { ChapterService } from './modules/chapters/chapter.service.js';
import { DrizzleGenreRepository } from './modules/genres/genre.repository.js';
import { GenreService } from './modules/genres/genre.service.js';
import { DrizzleManhwaRepository } from './modules/manhwas/manhwa.repository.js';
import { ManhwaService } from './modules/manhwas/manhwa.service.js';
import { DrizzleReadingRepository } from './modules/reading/reading.repository.js';
import { ReadingService } from './modules/reading/reading.service.js';
import { DrizzleSourceRepository } from './modules/sources/source.repository.js';
import { SourceService } from './modules/sources/source.service.js';

/**
 * Composition root : le seul endroit où les implémentations concrètes sont instanciées et câblées.
 * Les tests peuvent construire les services directement avec des repositories factices.
 */
export function createContainer(db: Database) {
  return {
    services: {
      sources: new SourceService(new DrizzleSourceRepository(db)),
      manhwas: new ManhwaService(new DrizzleManhwaRepository(db)),
      chapters: new ChapterService(new DrizzleChapterRepository(db)),
      genres: new GenreService(new DrizzleGenreRepository(db)),
      reading: new ReadingService(new DrizzleReadingRepository(db)),
    },
  };
}

export type Container = ReturnType<typeof createContainer>;
export type Services = Container['services'];
