import { describe, expect, it } from 'vitest';
import { TtlCache } from './ttl-cache.js';

function createCache(maxEntries = 10) {
  let now = 0;
  const cache = new TtlCache<string>({ ttlMs: 1_000, maxEntries, clock: () => now });
  return { cache, advance: (ms: number) => (now += ms) };
}

describe('TtlCache', () => {
  it('returns a value until it expires', () => {
    const { cache, advance } = createCache();
    cache.set('q', 'result');

    advance(999);
    expect(cache.get('q')).toBe('result');
    advance(1);
    expect(cache.get('q')).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('evicts the least recently used entry beyond maxEntries', () => {
    const { cache } = createCache(2);
    cache.set('a', 'A');
    cache.set('b', 'B');
    cache.get('a'); // « a » redevient récent : « b » est le plus ancien
    cache.set('c', 'C');

    expect(cache.get('a')).toBe('A');
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('c')).toBe('C');
  });
});
