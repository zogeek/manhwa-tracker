import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { TransactionRunner } from '../../shared/db/transaction.js';
import {
  BadGatewayError,
  BadRequestError,
  ConflictError,
  NotFoundError,
  ServiceUnavailableError,
} from '../../shared/lib/errors.js';
import { TokenBucket } from '../../shared/lib/rate-limiter.js';
import { TtlCache } from '../../shared/lib/ttl-cache.js';
import type { JobQueue } from '../jobs/job.repository.js';
import type { JobRequest } from '../jobs/job.types.js';
import type { ManhwaRepository } from '../manhwas/manhwa.repository.js';
import type { ManhwaSearchHit, ManhwaView } from '../manhwas/manhwa.schema.js';
import type { DiscoveryRepository, ExternalLinkTarget, VocabularyRef } from './discovery.repository.js';
import { DiscoveryService, IMPORT_VOCABULARIES, type DiscoveryRepositories } from './discovery.service.js';
import {
  externalRefKey,
  type ExternalAuthor,
  type ExternalCatalogProvider,
  type ExternalManhwa,
  type ExternalProvider,
  type ExternalRef,
  type ExternalTag,
} from './external-catalog.js';
import { CachedCatalogProvider, RateLimitedCatalogProvider } from './external-catalog.decorators.js';

function buildManhwa(overrides: Partial<ManhwaView> = {}): ManhwaView {
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
    authors: [],
    localCoverUrl: null,
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
    authors: [{ name: 'TurtleMe', nativeName: null, role: 'story' }],
    crossReferences: [],
    ...overrides,
  };
}

const MANGADEX_ID = 'a1c7c817-4e59-43b7-9365-09675a149a6f';

/** La même œuvre vue par MangaDex, qui pointe vers son id AniList. */
const buildMangaDex = (overrides: Partial<ExternalManhwa> = {}) =>
  buildExternal({
    provider: 'mangadex',
    externalId: MANGADEX_ID,
    url: `https://mangadex.org/title/${MANGADEX_ID}`,
    coverUrl: `https://uploads.mangadex.org/covers/${MANGADEX_ID}/cover.jpg.512.jpg`,
    crossReferences: [{ provider: 'anilist', externalId: '105398', url: 'https://anilist.co/manga/105398' }],
    ...overrides,
  });

class InMemoryManhwas implements Pick<ManhwaRepository, 'search' | 'findById'> {
  readonly rows = new Map<string, ManhwaView>();

  async search(query: string): Promise<ManhwaSearchHit[]> {
    return [...this.rows.values()]
      .filter((manhwa) => manhwa.title.toLowerCase().includes(query.toLowerCase()))
      .map((manhwa) => ({ ...manhwa, score: 1 }));
  }

  async findById(id: string): Promise<ManhwaView | null> {
    return this.rows.get(id) ?? null;
  }
}

class InMemoryDiscoveryRepository implements DiscoveryRepository {
  readonly links = new Map<string, ExternalLinkTarget>();
  readonly attached: { manhwaId: string; vocabulary: string; tags: readonly ExternalTag[] }[] = [];
  readonly locked: string[][] = [];

  constructor(private readonly manhwas: InMemoryManhwas) {}

  async lockExternalRefs(refs: readonly ExternalRef[]): Promise<void> {
    this.locked.push(refs.map(externalRefKey));
  }

  async findLinkedManhwa(provider: ExternalProvider, externalId: string): Promise<ExternalLinkTarget | null> {
    return this.links.get(externalRefKey({ provider, externalId })) ?? null;
  }

  async findImportedManhwaIds(refs: readonly ExternalRef[]): Promise<Map<string, string>> {
    const found = new Map<string, string>();
    for (const ref of refs) {
      const link = this.links.get(externalRefKey(ref));
      if (link && !link.deleted) found.set(externalRefKey(ref), link.manhwaId);
    }
    return found;
  }

  async insertImportedManhwa(item: ExternalManhwa, userId: string): Promise<string> {
    const manhwa = buildManhwa({ title: item.title, createdBy: userId });
    this.manhwas.rows.set(manhwa.id, manhwa);
    this.links.set(externalRefKey(item), { manhwaId: manhwa.id, deleted: false });
    return manhwa.id;
  }

  async linkExternalRefs(manhwaId: string, refs: readonly ExternalRef[]): Promise<number> {
    let created = 0;
    for (const ref of refs) {
      if (this.links.has(externalRefKey(ref))) continue;
      this.links.set(externalRefKey(ref), { manhwaId, deleted: false });
      created += 1;
    }
    return created;
  }

  readonly authorLinks: { manhwaId: string; authors: readonly ExternalAuthor[] }[] = [];

  async hasAuthors(manhwaId: string): Promise<boolean> {
    return this.authorLinks.some((link) => link.manhwaId === manhwaId && link.authors.length > 0);
  }

  async attachAuthors(manhwaId: string, authors: readonly ExternalAuthor[]): Promise<number> {
    this.authorLinks.push({ manhwaId, authors });
    return authors.length;
  }

  async attachTerms(manhwaId: string, vocabulary: VocabularyRef, tags: readonly ExternalTag[]): Promise<number> {
    this.attached.push({ manhwaId, vocabulary: vocabulary.slug, tags });
    return tags.length;
  }
}

class InMemoryJobQueue implements JobQueue {
  readonly enqueued: JobRequest[] = [];

  async enqueue(requests: readonly JobRequest[]): Promise<number> {
    this.enqueued.push(...requests);
    return requests.length;
  }
}

class FakeProvider implements ExternalCatalogProvider {
  searchCalls = 0;
  lookups = 0;
  failWith: Error | null = null;

  constructor(
    readonly catalog: ExternalManhwa[] = [buildExternal()],
    readonly name: ExternalProvider = 'anilist',
  ) {}

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
let jobs: InMemoryJobQueue;
let provider: FakeProvider;
let mangadex: FakeProvider;
let service: DiscoveryService;

function createService(providers: ExternalCatalogProvider[]) {
  const transactions: TransactionRunner<DiscoveryRepositories> = {
    run: (work) => {
      const repositories = { discovery: repo, jobs };
      return work(repositories, (inner) => inner(repositories));
    },
  };
  return new DiscoveryService(manhwas, repo, providers, transactions);
}

beforeEach(() => {
  manhwas = new InMemoryManhwas();
  repo = new InMemoryDiscoveryRepository(manhwas);
  jobs = new InMemoryJobQueue();
  provider = new FakeProvider();
  mangadex = new FakeProvider([buildMangaDex()], 'mangadex');
  service = createService([provider]);
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

  it('queries every enabled provider, each one failing independently', async () => {
    service = createService([provider, mangadex]);
    provider.failWith = new BadGatewayError('AniList is down');

    const result = await service.search({ q: 'beginning', limit: 10, external: false });

    expect(result.providers).toEqual([
      { provider: 'anilist', status: 'unavailable' },
      { provider: 'mangadex', status: 'ok' },
    ]);
    expect(result.external.map((hit) => hit.provider)).toEqual(['mangadex']);
  });

  it('restricts the search to the providers requested by the client', async () => {
    service = createService([provider, mangadex]);

    const result = await service.search({ q: 'beginning', limit: 10, external: false, providers: ['mangadex'] });

    expect(result.providers).toEqual([{ provider: 'mangadex', status: 'ok' }]);
    expect(provider.searchCalls).toBe(0);
  });

  it('flags a result as imported when the work was imported from another provider (cross reference)', async () => {
    service = createService([mangadex]);
    repo.links.set('anilist:105398', { manhwaId: 'local-1', deleted: false });

    const result = await service.search({ q: 'beginning', limit: 10, external: false });

    expect(result.external).toMatchObject([{ provider: 'mangadex', importedManhwaId: 'local-1' }]);
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
    expect(repo.locked).toEqual([['anilist:105398']]);
    expect(repo.authorLinks).toEqual([
      { manhwaId: outcome.manhwa.id, authors: [{ name: 'TurtleMe', nativeName: null, role: 'story' }] },
    ]);
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

  it('refuses a provider that is not enabled on this server', async () => {
    await expect(
      service.importManhwa({ provider: 'mangadex', externalId: MANGADEX_ID }, 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestError);
  });
});

describe('DiscoveryService.importManhwa — follow-up jobs (outbox)', () => {
  it('enqueues the cover mirror and a provider-agnostic chapter sync, even for a provider without chapters', async () => {
    provider.catalog[0] = buildExternal({ coverUrl: 'https://s4.anilist.co/cover.jpg' });

    const { manhwa } = await service.importManhwa({ provider: 'anilist', externalId: '105398' }, 'user-1');

    // Le service ne sait pas qui fournit des chapitres : la tâche décidera d'après les liens de l'œuvre.
    expect(jobs.enqueued).toEqual([
      {
        type: 'cover.mirror',
        payload: { manhwaId: manhwa.id, imageUrl: 'https://s4.anilist.co/cover.jpg' },
        dedupeKey: `cover.mirror:${manhwa.id}:https://s4.anilist.co/cover.jpg`,
      },
      { type: 'chapters.sync', payload: { manhwaId: manhwa.id }, dedupeKey: `chapters.sync:${manhwa.id}` },
    ]);
  });

  it('names only the work in the chapter sync, never the provider it came from', async () => {
    service = createService([provider, mangadex]);

    const { manhwa } = await service.importManhwa({ provider: 'mangadex', externalId: MANGADEX_ID }, 'user-1');

    expect(jobs.enqueued.map((job) => job.type)).toEqual(['cover.mirror', 'chapters.sync']);
    expect(jobs.enqueued[1]).toEqual({
      type: 'chapters.sync',
      payload: { manhwaId: manhwa.id },
      dedupeKey: `chapters.sync:${manhwa.id}`,
    });
    // L'œuvre MangaDex et sa référence AniList sont rattachées à la nouvelle fiche.
    expect(repo.links.get('anilist:105398')?.manhwaId).toBe(manhwa.id);
  });

  it('does not enqueue anything when the import is a no-op (already imported)', async () => {
    await service.importManhwa({ provider: 'anilist', externalId: '105398' }, 'user-1');
    jobs.enqueued.length = 0;

    await service.importManhwa({ provider: 'anilist', externalId: '105398' }, 'user-2');

    expect(jobs.enqueued).toEqual([]);
  });
});

describe('DiscoveryService.importManhwa — cross-provider deduplication', () => {
  beforeEach(() => {
    service = createService([provider, mangadex]);
  });

  it('completes the manhwa imported from AniList instead of creating a duplicate', async () => {
    const fromAniList = await service.importManhwa({ provider: 'anilist', externalId: '105398' }, 'user-1');
    jobs.enqueued.length = 0;

    const fromMangaDex = await service.importManhwa({ provider: 'mangadex', externalId: MANGADEX_ID }, 'user-2');

    expect(fromMangaDex).toEqual({ manhwa: fromAniList.manhwa, created: false });
    expect(manhwas.rows.size).toBe(1);
    expect(repo.links.get(`mangadex:${MANGADEX_ID}`)?.manhwaId).toBe(fromAniList.manhwa.id);
    // La fiche AniList a déjà ses auteurs : ceux de MangaDex (autres graphies) ne s'y ajoutent pas.
    expect(repo.authorLinks).toHaveLength(1);
    // La fiche a déjà sa couverture ; ses nouveaux liens (MangaDex) justifient une nouvelle synchronisation.
    expect(jobs.enqueued.map((job) => job.type)).toEqual(['chapters.sync']);
    // Les deux références sont verrouillées : un import AniList simultané attendrait son tour.
    expect(repo.locked.at(-1)).toEqual([`mangadex:${MANGADEX_ID}`, 'anilist:105398']);
  });

  it('gives authors to a sibling that had none (e.g. imported from a catalogue without staff)', async () => {
    provider.catalog[0] = buildExternal({ authors: [] });
    const fromAniList = await service.importManhwa({ provider: 'anilist', externalId: '105398' }, 'user-1');

    await service.importManhwa({ provider: 'mangadex', externalId: MANGADEX_ID }, 'user-2');

    expect(repo.authorLinks.at(-1)).toEqual({
      manhwaId: fromAniList.manhwa.id,
      authors: [{ name: 'TurtleMe', nativeName: null, role: 'story' }],
    });
  });

  it('refuses to attach to a sibling that an admin removed', async () => {
    repo.links.set('anilist:105398', { manhwaId: 'gone', deleted: true });

    await expect(
      service.importManhwa({ provider: 'mangadex', externalId: MANGADEX_ID }, 'user-1'),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(jobs.enqueued).toEqual([]);
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
