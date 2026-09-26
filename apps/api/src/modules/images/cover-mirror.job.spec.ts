import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { BadGatewayError, BadRequestError, NotFoundError } from '../../shared/lib/errors.js';
import { mediaKeyFor, type MediaStorage, type StoredMedia } from '../../shared/storage/media-storage.js';
import { PermanentJobError } from '../jobs/job.types.js';
import { CoverMirrorJob, type CoverMirrorRepository, type CoverToMirror } from './cover-mirror.job.js';
import type { ProxiedImage } from './image-proxy.service.js';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const MANHWA_ID = randomUUID();
const IMAGE_URL = 'https://s4.anilist.co/cover.png';
const NOW = new Date('2026-09-26T12:00:00Z');

class InMemoryCovers implements CoverMirrorRepository {
  cover: CoverToMirror | null = { id: 'cover-1', storageKey: null };
  mirrored: { coverId: string; storageKey: string; at: Date }[] = [];

  async findCover(): Promise<CoverToMirror | null> {
    return this.cover;
  }

  async markMirrored(coverId: string, storageKey: string, at: Date): Promise<void> {
    this.mirrored.push({ coverId, storageKey, at });
  }
}

class InMemoryStorage implements MediaStorage {
  readonly files = new Map<string, StoredMedia>();

  async put(key: string, body: Uint8Array<ArrayBuffer>, contentType: string): Promise<void> {
    this.files.set(key, { body, contentType });
  }

  async get(key: string): Promise<StoredMedia | null> {
    return this.files.get(key) ?? null;
  }
}

let covers: InMemoryCovers;
let storage: InMemoryStorage;
let downloads: number;
let download: () => Promise<ProxiedImage>;
let job: CoverMirrorJob;

beforeEach(() => {
  covers = new InMemoryCovers();
  storage = new InMemoryStorage();
  downloads = 0;
  download = async () => ({ body: new Uint8Array(PNG), contentType: 'image/png' });
  const images = {
    fetchImage: () => {
      downloads += 1;
      return download();
    },
  };
  job = new CoverMirrorJob(covers, images, storage, () => NOW.getTime());
});

const run = () => job.handle({ manhwaId: MANHWA_ID, imageUrl: IMAGE_URL });

describe('CoverMirrorJob', () => {
  it('downloads the cover through the proxy and stores it under its content hash', async () => {
    await run();

    const key = mediaKeyFor(PNG, 'image/png');
    expect(storage.files.get(key)).toEqual({ body: PNG, contentType: 'image/png' });
    expect(covers.mirrored).toEqual([{ coverId: 'cover-1', storageKey: key, at: NOW }]);
  });

  it('is idempotent: an already mirrored or deleted cover is not downloaded again', async () => {
    covers.cover = { id: 'cover-1', storageKey: 'already.png' };
    await run();
    covers.cover = null;
    await run();

    expect(downloads).toBe(0);
    expect(covers.mirrored).toEqual([]);
  });

  it('gives up for good when the image is gone or its host is refused', async () => {
    download = () => Promise.reject(new NotFoundError('Image', IMAGE_URL));
    await expect(run()).rejects.toBeInstanceOf(PermanentJobError);

    download = () => Promise.reject(new BadRequestError('Image host "evil.example" is not allowed'));
    await expect(run()).rejects.toBeInstanceOf(PermanentJobError);
  });

  it('lets transient upstream failures bubble up so that the worker retries', async () => {
    download = () => Promise.reject(new BadGatewayError('Image host answered HTTP 503'));

    await expect(run()).rejects.toBeInstanceOf(BadGatewayError);
    expect(covers.mirrored).toEqual([]);
  });
});
