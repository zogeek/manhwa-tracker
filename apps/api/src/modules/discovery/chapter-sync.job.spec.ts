import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { TransactionRunner } from '../../shared/db/transaction.js';
import { BadGatewayError, NotFoundError } from '../../shared/lib/errors.js';
import type { ManhwaSourceLink } from '../ingestion/ingestion.repository.js';
import type { NewChapterRelease } from '../ingestion/ingestion.schema.js';
import type { IngestChapterItem } from '../ingestion/ingestion.validator.js';
import { PermanentJobError } from '../jobs/job.types.js';
import {
  ChapterSyncJob,
  type ChapterSyncRepositories,
  type ChapterSyncRepository,
} from './chapter-sync.job.js';
import type { ExternalChapter, ExternalChapterFeed, ExternalProvider, ExternalSource } from './external-catalog.js';

const MANHWA_ID = randomUUID();
const WORK_ID = 'a1c7c817-4e59-43b7-9365-09675a149a6f';

const chapter = (number: number, overrides: Partial<ExternalChapter> = {}): ExternalChapter => ({
  externalId: randomUUID(),
  number,
  title: null,
  language: 'en',
  url: `https://mangadex.org/chapter/${randomUUID()}`,
  scanlationGroup: 'Tapas Official',
  publishedAt: null,
  ...overrides,
});

class FakeFeed implements ExternalChapterFeed {
  readonly name: ExternalProvider = 'mangadex';
  readonly source: ExternalSource = { name: 'MangaDex', baseUrl: 'https://mangadex.org', language: 'en' };
  chapters: ExternalChapter[] = [];
  failWith: Error | null = null;
  calls = 0;

  workUrl(externalId: string): string {
    return `https://mangadex.org/title/${externalId}`;
  }

  async listChapters(): Promise<ExternalChapter[]> {
    this.calls += 1;
    if (this.failWith) throw this.failWith;
    return this.chapters;
  }
}

/** Catalogue en mémoire qui reproduit les upserts idempotents du repository d'ingestion. */
class InMemoryCatalog implements ChapterSyncRepository {
  active = true;
  readonly sources: ExternalSource[] = [];
  readonly chapters = new Map<number, string>();
  readonly groups = new Map<string, string>();
  readonly releases = new Map<string, NewChapterRelease>();
  readonly links: ManhwaSourceLink[] = [];

  async isManhwaActive(): Promise<boolean> {
    return this.active;
  }

  async ensureSource(source: ExternalSource): Promise<string> {
    if (!this.sources.some((known) => known.baseUrl === source.baseUrl)) this.sources.push(source);
    return 'source-mangadex';
  }

  readonly ingestion: ChapterSyncRepositories['ingestion'] = {
    upsertChapter: async (_manhwaId: string, item: IngestChapterItem) => {
      const existing = this.chapters.get(item.number);
      if (existing) return { id: existing, created: false };
      const id = randomUUID();
      this.chapters.set(item.number, id);
      return { id, created: true };
    },
    upsertScanlationGroup: async (name: string) => {
      const id = this.groups.get(name) ?? randomUUID();
      this.groups.set(name, id);
      return id;
    },
    upsertRelease: async (data: NewChapterRelease) => {
      const created = !this.releases.has(data.url);
      this.releases.set(data.url, data);
      return created;
    },
    linkManhwaSource: async (link: ManhwaSourceLink) => {
      this.links.push(link);
    },
  };
}

let feed: FakeFeed;
let catalog: InMemoryCatalog;
let job: ChapterSyncJob;

beforeEach(() => {
  feed = new FakeFeed();
  catalog = new InMemoryCatalog();
  const transactions: TransactionRunner<ChapterSyncRepositories> = {
    run: (work) => work({ sync: catalog, ingestion: catalog.ingestion }),
  };
  job = new ChapterSyncJob([feed], catalog, transactions, { info: () => undefined });
});

const run = (provider: ExternalProvider = 'mangadex') =>
  job.handle({ manhwaId: MANHWA_ID, provider, externalId: WORK_ID });

describe('ChapterSyncJob', () => {
  it('upserts canonical chapters and one release per translation', async () => {
    feed.chapters = [
      chapter(1, { language: 'en' }),
      chapter(1, { language: 'fr', scanlationGroup: 'Scan FR' }),
      chapter(2.5, { scanlationGroup: null }),
    ];

    await run();

    expect([...catalog.chapters.keys()]).toEqual([1, 2.5]);
    expect(catalog.releases.size).toBe(3);
    expect([...catalog.groups.keys()]).toEqual(['Tapas Official', 'Scan FR']);
    expect([...catalog.releases.values()].map((release) => release.sourceId)).toEqual([
      'source-mangadex',
      'source-mangadex',
      'source-mangadex',
    ]);
    expect(catalog.links).toEqual([
      {
        manhwaId: MANHWA_ID,
        sourceId: 'source-mangadex',
        manhwaUrl: `https://mangadex.org/title/${WORK_ID}`,
        latestChapter: 2.5,
      },
    ]);
  });

  it('can be replayed without duplicating anything (at-least-once delivery)', async () => {
    feed.chapters = [chapter(1), chapter(2)];

    await run();
    await run();

    expect(catalog.chapters.size).toBe(2);
    expect(catalog.releases.size).toBe(2);
  });

  it('does nothing for a manhwa removed from the catalogue in the meantime', async () => {
    catalog.active = false;

    await run();

    expect(feed.calls).toBe(0);
    expect(catalog.links).toEqual([]);
  });

  it('fails permanently for a provider without a chapter feed or a work unknown to the provider', async () => {
    await expect(run('anilist')).rejects.toBeInstanceOf(PermanentJobError);

    feed.failWith = new NotFoundError('MangaDex work', WORK_ID);
    await expect(run()).rejects.toBeInstanceOf(PermanentJobError);
  });

  it('lets transient provider failures bubble up so that the worker retries', async () => {
    feed.failWith = new BadGatewayError('MangaDex is unreachable');

    await expect(run()).rejects.toBeInstanceOf(BadGatewayError);
  });
});
