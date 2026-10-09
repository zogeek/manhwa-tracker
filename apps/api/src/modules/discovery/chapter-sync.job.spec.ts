import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { TransactionRunner } from '../../shared/db/transaction.js';
import { BadGatewayError, NotFoundError } from '../../shared/lib/errors.js';
import type { ManhwaSourceLink, TeamInput } from '../ingestion/ingestion.repository.js';
import type { NewChapterRelease } from '../ingestion/ingestion.schema.js';
import type { IngestChapterItem } from '../ingestion/ingestion.validator.js';
import { ChapterSyncJob, type ChapterSyncRepositories, type ChapterSyncRepository } from './chapter-sync.job.js';
import type {
  ExternalChapter,
  ExternalChapterFeed,
  ExternalProvider,
  ExternalRef,
  ExternalSource,
  ExternalTeam,
} from './external-catalog.js';

const MANHWA_ID = randomUUID();
const MANGADEX_ID = 'a1c7c817-4e59-43b7-9365-09675a149a6f';

const team = (name: string | null, externalId: string | null = null): ExternalTeam => ({
  externalId,
  name,
  websiteUrl: null,
});

const chapter = (number: number, overrides: Partial<ExternalChapter> = {}): ExternalChapter => ({
  externalId: randomUUID(),
  number,
  title: null,
  language: 'en',
  url: `https://feed.example/chapter/${randomUUID()}`,
  teams: [team('Tapas Official')],
  publishedAt: null,
  ...overrides,
});

/** Un fournisseur quelconque capable de lister des chapitres (le job ne sait pas lequel). */
class FakeFeed implements ExternalChapterFeed {
  readonly source: ExternalSource;
  chapters: ExternalChapter[] = [];
  failWith: Error | null = null;
  readonly calls: string[] = [];

  constructor(readonly name: ExternalProvider) {
    this.source = { name: `Feed ${name}`, baseUrl: `https://${name}.example`, language: 'en' };
  }

  workUrl(externalId: string): string {
    return `${this.source.baseUrl}/title/${externalId}`;
  }

  async listChapters(externalId: string): Promise<ExternalChapter[]> {
    this.calls.push(externalId);
    if (this.failWith) throw this.failWith;
    return this.chapters;
  }
}

/** Catalogue en mémoire qui reproduit les upserts idempotents du repository d'ingestion. */
class InMemoryCatalog implements ChapterSyncRepository {
  active = true;
  refs: Pick<ExternalRef, 'provider' | 'externalId'>[] = [];
  readonly sourceIds = new Map<string, string>();
  readonly chapters = new Map<number, string>();
  /** Teams connues, par clé d'identité (`provider:id` ou nom) → id. */
  readonly groups = new Map<string, string>();
  readonly teamCalls: TeamInput[] = [];
  readonly releases = new Map<string, NewChapterRelease & { id: string }>();
  readonly releaseTeams = new Map<string, readonly string[]>();
  readonly links: ManhwaSourceLink[] = [];

  async isManhwaActive(): Promise<boolean> {
    return this.active;
  }

  async findExternalRefs(): Promise<Pick<ExternalRef, 'provider' | 'externalId'>[]> {
    return this.refs;
  }

  async ensureSource(source: ExternalSource): Promise<string> {
    const id = this.sourceIds.get(source.baseUrl) ?? `source:${source.name}`;
    this.sourceIds.set(source.baseUrl, id);
    return id;
  }

  readonly ingestion: ChapterSyncRepositories['ingestion'] = {
    upsertChapter: async (_manhwaId: string, item: IngestChapterItem) => {
      const existing = this.chapters.get(item.number);
      if (existing) return { id: existing, created: false };
      const id = randomUUID();
      this.chapters.set(item.number, id);
      return { id, created: true };
    },
    upsertTeam: async (input: TeamInput) => {
      this.teamCalls.push(input);
      const key = input.provider && input.externalId ? `${input.provider}:${input.externalId}` : input.name;
      if (!key) return null;
      const known = this.groups.get(key);
      if (known) return known;
      if (!input.name) return null; // id inconnu et pas de nom : impossible à créer
      const id = randomUUID();
      this.groups.set(key, id);
      return id;
    },
    upsertRelease: async (data: NewChapterRelease) => {
      const existing = this.releases.get(data.url);
      const id = existing?.id ?? randomUUID();
      this.releases.set(data.url, { ...data, id });
      return { id, created: !existing };
    },
    setReleaseTeams: async (releaseId: string, teamIds: readonly string[]) => {
      if (teamIds.length > 0) this.releaseTeams.set(releaseId, teamIds);
    },
    linkManhwaSource: async (link: ManhwaSourceLink) => {
      this.links.push(link);
    },
  };
}

const silentLogger = { info: () => undefined, warn: () => undefined };

let mangadex: FakeFeed;
let kitsu: FakeFeed;
let catalog: InMemoryCatalog;
let job: ChapterSyncJob;

beforeEach(() => {
  mangadex = new FakeFeed('mangadex');
  // Un second fournisseur à chapitres, hypothétique aujourd'hui : prouve que rien n'est codé en dur.
  kitsu = new FakeFeed('kitsu');
  catalog = new InMemoryCatalog();
  const transactions: TransactionRunner<ChapterSyncRepositories> = {
    run: (work) => {
      const repositories = { sync: catalog, ingestion: catalog.ingestion };
      return work(repositories, (inner) => inner(repositories));
    },
  };
  job = new ChapterSyncJob([mangadex, kitsu], catalog, transactions, silentLogger);
});

const run = () => job.handle({ manhwaId: MANHWA_ID });

describe('ChapterSyncJob — picks its sources from the work links', () => {
  it('delegates to the provider linked to the work, whatever the import came from', async () => {
    // Œuvre importée depuis AniList (aucun flux) puis reliée à MangaDex.
    catalog.refs = [
      { provider: 'anilist', externalId: '105398' },
      { provider: 'mangadex', externalId: MANGADEX_ID },
    ];
    mangadex.chapters = [chapter(1), chapter(1, { language: 'fr', teams: [team('Scan FR')] }), chapter(2.5, { teams: [] })];

    await run();

    expect(mangadex.calls).toEqual([MANGADEX_ID]);
    expect([...catalog.chapters.keys()]).toEqual([1, 2.5]);
    expect(catalog.releases.size).toBe(3);
    expect(catalog.links).toEqual([
      {
        manhwaId: MANHWA_ID,
        sourceId: 'source:Feed mangadex',
        manhwaUrl: `https://mangadex.example/title/${MANGADEX_ID}`,
        latestChapter: 2.5,
      },
    ]);
  });

  it('syncs every linked feed, each into its own source', async () => {
    catalog.refs = [
      { provider: 'mangadex', externalId: MANGADEX_ID },
      { provider: 'kitsu', externalId: '41174' },
    ];
    mangadex.chapters = [chapter(1), chapter(2)];
    kitsu.chapters = [chapter(2), chapter(3)];

    await run();

    expect([...catalog.chapters.keys()].sort()).toEqual([1, 2, 3]);
    expect(new Set([...catalog.releases.values()].map((release) => release.sourceId))).toEqual(
      new Set(['source:Feed mangadex', 'source:Feed kitsu']),
    );
  });

  it('completes without error when no linked provider can list chapters (the scraper will)', async () => {
    catalog.refs = [{ provider: 'anilist', externalId: '105398' }];

    await expect(run()).resolves.toBeUndefined();

    expect(mangadex.calls).toEqual([]);
    expect(catalog.links).toEqual([]);
  });

  it('does nothing for a manhwa removed from the catalogue in the meantime', async () => {
    catalog.active = false;
    catalog.refs = [{ provider: 'mangadex', externalId: MANGADEX_ID }];

    await run();

    expect(mangadex.calls).toEqual([]);
  });

  it('can be replayed without duplicating anything (at-least-once delivery)', async () => {
    catalog.refs = [{ provider: 'mangadex', externalId: MANGADEX_ID }];
    mangadex.chapters = [chapter(1), chapter(2)];

    await run();
    await run();

    expect(catalog.chapters.size).toBe(2);
    expect(catalog.releases.size).toBe(2);
  });
});

describe('ChapterSyncJob — scanlation teams', () => {
  beforeEach(() => {
    catalog.refs = [{ provider: 'mangadex', externalId: MANGADEX_ID }];
  });

  it('credits every team of a collaboration, in order, under the provider id namespace', async () => {
    const asura = team('Asura Scans', 'uuid-asura');
    const flame = team('Flame Comics', 'uuid-flame');
    mangadex.chapters = [chapter(1, { teams: [asura, flame] })];

    await run();

    const [release] = [...catalog.releases.values()];
    expect(catalog.releaseTeams.get(release?.id ?? '')).toEqual([
      catalog.groups.get('mangadex:uuid-asura'),
      catalog.groups.get('mangadex:uuid-flame'),
    ]);
    // Les ids du fournisseur sont rangés sous son nom (`feed.name`) : aucun fournisseur codé en dur.
    expect(catalog.teamCalls.map((call) => call.provider)).toEqual(['mangadex', 'mangadex']);
  });

  it('resolves each team once per sync, however many chapters it translated', async () => {
    const asura = team('Asura Scans', 'uuid-asura');
    mangadex.chapters = Array.from({ length: 50 }, (_, index) => chapter(index + 1, { teams: [asura] }));

    await run();

    expect(catalog.teamCalls).toHaveLength(1);
    expect(new Set([...catalog.releaseTeams.values()].flat())).toEqual(new Set([catalog.groups.get('mangadex:uuid-asura')]));
  });

  it('skips a team that cannot be identified (unknown id, no name) without failing the sync', async () => {
    mangadex.chapters = [chapter(1, { teams: [team(null, 'uuid-deleted'), team('Asura Scans', 'uuid-asura')] })];

    await expect(run()).resolves.toBeUndefined();

    const [release] = [...catalog.releases.values()];
    expect(catalog.releaseTeams.get(release?.id ?? '')).toEqual([catalog.groups.get('mangadex:uuid-asura')]);
  });
});

describe('ChapterSyncJob — failures are isolated per feed', () => {
  beforeEach(() => {
    catalog.refs = [
      { provider: 'mangadex', externalId: MANGADEX_ID },
      { provider: 'kitsu', externalId: '41174' },
    ];
    kitsu.chapters = [chapter(7)];
  });

  it('skips a work that no longer exists at one provider and still syncs the others', async () => {
    mangadex.failWith = new NotFoundError('MangaDex work', MANGADEX_ID);

    await expect(run()).resolves.toBeUndefined();

    expect([...catalog.chapters.keys()]).toEqual([7]);
  });

  it('keeps what other feeds brought, then fails so that the worker retries the transient one', async () => {
    mangadex.failWith = new BadGatewayError('MangaDex is unreachable');

    await expect(run()).rejects.toThrow('1/2 chapter feed(s) failed — mangadex: MangaDex is unreachable');

    expect([...catalog.chapters.keys()]).toEqual([7]);
  });
});
