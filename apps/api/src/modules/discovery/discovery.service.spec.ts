import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { TransactionRunner } from '../../shared/db/transaction.js';
import { BadGatewayError, ConflictError, NotFoundError, ServiceUnavailableError } from '../../shared/lib/errors.js';
import { TokenBucket } from '../../shared/lib/rate-limiter.js';
import { TtlCache } from '../../shared/lib/ttl-cache.js';
import type { ManhwaRepository } from '../manhwas/manhwa.repository.js';
import type { Manhwa, ManhwaSearchHit } from '../manhwas/manhwa.schema.js';
import type { DiscoveryRepository, ExternalLinkTarget, VocabularyRef } from './discovery.repository.js';
import { DiscoveryService, IMPORT_VOCABULARIES, type DiscoveryRepositories } from './discovery.service.js';
import type { ExternalCatalogProvider, ExternalManhwa, ExternalProvider, ExternalTag } from './external-catalog.js';
import { CachedCatalogProvider, RateLimitedCatalogProvider } from './external-catalog.decorators.js';

function buildManhwa(overrides: Partial<Manhwa> = {}): Manhwa {
  const now = new Date();
  return {
    id: randomUUID(),
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
    ...overrides,
  };
}

function buildExternal(overrides: Partial<ExternalManhwa> = {}): ExternalManhwa {
  return {
    provider: 'anilist',
    externalId: '105398',
    url: 'https://anilist.co/manga/105398',
    title: 'The Beginning After the End',
    originalTitle: null,
    alternativeTitles: [],
    synopsis: null,
    coverUrl: null,
    type: 'manhwa',
    status: 'ongoing',
    totalChapters: null,
    rating: null,
    startDate: null,
    endDate: null,
    genres: ['Action'],
    tags: [{ name: 'Magic', relevance: 90, isSpoiler: false }],
    ...overrides,
  };
}

class InMemoryManhwas implements Pick<ManhwaRepository, 'search' | 'findById'> {
  readonly rows = new Map<string, Manhwa>();

  async search(query: string): Promise<ManhwaSearchHit[]> {
    return [...this.rows.values()]
      .filter((manhwa) => manhwa.title.toLowerCase().includes(query.toLowerCase()))
      .map((manhwa) => ({ ...manhwa, score: 1 }));
  }

  async findById(id: string): Promise<Manhwa | null> {
    return this.rows.get(id) ?? null;
  }
}

class InMemoryDiscoveryRepository implements DiscoveryRepository {
  readonly links = new Map<string, ExternalLinkTarget>();
  readonly attached: { manhwaId: string; vocabulary: string; tags: readonly ExternalTag[] }[] = [];
  locks = 0;

  constructor(private readonly manhwas: InMemoryManhwas) {}

  async lockExternalRef(): Promise<void> {
    this.locks += 1;
  }

  async findLinkedManhwa(provider: ExternalProvider, externalId: string): Promise<ExternalLinkTarget | null> {
    return this.links.get(`${provider}:${externalId}`) ?? null;
  }

  async findImportedManhwaIds(provider: ExternalProvider, externalIds: readonly string[]): Promise<Map<string, string>> {
    const found = new Map<string, string>();
    for (const externalId of externalIds) {
      const link = this.links.get(`${provider}:${externalId}`);
      if (link && !link.deleted) found.set(externalId, link.manhwaId);
    }
    return found;
  }

  async insertImportedManhwa(item: ExternalManhwa, userId: string): Promise<string> {
    const manhwa = buildManhwa({ title: item.title, createdBy: userId });
    this.manhwas.rows.set(manhwa.id, manhwa);
    this.links.set(`${item.provider}:${item.externalId}`, { manhwaId: manhwa.id, deleted: false });
    return manhwa.id;
  }

  async attachTerms(manhwaId: string, vocabulary: VocabularyRef, tags: readonly ExternalTag[]): Promise<number> {
    this.attached.push({ manhwaId, vocabulary: vocabulary.slug, tags });
    return tags.length;
  }
}

class FakeProvider implements ExternalCatalogProvider {
  readonly name: ExternalProvider = 'anilist';
  searchCalls = 0;
  lookups = 0;
  failWith: Error | null = null;

  constructor(readonly catalog: ExternalManhwa[] = [buildExternal()]) {}

  async search(): Promise<ExternalManhwa[]> {
    this.searchCalls += 1;
    if (this.failWith) throw this.failWith;
    return this.catalog;
  }

  async findById(externalId: string): Promise<ExternalManhwa | null> {
    this.lookups += 1;
    return this.catalog.find((item) => item.externalId === externalId) ?? null;
  }
}

let manhwas: InMemoryManhwas;
let repo: InMemoryDiscoveryRepository;
let provider: FakeProvider;
let service: DiscoveryService;

beforeEach(() => {
  manhwas = new InMemoryManhwas();
  repo = new InMemoryDiscoveryRepository(manhwas);
  provider = new FakeProvider();
  const transactions: TransactionRunner<DiscoveryRepositories> = { run: (work) => work({ discovery: repo }) };
  service = new DiscoveryService(manhwas, repo, [provider], transactions);
});

describe('DiscoveryService.search', () => {
  it('answers from the local catalogue without calling external providers', async () => {
    manhwas.rows.set('1', buildManhwa({ id: '1' }));

    const result = await service.search({ q: 'solo', limit: 10, external: false });

    expect(result.local).toHaveLength(1);
    expect(result.providers).toEqual([]);
    expect(provider.searchCalls).toBe(0);
  });

  it('falls back to external providers when nothing matches locally', async () => {
    const result = await service.search({ q: 'beginning', limit: 10, external: false });

    expect(result.local).toEqual([]);
    expect(result.providers).toEqual([{ provider: 'anilist', status: 'ok' }]);
    expect(result.external).toMatchObject([{ externalId: '105398', importedManhwaId: null }]);
  });

  it('can be forced to query external providers and flags works already imported', async () => {
    manhwas.rows.set('1', buildManhwa({ id: '1' }));
    repo.links.set('anilist:105398', { manhwaId: '1', deleted: false });

    const result = await service.search({ q: 'solo', limit: 10, external: true });

    expect(result.local).toHaveLength(1);
    expect(result.external).toMatchObject([{ externalId: '105398', importedManhwaId: '1' }]);
  });

  it('degrades gracefully when a provider is down or rate limited', async () => {
    provider.failWith = new BadGatewayError('AniList is unreachable');
    expect((await service.search({ q: 'x', limit: 10, external: false })).providers).toEqual([
      { provider: 'anilist', status: 'unavailable' },
    ]);

    provider.failWith = new ServiceUnavailableError('quota');
    const result = await service.search({ q: 'x', limit: 10, external: false });
    expect(result.providers).toEqual([{ provider: 'anilist', status: 'rate_limited' }]);
    expect(result.external).toEqual([]);
  });

  it('does not hide programming errors', async () => {
    provider.failWith = new TypeError('boom');

    await expect(service.search({ q: 'x', limit: 10, external: false })).rejects.toBeInstanceOf(TypeError);
  });
});

describe('DiscoveryService.importManhwa', () => {
  it('creates the manhwa with its genres and tags on the first import', async () => {
    const outcome = await service.importManhwa({ provider: 'anilist', externalId: '105398' }, 'user-1');

    expect(outcome.created).toBe(true);
    expect(outcome.manhwa).toMatchObject({ title: 'The Beginning After the End', createdBy: 'user-1' });
    expect(repo.attached.map((call) => call.vocabulary)).toEqual([
      IMPORT_VOCABULARIES.genres.slug,
      IMPORT_VOCABULARIES.tags.slug,
    ]);
    expect(repo.attached[0]?.tags).toEqual([{ name: 'Action', relevance: 100, isSpoiler: false }]);
    expect(repo.locks).toBe(1);
  });

  it('is idempotent: a second import returns the same manhwa without calling the provider', async () => {
    const first = await service.importManhwa({ provider: 'anilist', externalId: '105398' }, 'user-1');
    const second = await service.importManhwa({ provider: 'anilist', externalId: '105398' }, 'user-2');

    expect(second).toEqual({ manhwa: first.manhwa, created: false });
    expect(provider.lookups).toBe(1);
    expect(manhwas.rows.size).toBe(1);
  });

  it('throws NotFoundError when the provider does not know the work', async () => {
    await expect(service.importManhwa({ provider: 'anilist', externalId: '1' }, 'user-1')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('refuses to resurrect a work removed by an admin', async () => {
    repo.links.set('anilist:105398', { manhwaId: 'gone', deleted: true });

    await expect(
      service.importManhwa({ provider: 'anilist', externalId: '105398' }, 'user-1'),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('external catalog decorators', () => {
  it('serves repeated searches from the cache without consuming rate-limit tokens', async () => {
    const inner = new FakeProvider();
    const limited = new RateLimitedCatalogProvider(inner, new TokenBucket({ capacity: 1, refillPerMinute: 0 }));
    const cached = new CachedCatalogProvider(limited, new TtlCache({ ttlMs: 60_000, maxEntries: 10 }));

    await cached.search('Solo', 5);
    await cached.search('  solo ', 5);

    expect(inner.searchCalls).toBe(1);
    // Le seul jeton est consommé : une requête différente est refusée (503).
    await expect(cached.search('other', 5)).rejects.toBeInstanceOf(ServiceUnavailableError);
    await expect(cached.findById('105398')).rejects.toBeInstanceOf(ServiceUnavailableError);
  });
});
