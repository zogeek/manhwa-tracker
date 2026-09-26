import { describe, expect, it } from 'vitest';
import { TokenBucket } from './rate-limiter.js';

describe('TokenBucket', () => {
  it('allows a burst up to capacity, then refills over time', () => {
    let now = 0;
    const bucket = new TokenBucket({ capacity: 2, refillPerMinute: 60, clock: () => now });

    expect([bucket.tryTake(), bucket.tryTake(), bucket.tryTake()]).toEqual([true, true, false]);

    now += 1_000; // 60/min ⇒ 1 jeton par seconde
    expect(bucket.tryTake()).toBe(true);
    expect(bucket.tryTake()).toBe(false);
  });

  it('never exceeds its capacity after a long idle period', () => {
    let now = 0;
    const bucket = new TokenBucket({ capacity: 1, refillPerMinute: 60, clock: () => now });

    now += 3_600_000;
    expect([bucket.tryTake(), bucket.tryTake()]).toEqual([true, false]);
  });
});
