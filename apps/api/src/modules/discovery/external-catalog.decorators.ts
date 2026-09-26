import { ServiceUnavailableError } from '../../shared/lib/errors.js';
import type { TokenBucket } from '../../shared/lib/rate-limiter.js';
import type { TtlCache } from '../../shared/lib/ttl-cache.js';
import type {
  ExternalCatalogProvider,
  ExternalChapter,
  ExternalChapterFeed,
  ExternalManhwa,
  ExternalProvider,
  ExternalSource,
} from './external-catalog.js';

// Décorateurs : chacun enrobe un fournisseur et ajoute UN comportement, sans que le service
// ni l'adaptateur AniList n'en sachent rien. L'assemblage se fait dans la composition root.

/** Refuse l'appel (503) quand notre quota vers le fournisseur est épuisé. */
export class RateLimitedCatalogProvider implements ExternalCatalogProvider {
  readonly name: ExternalProvider;

  constructor(
    private readonly inner: ExternalCatalogProvider,
    private readonly bucket: TokenBucket,
  ) {
    this.name = inner.name;
  }

  // `async` : un quota épuisé doit devenir une promesse rejetée, jamais une exception synchrone
  // (sinon un appelant qui gère l'échec via `.then(…, onError)` ne l'intercepterait pas).
  async search(query: string, limit: number): Promise<ExternalManhwa[]> {
    takeToken(this.bucket, this.name);
    return this.inner.search(query, limit);
  }

  async findById(externalId: string): Promise<ExternalManhwa | null> {
    takeToken(this.bucket, this.name);
    return this.inner.findById(externalId);
  }
}

/**
 * Même garde-fou pour le flux de chapitres. Partager le seau avec le catalogue du même fournisseur
 * fait respecter UN quota global (celui de MangaDex), quelle que soit la fonctionnalité appelante.
 * Un jeton par synchronisation : le flux paginé reste borné par le client lui-même.
 */
export class RateLimitedChapterFeed implements ExternalChapterFeed {
  readonly name: ExternalProvider;
  readonly source: ExternalSource;

  constructor(
    private readonly inner: ExternalChapterFeed,
    private readonly bucket: TokenBucket,
  ) {
    this.name = inner.name;
    this.source = inner.source;
  }

  workUrl(externalId: string): string {
    return this.inner.workUrl(externalId);
  }

  async listChapters(externalId: string): Promise<ExternalChapter[]> {
    takeToken(this.bucket, this.name);
    return this.inner.listChapters(externalId);
  }
}

function takeToken(bucket: TokenBucket, provider: ExternalProvider): void {
  if (!bucket.tryTake()) {
    throw new ServiceUnavailableError(`Too many requests to ${provider}, retry in a moment`);
  }
}

/** Mémorise les recherches (placé AVANT le limiteur : un résultat en cache ne consomme aucun jeton). */
export class CachedCatalogProvider implements ExternalCatalogProvider {
  readonly name: ExternalProvider;

  constructor(
    private readonly inner: ExternalCatalogProvider,
    private readonly cache: TtlCache<ExternalManhwa[]>,
  ) {
    this.name = inner.name;
  }

  async search(query: string, limit: number): Promise<ExternalManhwa[]> {
    const key = `${this.name}:${limit}:${query.trim().toLowerCase()}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    const results = await this.inner.search(query, limit);
    this.cache.set(key, results);
    return results;
  }

  // L'import doit toujours partir de la fiche la plus fraîche : pas de cache.
  findById(externalId: string): Promise<ExternalManhwa | null> {
    return this.inner.findById(externalId);
  }
}
