import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalDiskMediaStorage, MEDIA_KEY_PATTERN, mediaKeyFor } from './media-storage.js';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

let rootDir: string;
let storage: LocalDiskMediaStorage;

beforeEach(async () => {
  rootDir = await mkdtemp(join(tmpdir(), 'media-storage-'));
  storage = new LocalDiskMediaStorage({ rootDir });
});

afterEach(() => rm(rootDir, { recursive: true, force: true }));

describe('mediaKeyFor', () => {
  it('derives a content-addressed key from the bytes and the media type', () => {
    const key = mediaKeyFor(PNG, 'image/png');

    expect(key).toMatch(MEDIA_KEY_PATTERN);
    expect(key.endsWith('.png')).toBe(true);
    expect(mediaKeyFor(new Uint8Array(PNG), 'image/png')).toBe(key);
    expect(mediaKeyFor(new Uint8Array([9]), 'image/png')).not.toBe(key);
  });

  it('rejects media types that are not raster images', () => {
    expect(() => mediaKeyFor(PNG, 'image/svg+xml')).toThrow(/Unsupported/);
  });
});

describe('LocalDiskMediaStorage', () => {
  it('stores and reads back a file, sharded by key prefix, without leftovers', async () => {
    const key = mediaKeyFor(PNG, 'image/png');

    await storage.put(key, PNG, 'image/png');
    await storage.put(key, PNG, 'image/png'); // idempotent

    expect(await storage.get(key)).toEqual({ body: PNG, contentType: 'image/png' });
    expect(await readdir(join(rootDir, key.slice(0, 2)))).toEqual([key]);
  });

  it('answers null for a missing or malformed key and refuses to write outside its root', async () => {
    expect(await storage.get(mediaKeyFor(PNG, 'image/jpeg'))).toBeNull();
    expect(await storage.get('../../etc/passwd')).toBeNull();
    await expect(storage.put('../escape.png', PNG, 'image/png')).rejects.toThrow(/Invalid media key/);
  });
});
