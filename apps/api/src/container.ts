import type { Database } from './shared/db/index.js';
import { ChapterController } from './modules/chapters/chapter.controller.js';
import { DrizzleChapterRepository } from './modules/chapters/chapter.repository.js';
import { ChapterService } from './modules/chapters/chapter.service.js';
import { GenreController } from './modules/genres/genre.controller.js';
import { DrizzleGenreRepository } from './modules/genres/genre.repository.js';
import { GenreService } from './modules/genres/genre.service.js';
import { ManhwaController } from './modules/manhwas/manhwa.controller.js';
import { DrizzleManhwaRepository } from './modules/manhwas/manhwa.repository.js';
import { ManhwaService } from './modules/manhwas/manhwa.service.js';
import { ReadingController } from './modules/reading/reading.controller.js';
import { DrizzleReadingRepository } from './modules/reading/reading.repository.js';
import { ReadingService } from './modules/reading/reading.service.js';
import { SourceController } from './modules/sources/source.controller.js';
import { DrizzleSourceRepository } from './modules/sources/source.repository.js';
import { SourceService } from './modules/sources/source.service.js';

/**
 * Composition root : le seul endroit où les implémentations concrètes sont instanciées et câblées.
 * Les tests peuvent construire les services directement avec des repositories factices.
 */
export function createContainer(db: Database) {
  const services = {
    sources: new SourceService(new DrizzleSourceRepository(db)),
    manhwas: new ManhwaService(new DrizzleManhwaRepository(db)),
    chapters: new ChapterService(new DrizzleChapterRepository(db)),
    genres: new GenreService(new DrizzleGenreRepository(db)),
    reading: new ReadingService(new DrizzleReadingRepository(db)),
  };

  const controllers = {
    sources: new SourceController(services.sources),
    manhwas: new ManhwaController(services.manhwas),
    chapters: new ChapterController(services.chapters),
    genres: new GenreController(services.genres),
    reading: new ReadingController(services.reading),
  };

  return { services, controllers };
}

export type Container = ReturnType<typeof createContainer>;
