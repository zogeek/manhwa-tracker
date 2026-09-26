import { ServiceUnavailableError } from '../../shared/lib/errors.js';
import type { TokenBucket } from '../../shared/lib/rate-limiter.js';
import type { TtlCache } from '../../shared/lib/ttl-cache.js';
import type { ExternalCatalogProvider, ExternalManhwa, ExternalProvider } from './external-catalog.js';

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
    this.takeToken();
    return this.inner.search(query, limit);
  }

  async findById(externalId: string): Promise<ExternalManhwa | null> {
    this.takeToken();
    return this.inner.findById(externalId);
  }

  private takeToken(): void {
    if (!this.bucket.tryTake()) {
      throw new ServiceUnavailableError(`Too many requests to ${this.name}, retry in a moment`);
    }
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
