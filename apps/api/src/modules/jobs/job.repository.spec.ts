import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { createDatabase } from '../../shared/db/index.js';
import { jobs } from '../../shared/db/schema.js';
import { resetDatabase } from '../../shared/db/seed.test.js';
import { DrizzleJobRepository } from './job.repository.js';
import type { JobRequest } from './job.types.js';

// Intégration sur le vrai Postgres de test : la sémantique de verrouillage ne se simule pas.
const database = createDatabase(inject('databaseUrl'));
const repo = new DrizzleJobRepository(database.db);

afterAll(() => database.close());
beforeEach(() => resetDatabase(database.db));

const coverJob = (dedupeKey?: string): JobRequest => ({
  type: 'cover.mirror',
  payload: { manhwaId: randomUUID(), imageUrl: 'https://anilist.co/cover.jpg' },
  ...(dedupeKey ? { dedupeKey } : {}),
});

const claimOptions = (workerId: string, limit: number) => {
  const now = new Date();
  return { workerId, limit, now, staleBefore: new Date(now.getTime() - 60_000) };
};

describe('DrizzleJobRepository.claim (FOR UPDATE SKIP LOCKED)', () => {
  it('skips rows locked by another open transaction instead of waiting for them', async () => {
    await repo.enqueue([coverJob(), coverJob(), coverJob()]);

    await database.db.transaction(async (tx) => {
      // Worker A réserve 2 tâches et garde sa transaction ouverte (verrous tenus).
      const lockedByA = await new DrizzleJobRepository(tx).claim(claimOptions('worker-a', 2));
      // Worker B passe pendant ce temps : sans SKIP LOCKED il resterait bloqué (et ce test aussi).
      const lockedByB = await repo.claim(claimOptions('worker-b', 5));

      expect(lockedByA).toHaveLength(2);
      expect(lockedByB).toHaveLength(1);
      expect(lockedByA.map((job) => job.id)).not.toContain(lockedByB[0]?.id);
    });
  });

  it('never hands the same job to two concurrent workers', async () => {
    await repo.enqueue(Array.from({ length: 40 }, () => coverJob()));

    const batches = await Promise.all(
      ['w1', 'w2', 'w3', 'w4'].map((workerId) => new DrizzleJobRepository(database.db).claim(claimOptions(workerId, 15))),
    );

    const ids = batches.flat().map((job) => job.id);
    expect(ids).toHaveLength(40);
    expect(new Set(ids).size).toBe(40);
    const rows = await database.db.select().from(jobs);
    expect(rows.every((row) => row.status === 'running' && row.attempts === 1)).toBe(true);
  });

  it('ignores jobs scheduled in the future and takes over expired locks', async () => {
    const future = new Date(Date.now() + 60_000);
    await repo.enqueue([{ ...coverJob(), runAt: future }]);
    const [orphan] = await database.db
      .insert(jobs)
      .values({ type: 'cover.mirror', payload: {}, status: 'running', lockedBy: 'dead', lockedAt: new Date(0), attempts: 1 })
      .returning();

    const claimed = await repo.claim(claimOptions('alive', 10));

    expect(claimed.map((job) => job.id)).toEqual([orphan?.id]);
    expect(claimed[0]).toMatchObject({ lockedBy: 'alive', attempts: 2 });
  });
});

describe('DrizzleJobRepository.enqueue', () => {
  it('ignores a job whose dedupe key is already pending or running', async () => {
    expect(await repo.enqueue([coverJob('cover:1'), coverJob('cover:1'), coverJob()])).toBe(2);
    expect(await repo.enqueue([coverJob('cover:1')])).toBe(0);

    await repo.claim(claimOptions('w', 10)); // désormais `running` : toujours dédoublonnée
    expect(await repo.enqueue([coverJob('cover:1')])).toBe(0);
    expect(await database.db.select().from(jobs).where(eq(jobs.dedupeKey, 'cover:1'))).toHaveLength(1);
  });

  it('lets a finished dedupe key be enqueued again', async () => {
    await repo.enqueue([coverJob('sync:1')]);
    const [claimed] = await repo.claim(claimOptions('w', 1));
    if (!claimed) throw new Error('expected a claimed job');
    await repo.markSucceeded(claimed.id, 'w', new Date());

    expect(await repo.enqueue([coverJob('sync:1')])).toBe(1);
  });
});

describe('DrizzleJobRepository outcomes', () => {
  it('records retries and dead-letters, only for the worker that owns the lock', async () => {
    await repo.enqueue([coverJob(), coverJob()]);
    const [first, second] = await repo.claim(claimOptions('owner', 2));
    if (!first || !second) throw new Error('expected two claimed jobs');
    const retryAt = new Date(Date.now() + 30_000);

    await repo.markFailed(first.id, 'owner', { error: 'timeout', retryAt, now: new Date() });
    await repo.markFailed(second.id, 'owner', { error: 'gone', retryAt: null, now: new Date() });
    // Un worker qui ne détient pas la réservation n'a aucun effet.
    await repo.markSucceeded(second.id, 'intruder', new Date());

    const rows = new Map((await database.db.select().from(jobs)).map((row) => [row.id, row]));
    expect(rows.get(first.id)).toMatchObject({ status: 'pending', runAt: retryAt, lockedBy: null, lastError: 'timeout' });
    expect(rows.get(second.id)).toMatchObject({ status: 'failed', lastError: 'gone', lockedBy: null });
    expect(rows.get(second.id)?.finishedAt).toBeInstanceOf(Date);
  });
});
