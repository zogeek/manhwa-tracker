import type { Database } from './shared/db/index.js';
import type { HttpFetch } from './shared/http/outbound.js';
import { TokenBucket } from './shared/lib/rate-limiter.js';
import { TtlCache } from './shared/lib/ttl-cache.js';
import { createAuth, type AuthOptions } from './shared/auth/index.js';
import { createTransactionRunner } from './shared/db/transaction.js';
import { DrizzleChapterRepository } from './modules/chapters/chapter.repository.js';
import { ChapterService } from './modules/chapters/chapter.service.js';
import { AniListClient } from './modules/discovery/anilist.client.js';
import { DrizzleDiscoveryRepository } from './modules/discovery/discovery.repository.js';
import { DiscoveryService } from './modules/discovery/discovery.service.js';
import type { ExternalManhwa } from './modules/discovery/external-catalog.js';
import { CachedCatalogProvider, RateLimitedCatalogProvider } from './modules/discovery/external-catalog.decorators.js';
import { ImageProxyService } from './modules/images/image-proxy.service.js';
import { DrizzleIngestionRepository } from './modules/ingestion/ingestion.repository.js';
import { IngestionService } from './modules/ingestion/ingestion.service.js';
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

export type IntegrationOptions = {
  /** Client HTTP sortant (le `fetch` global en prod, un faux dans les tests : jamais de réseau réel). */
  fetch: HttpFetch;
  anilistUrl: string;
  imageProxyAllowedHosts: readonly string[];
};

export type ContainerOptions = {
  db: Database;
  auth: Omit<AuthOptions, 'db'>;
  integrations: IntegrationOptions;
};

/**
 * Composition root : le seul endroit où les implémentations concrètes sont instanciées et câblées.
 * Les tests peuvent construire les services directement avec des repositories factices.
 */
export function createContainer({ db, auth, integrations }: ContainerOptions) {
  const logReadTransactions = createTransactionRunner(db, (client) => ({
    progress: new DrizzleReadingProgressRepository(client),
    chapters: new DrizzleChapterRepository(client),
  }));
  const ingestionTransactions = createTransactionRunner(db, (client) => ({
    ingestion: new DrizzleIngestionRepository(client),
  }));
  const discoveryTransactions = createTransactionRunner(db, (client) => ({
    discovery: new DrizzleDiscoveryRepository(client),
  }));

  // Catalogue externe : cache (10 min) → limiteur (30 req/min, sous le quota AniList) → client HTTP.
  const anilist = new CachedCatalogProvider(
    new RateLimitedCatalogProvider(
      new AniListClient({ fetch: integrations.fetch, url: integrations.anilistUrl }),
      new TokenBucket({ capacity: 10, refillPerMinute: 30 }),
    ),
    new TtlCache<ExternalManhwa[]>({ ttlMs: 10 * 60_000, maxEntries: 500 }),
  );
  const manhwaRepository = new DrizzleManhwaRepository(db);

  return {
    auth: createAuth({ ...auth, db }),
    services: {
      sources: new SourceService(new DrizzleSourceRepository(db)),
      manhwas: new ManhwaService(manhwaRepository),
      discovery: new DiscoveryService(
        manhwaRepository,
        new DrizzleDiscoveryRepository(db),
        [anilist],
        discoveryTransactions,
      ),
      images: new ImageProxyService({ fetch: integrations.fetch, allowedHosts: integrations.imageProxyAllowedHosts }),
      chapters: new ChapterService(new DrizzleChapterRepository(db)),
      taxonomy: new TaxonomyService(new DrizzleTaxonomyRepository(db)),
      readingProgress: new ReadingProgressService(new DrizzleReadingProgressRepository(db), logReadTransactions),
      readingLists: new ReadingListService(new DrizzleReadingListRepository(db)),
      ingestion: new IngestionService(new DrizzleIngestionRepository(db), ingestionTransactions),
    },
  };
}

export type Container = ReturnType<typeof createContainer>;
export type Services = Container['services'];
