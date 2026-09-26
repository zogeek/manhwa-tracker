import { z } from 'zod';
import { systemClock, type Clock } from '../../shared/lib/clock.js';
import type { JobStore } from './job.repository.js';
import {
  JOB_PAYLOAD_SCHEMAS,
  PermanentJobError,
  type Job,
  type JobHandler,
  type JobPayloads,
  type JobType,
} from './job.types.js';

export type JobLogger = Pick<Console, 'info' | 'warn' | 'error'>;

export type JobWorkerOptions = {
  /** Identifiant unique du worker (hôte + pid) : trace qui détient une réservation. */
  workerId: string;
  /** Tâches réservées (et exécutées en parallèle) par tour de boucle. */
  batchSize?: number;
  /** Pause entre deux tours quand la file est vide. */
  pollIntervalMs?: number;
  /** Au-delà, une tâche `running` est jugée orpheline (worker planté) et reprise par un autre. */
  lockTimeoutMs?: number;
  /** Ré-essais exponentiels : base × 2^(tentative - 1), plafonné à `retryMaxMs`. */
  retryBaseMs?: number;
  retryMaxMs?: number;
  clock?: Clock;
  logger?: JobLogger;
};

const MAX_ERROR_LENGTH = 2_000;

/**
 * Worker interne à l'API : dépile la table `jobs` et délègue chaque tâche au handler de son type.
 * Plusieurs instances peuvent tourner en parallèle (réservation par `SKIP LOCKED`).
 */
export class JobWorker {
  private readonly handlers = new Map<string, JobHandler>();
  private readonly batchSize: number;
  private readonly pollIntervalMs: number;
  private readonly lockTimeoutMs: number;
  private readonly retryBaseMs: number;
  private readonly retryMaxMs: number;
  private readonly clock: Clock;
  private readonly logger: JobLogger;
  private timer: NodeJS.Timeout | null = null;
  private currentTick: Promise<void> | null = null;
  private stopped = true;

  constructor(
    private readonly store: JobStore,
    handlers: readonly JobHandler[],
    private readonly options: JobWorkerOptions,
  ) {
    for (const handler of handlers) {
      if (this.handlers.has(handler.type)) throw new Error(`Duplicate job handler for "${handler.type}"`);
      this.handlers.set(handler.type, handler);
    }
    this.batchSize = options.batchSize ?? 5;
    this.pollIntervalMs = options.pollIntervalMs ?? 2_000;
    this.lockTimeoutMs = options.lockTimeoutMs ?? 5 * 60_000;
    this.retryBaseMs = options.retryBaseMs ?? 30_000;
    this.retryMaxMs = options.retryMaxMs ?? 60 * 60_000;
    this.clock = options.clock ?? systemClock;
    this.logger = options.logger ?? console;
  }

  /** Un tour : réserve un lot, l'exécute, clôture chaque tâche. Renvoie le nombre de tâches traitées. */
  async runOnce(): Promise<number> {
    const now = this.clock();
    const claimed = await this.store.claim({
      workerId: this.options.workerId,
      limit: this.batchSize,
      now: new Date(now),
      staleBefore: new Date(now - this.lockTimeoutMs),
    });

    const results = await Promise.allSettled(claimed.map((job) => this.process(job)));
    for (const result of results) {
      // Clôture impossible (base indisponible…) : la réservation expirera et la tâche sera reprise.
      if (result.status === 'rejected') this.logger.error('[JOBS] failed to record a job outcome', result.reason);
    }
    return claimed.length;
  }

  /** Démarre la boucle de fond (idempotent). */
  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.logger.info(`[JOBS] worker ${this.options.workerId} started (${[...this.handlers.keys()].join(', ')})`);
    this.schedule(0);
  }

  /** Arrêt propre : plus de nouveau tour, attend la fin du tour en cours (tâches comprises). */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.currentTick;
  }

  private schedule(delayMs: number): void {
    this.timer = setTimeout(() => {
      this.currentTick = this.tick();
    }, delayMs);
  }

  private async tick(): Promise<void> {
    let processed = 0;
    try {
      processed = await this.runOnce();
    } catch (error) {
      this.logger.error('[JOBS] polling failed', error);
    }
    // Lot plein : il reste sans doute du travail, on enchaîne sans attendre.
    if (!this.stopped) this.schedule(processed >= this.batchSize ? 0 : this.pollIntervalMs);
  }

  private async process(job: Job): Promise<void> {
    try {
      await this.execute(job);
    } catch (error) {
      await this.fail(job, error);
      return;
    }
    await this.store.markSucceeded(job.id, this.options.workerId, new Date(this.clock()));
  }

  private async execute(job: Job): Promise<void> {
    const handler = this.handlers.get(job.type);
    if (!handler) throw new PermanentJobError(`No handler registered for job type "${job.type}"`);
    // Réservation expirée à répétition (la tâche fait planter ou bloquer le worker) : on abandonne.
    if (job.attempts > job.maxAttempts) throw new PermanentJobError('Lock expired on every attempt');

    const schema: z.ZodType<JobPayloads[JobType]> = JOB_PAYLOAD_SCHEMAS[handler.type];
    const payload = schema.safeParse(job.payload);
    if (!payload.success) throw new PermanentJobError(`Invalid payload: ${z.prettifyError(payload.error)}`);

    await handler.handle(payload.data, { jobId: job.id, attempt: job.attempts });
  }

  private async fail(job: Job, error: unknown): Promise<void> {
    const now = this.clock();
    const permanent = error instanceof PermanentJobError;
    const retryAt = !permanent && job.attempts < job.maxAttempts ? new Date(now + this.backoff(job.attempts)) : null;
    const message = describe(error);

    const log = `[JOBS] ${job.type} ${job.id} failed (attempt ${job.attempts}/${job.maxAttempts}): ${message}`;
    if (retryAt) this.logger.warn(`${log} — retry at ${retryAt.toISOString()}`);
    else this.logger.error(`${log} — giving up`);

    await this.store.markFailed(job.id, this.options.workerId, { error: message, retryAt, now: new Date(now) });
  }

  private backoff(attempt: number): number {
    return Math.min(this.retryBaseMs * 2 ** Math.max(0, attempt - 1), this.retryMaxMs);
  }
}

function describe(error: unknown): string {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return message.slice(0, MAX_ERROR_LENGTH);
}
