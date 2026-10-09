import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { ForbiddenError, NotFoundError, UnprocessableEntityError } from '../../shared/lib/errors.js';
import type { ManhwaSourceRepository } from './manhwa-source.repository.js';
import type { ManhwaSource, ManhwaSourceLink } from './manhwa-source.schema.js';
import { ManhwaSourceService, type Editor } from './manhwa-source.service.js';

/** Repository en mémoire : liens indexés par `manhwaId/sourceId`, abonnements par `manhwaId/userId`. */
class InMemoryManhwaSourceRepository implements ManhwaSourceRepository {
  readonly links = new Map<string, ManhwaSourceLink>();
  readonly follows = new Set<string>();

  async findLink(manhwaId: string, sourceId: string): Promise<ManhwaSourceLink | null> {
    return this.links.get(`${manhwaId}/${sourceId}`) ?? null;
  }

  async isFollowedBy(manhwaId: string, userId: string): Promise<boolean> {
    return this.follows.has(`${manhwaId}/${userId}`);
  }

  async updateUrl(manhwaId: string, sourceId: string, manhwaUrl: string | null): Promise<ManhwaSource | null> {
    const link = this.links.get(`${manhwaId}/${sourceId}`);
    if (!link) return null;
    const updated = { ...link, manhwaUrl, latestChapter: null, lastScrapedAt: null };
    this.links.set(`${manhwaId}/${sourceId}`, updated);
    const { sourceBaseUrl: _, ...row } = updated;
    return row;
  }
}

const reader: Editor = { id: 'reader-1', isAdmin: false };
const admin: Editor = { id: 'admin-1', isAdmin: true };

describe('ManhwaSourceService.updateUrl', () => {
  let repo: InMemoryManhwaSourceRepository;
  let service: ManhwaSourceService;
  const manhwaId = randomUUID();
  const sourceId = randomUUID();

  beforeEach(() => {
    repo = new InMemoryManhwaSourceRepository();
    service = new ManhwaSourceService(repo);
    repo.links.set(`${manhwaId}/${sourceId}`, {
      id: randomUUID(),
      manhwaId,
      sourceId,
      manhwaUrl: 'https://www.asura.example/series/wrong-one',
      latestChapter: 999,
      lastScrapedAt: new Date(),
      sourceBaseUrl: 'https://asura.example',
    });
  });

  it('lets a follower correct the URL and forgets what was scraped on the wrong page', async () => {
    repo.follows.add(`${manhwaId}/${reader.id}`);

    const updated = await service.updateUrl(
      manhwaId,
      sourceId,
      { manhwaUrl: 'https://asura.example/series/solo-leveling' },
      reader,
    );

    expect(updated).toMatchObject({
      manhwaUrl: 'https://asura.example/series/solo-leveling',
      latestChapter: null,
      lastScrapedAt: null,
    });
  });

  it('accepts null to send the series back to the search queue', async () => {
    const updated = await service.updateUrl(manhwaId, sourceId, { manhwaUrl: null }, admin);

    expect(updated.manhwaUrl).toBeNull();
  });

  it('throws NotFoundError when the manhwa is not linked to the source', async () => {
    await expect(
      service.updateUrl(manhwaId, randomUUID(), { manhwaUrl: null }, admin),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws ForbiddenError to a user who does not follow the series, and changes nothing', async () => {
    await expect(service.updateUrl(manhwaId, sourceId, { manhwaUrl: null }, reader)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(repo.links.get(`${manhwaId}/${sourceId}`)?.manhwaUrl).toBe('https://www.asura.example/series/wrong-one');
  });

  it('rejects a URL outside the source site (the worker would visit it)', async () => {
    await expect(
      service.updateUrl(manhwaId, sourceId, { manhwaUrl: 'https://evil.example/series/solo-leveling' }, admin),
    ).rejects.toBeInstanceOf(UnprocessableEntityError);
  });

  it('treats www. and the bare domain as the same site', async () => {
    const updated = await service.updateUrl(
      manhwaId,
      sourceId,
      { manhwaUrl: 'https://www.asura.example/series/solo-leveling' },
      admin,
    );

    expect(updated.manhwaUrl).toBe('https://www.asura.example/series/solo-leveling');
  });
});
