import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ClaimOptions, FailureOutcome, JobStore } from './job.repository.js';
import { PermanentJobError, type Job, type JobContext, type JobHandler, type JobPayloads } from './job.types.js';
import { JobWorker } from './job.worker.js';

const MANHWA_ID = randomUUID();
const silentLogger = { info: () => undefined, warn: () => undefined, error: () => undefined };

function buildJob(overrides: Partial<Job> = {}): Job {
  const now = new Date(0);
  return {
    id: randomUUID(),
    type: 'cover.mirror',
    payload: { manhwaId: MANHWA_ID, imageUrl: 'https://anilist.co/cover.jpg' },
    status: 'pending',
    attempts: 0,
    maxAttempts: 3,
    runAt: now,
    lockedAt: null,
    lockedBy: null,
    lastError: null,
    dedupeKey: null,
    createdAt: now,
    updatedAt: now,
    finishedAt: null,
    ...overrides,
  };
}

/** File en mémoire qui reproduit la sémantique de réservation du repository Drizzle. */
class InMemoryJobStore implements JobStore {
  readonly jobs = new Map<string, Job>();
  readonly outcomes: { id: string; status: 'succeeded' | 'retry' | 'failed'; outcome?: FailureOutcome }[] = [];

  add(job: Job): Job {
    this.jobs.set(job.id, job);
    return job;
  }

  async claim({ workerId, limit, now, staleBefore }: ClaimOptions): Promise<Job[]> {
    const ready = [...this.jobs.values()]
      .filter(
        (job) =>
          (job.status === 'pending' && job.runAt <= now) ||
          (job.status === 'running' && job.lockedAt !== null && job.lockedAt < staleBefore),
      )
      .slice(0, limit);
    return ready.map((job) => {
      const claimed: Job = { ...job, status: 'running', lockedAt: now, lockedBy: workerId, attempts: job.attempts + 1 };
      this.jobs.set(job.id, claimed);
      return claimed;
    });
  }

  async markSucceeded(id: string): Promise<void> {
    this.update(id, { status: 'succeeded' });
    this.outcomes.push({ id, status: 'succeeded' });
  }

  async markFailed(id: string, _workerId: string, outcome: FailureOutcome): Promise<void> {
    this.update(id, outcome.retryAt ? { status: 'pending', runAt: outcome.retryAt } : { status: 'failed' });
    this.outcomes.push({ id, status: outcome.retryAt ? 'retry' : 'failed', outcome });
  }

  private update(id: string, patch: Partial<Job>): void {
    const job = this.jobs.get(id);
    if (job) this.jobs.set(id, { ...job, ...patch, lastError: null });
  }
}

class RecordingHandler implements JobHandler<'cover.mirror'> {
  readonly type: 'cover.mirror' = 'cover.mirror';
  readonly calls: { payload: JobPayloads['cover.mirror']; context: JobContext }[] = [];
  failWith: Error | null = null;

  async handle(payload: JobPayloads['cover.mirror'], context: JobContext): Promise<void> {
    this.calls.push({ payload, context });
    if (this.failWith) throw this.failWith;
  }
}

let now: number;
let store: InMemoryJobStore;
let handler: RecordingHandler;
let worker: JobWorker;

beforeEach(() => {
  now = 1_000_000;
  store = new InMemoryJobStore();
  handler = new RecordingHandler();
  worker = new JobWorker(store, [handler], {
    workerId: 'worker-test',
    batchSize: 10,
    retryBaseMs: 1_000,
    retryMaxMs: 3_000,
    lockTimeoutMs: 60_000,
    clock: () => now,
    logger: silentLogger,
  });
});

describe('JobWorker.runOnce', () => {
  it('dispatches each job to the handler of its type with a validated payload', async () => {
    const job = store.add(buildJob());

    expect(await worker.runOnce()).toBe(1);

    expect(handler.calls).toEqual([
      { payload: { manhwaId: MANHWA_ID, imageUrl: 'https://anilist.co/cover.jpg' }, context: { jobId: job.id, attempt: 1 } },
    ]);
    expect(store.outcomes).toEqual([{ id: job.id, status: 'succeeded' }]);
  });

  it('retries a transient failure with exponential backoff, capped', async () => {
    handler.failWith = new Error('CDN timeout');
    const job = store.add(buildJob({ maxAttempts: 5 }));

    const delays: number[] = [];
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await worker.runOnce();
      const outcome = store.outcomes.at(-1)?.outcome;
      delays.push((outcome?.retryAt?.getTime() ?? 0) - now);
      now = outcome?.retryAt?.getTime() ?? now;
    }

    expect(delays).toEqual([1_000, 2_000, 3_000]);
    expect(store.outcomes.at(-1)?.outcome?.error).toBe('Error: CDN timeout');
    expect(store.jobs.get(job.id)?.status).toBe('pending');
  });

  it('does not run a job before its retry date', async () => {
    store.add(buildJob({ runAt: new Date(now + 5_000) }));

    expect(await worker.runOnce()).toBe(0);
    now += 5_000;
    expect(await worker.runOnce()).toBe(1);
  });

  it('gives up (dead-letter) once the attempts are exhausted', async () => {
    handler.failWith = new Error('still down');
    const job = store.add(buildJob({ maxAttempts: 2 }));

    await worker.runOnce();
    now += 10_000;
    await worker.runOnce();

    expect(store.outcomes.map((outcome) => outcome.status)).toEqual(['retry', 'failed']);
    expect(store.jobs.get(job.id)?.status).toBe('failed');
  });

  it('fails immediately on a permanent error, an invalid payload or an unknown type', async () => {
    handler.failWith = new PermanentJobError('image removed');
    store.add(buildJob());
    store.add(buildJob({ payload: { manhwaId: 'not-a-uuid', imageUrl: 'http://insecure.example' } }));
    store.add(buildJob({ type: 'unknown.task' }));

    await worker.runOnce();

    expect(store.outcomes.map((outcome) => outcome.status)).toEqual(['failed', 'failed', 'failed']);
    // Les tâches d'un lot s'exécutent en parallèle : l'ordre des clôtures n'est pas garanti.
    expect(store.outcomes.map((outcome) => outcome.outcome?.error)).toEqual(
      expect.arrayContaining([
        'PermanentJobError: image removed',
        expect.stringContaining('PermanentJobError: Invalid payload'),
        'PermanentJobError: No handler registered for job type "unknown.task"',
      ]),
    );
    // Seul le job valide a atteint le handler.
    expect(handler.calls).toHaveLength(1);
  });

  it('takes over a job whose worker died, but abandons one that keeps killing workers', async () => {
    const orphan = store.add(buildJob({ status: 'running', lockedBy: 'dead-worker', lockedAt: new Date(now - 120_000), attempts: 1 }));
    const poison = store.add(
      buildJob({ status: 'running', lockedBy: 'dead-worker', lockedAt: new Date(now - 120_000), attempts: 3, maxAttempts: 3 }),
    );

    await worker.runOnce();

    expect(store.jobs.get(orphan.id)?.status).toBe('succeeded');
    expect(store.jobs.get(poison.id)?.status).toBe('failed');
    expect(handler.calls).toHaveLength(1);
  });

  it('refuses two handlers for the same job type', () => {
    expect(() => new JobWorker(store, [handler, new RecordingHandler()], { workerId: 'w' })).toThrow(/Duplicate/);
  });
});

describe('JobWorker.start / stop', () => {
  it('polls in the background and stops gracefully', async () => {
    const realtime = new JobWorker(store, [handler], { workerId: 'bg', pollIntervalMs: 5, logger: silentLogger });
    store.add(buildJob({ runAt: new Date(0) }));

    realtime.start();
    await expect.poll(() => handler.calls.length).toBe(1);
    await realtime.stop();

    store.add(buildJob({ runAt: new Date(0) }));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(handler.calls).toHaveLength(1);
  });
});
