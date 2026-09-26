import type { Database } from './shared/db/index.js';
import type { HttpFetch } from './shared/http/outbound.js';
import { TokenBucket, type TokenBucketOptions } from './shared/lib/rate-limiter.js';
import { TtlCache } from './shared/lib/ttl-cache.js';
import { LocalDiskMediaStorage } from './shared/storage/media-storage.js';
import { createAuth, type AuthOptions } from './shared/auth/index.js';
import { createTransactionRunner } from './shared/db/transaction.js';
import { DrizzleChapterRepository } from './modules/chapters/chapter.repository.js';
import { ChapterService } from './modules/chapters/chapter.service.js';
import { AniListClient } from './modules/discovery/anilist.client.js';
import { ChapterSyncJob, DrizzleChapterSyncRepository } from './modules/discovery/chapter-sync.job.js';
import { DrizzleDiscoveryRepository } from './modules/discovery/discovery.repository.js';
import { DiscoveryService } from './modules/discovery/discovery.service.js';
import type {
  ExternalCatalogProvider,
  ExternalChapterFeed,
  ExternalManhwa,
  ExternalProvider,
} from './modules/discovery/external-catalog.js';
import {
  CachedCatalogProvider,
  RateLimitedCatalogProvider,
  RateLimitedChapterFeed,
} from './modules/discovery/external-catalog.decorators.js';
import { KitsuClient } from './modules/discovery/kitsu.client.js';
import { MangaDexClient } from './modules/discovery/mangadex.client.js';
import { CoverMirrorJob, DrizzleCoverMirrorRepository } from './modules/images/cover-mirror.job.js';
import { ImageProxyService } from './modules/images/image-proxy.service.js';
import { MediaService } from './modules/images/media.service.js';
import { DrizzleJobRepository } from './modules/jobs/job.repository.js';
import { JobWorker, type JobLogger } from './modules/jobs/job.worker.js';
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
  /** Catalogues externes activés, par ordre de priorité. */
  discoveryProviders: readonly ExternalProvider[];
  anilistUrl: string;
  mangadexUrl: string;
  mangadexChapterLanguages: readonly string[];
  kitsuUrl: string;
  imageProxyAllowedHosts: readonly string[];
  mediaStorageDir: string;
  /** Quotas sortants par fournisseur (défaut : `DEFAULT_RATE_LIMITS`). */
  rateLimits?: Record<ExternalProvider, RateLimit>;
};

export type RateLimit = Omit<TokenBucketOptions, 'clock'>;

/** Nos quotas sortants, volontairement sous ceux des fournisseurs (AniList ~90 req/min, MangaDex ~5 req/s, Kitsu sans quota publié). */
export const DEFAULT_RATE_LIMITS: Record<ExternalProvider, RateLimit> = {
  anilist: { capacity: 10, refillPerMinute: 30 },
  mangadex: { capacity: 5, refillPerMinute: 120 },
  kitsu: { capacity: 10, refillPerMinute: 60 },
};

export type JobOptions = {
  workerId: string;
  pollIntervalMs?: number;
  batchSize?: number;
  logger?: JobLogger;
};

export type ContainerOptions = {
  db: Database;
  auth: Omit<AuthOptions, 'db'>;
  integrations: IntegrationOptions;
  jobs: JobOptions;
};

/** Mémorise les recherches d'un fournisseur (10 min) : un résultat en cache ne consomme aucun jeton. */
const withSearchCache = (provider: ExternalCatalogProvider): ExternalCatalogProvider =>
  new CachedCatalogProvider(provider, new TtlCache<ExternalManhwa[]>({ ttlMs: 10 * 60_000, maxEntries: 500 }));

/**
 * Composition root : le seul endroit où les implémentations concrètes sont instanciées et câblées.
 * Les tests peuvent construire les services directement avec des repositories factices.
 */
export function createContainer({ db, auth, integrations, jobs }: ContainerOptions) {
  const logReadTransactions = createTransactionRunner(db, (client) => ({
    progress: new DrizzleReadingProgressRepository(client),
    chapters: new DrizzleChapterRepository(client),
  }));
  const ingestionTransactions = createTransactionRunner(db, (client) => ({
    ingestion: new DrizzleIngestionRepository(client),
  }));
  // L'outbox : les tâches sont mises en file avec le repository de la transaction d'import.
  const discoveryTransactions = createTransactionRunner(db, (client) => ({
    discovery: new DrizzleDiscoveryRepository(client),
    jobs: new DrizzleJobRepository(client),
  }));
  const chapterSyncTransactions = createTransactionRunner(db, (client) => ({
    sync: new DrizzleChapterSyncRepository(client),
    ingestion: new DrizzleIngestionRepository(client),
  }));

  // Stratégies de catalogue externe : cache → limiteur (sous le quota du fournisseur) → client HTTP.
  // Le seau MangaDex est partagé par la recherche et le flux de chapitres : un seul quota global.
  const rateLimits = integrations.rateLimits ?? DEFAULT_RATE_LIMITS;
  const anilistBucket = new TokenBucket(rateLimits.anilist);
  const mangadexBucket = new TokenBucket(rateLimits.mangadex);
  const mangadex = new MangaDexClient({
    fetch: integrations.fetch,
    url: integrations.mangadexUrl,
    chapterLanguages: integrations.mangadexChapterLanguages,
  });
  const catalogs: Record<ExternalProvider, ExternalCatalogProvider> = {
    anilist: withSearchCache(
      new RateLimitedCatalogProvider(new AniListClient({ fetch: integrations.fetch, url: integrations.anilistUrl }), anilistBucket),
    ),
    mangadex: withSearchCache(new RateLimitedCatalogProvider(mangadex, mangadexBucket)),
    kitsu: withSearchCache(
      new RateLimitedCatalogProvider(
        new KitsuClient({ fetch: integrations.fetch, url: integrations.kitsuUrl }),
        new TokenBucket(rateLimits.kitsu),
      ),
    ),
  };
  const chapterFeeds: ExternalChapterFeed[] = [new RateLimitedChapterFeed(mangadex, mangadexBucket)].filter((feed) =>
    integrations.discoveryProviders.includes(feed.name),
  );

  const manhwaRepository = new DrizzleManhwaRepository(db);
  const imageProxy = new ImageProxyService({ fetch: integrations.fetch, allowedHosts: integrations.imageProxyAllowedHosts });
  const mediaStorage = new LocalDiskMediaStorage({ rootDir: integrations.mediaStorageDir });

  return {
    auth: createAuth({ ...auth, db }),
    services: {
      sources: new SourceService(new DrizzleSourceRepository(db)),
      manhwas: new ManhwaService(manhwaRepository),
      discovery: new DiscoveryService(
        manhwaRepository,
        new DrizzleDiscoveryRepository(db),
        integrations.discoveryProviders.map((name) => catalogs[name]),
        discoveryTransactions,
        { chapterFeeds: chapterFeeds.map((feed) => feed.name) },
      ),
      images: imageProxy,
      media: new MediaService(mediaStorage),
      chapters: new ChapterService(new DrizzleChapterRepository(db)),
      taxonomy: new TaxonomyService(new DrizzleTaxonomyRepository(db)),
      readingProgress: new ReadingProgressService(new DrizzleReadingProgressRepository(db), logReadTransactions),
      readingLists: new ReadingListService(new DrizzleReadingListRepository(db)),
      ingestion: new IngestionService(new DrizzleIngestionRepository(db), ingestionTransactions),
    },
    // Démarré par index.ts (jamais dans les tests, qui appellent `runOnce()` à la demande).
    worker: new JobWorker(
      new DrizzleJobRepository(db),
      [
        new CoverMirrorJob(new DrizzleCoverMirrorRepository(db), imageProxy, mediaStorage),
        new ChapterSyncJob(chapterFeeds, new DrizzleChapterSyncRepository(db), chapterSyncTransactions, jobs.logger),
      ],
      jobs,
    ),
  };
}

export type Container = ReturnType<typeof createContainer>;
export type Services = Container['services'];
