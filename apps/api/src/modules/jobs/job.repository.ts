import { and, asc, eq, inArray, lt, lte, or, sql } from 'drizzle-orm';
import type { DbClient } from '../../shared/db/index.js';
import { jobs } from '../../shared/db/schema.js';
import type { Job, JobRequest } from './job.types.js';

export type ClaimOptions = {
  workerId: string;
  limit: number;
  now: Date;
  /** Une tâche `running` réservée avant cette date est considérée orpheline (worker mort) et reprise. */
  staleBefore: Date;
};

export type FailureOutcome = {
  error: string;
  /** `null` : abandon définitif (`failed`) ; sinon remise en file pour cette date. */
  retryAt: Date | null;
  now: Date;
};

/** Côté producteur : mise en file (à appeler dans la transaction de l'écriture métier). */
export interface JobQueue {
  /** Renvoie le nombre de tâches réellement créées (les doublons actifs par `dedupeKey` sont ignorés). */
  enqueue(requests: readonly JobRequest[]): Promise<number>;
}

/** Côté worker : réservation et clôture des tâches. */
export interface JobStore {
  claim(options: ClaimOptions): Promise<Job[]>;
  markSucceeded(id: string, workerId: string, now: Date): Promise<void>;
  markFailed(id: string, workerId: string, outcome: FailureOutcome): Promise<void>;
}

export class DrizzleJobRepository implements JobQueue, JobStore {
  constructor(private readonly db: DbClient) {}

  async enqueue(requests: readonly JobRequest[]): Promise<number> {
    if (requests.length === 0) return 0;
    const inserted = await this.db
      .insert(jobs)
      .values(
        requests.map((request) => ({
          type: request.type,
          payload: request.payload,
          dedupeKey: request.dedupeKey ?? null,
          ...(request.runAt ? { runAt: request.runAt } : {}),
          ...(request.maxAttempts ? { maxAttempts: request.maxAttempts } : {}),
        })),
      )
      // Cible = l'index unique partiel des tâches actives (le prédicat doit être répété).
      .onConflictDoNothing({
        target: jobs.dedupeKey,
        where: sql`${jobs.dedupeKey} IS NOT NULL AND ${jobs.status} IN ('pending', 'running')`,
      })
      .returning({ id: jobs.id });
    return inserted.length;
  }

  /**
   * Réserve jusqu'à `limit` tâches en une seule requête atomique :
   *   UPDATE jobs SET status = 'running' … WHERE id IN (
   *     SELECT id FROM jobs WHERE <prête> ORDER BY run_at LIMIT n FOR UPDATE SKIP LOCKED
   *   ) RETURNING *
   * `SKIP LOCKED` : les lignes déjà verrouillées par un autre worker sont sautées au lieu
   * de faire attendre ; deux workers concurrents obtiennent donc des lots disjoints.
   */
  async claim({ workerId, limit, now, staleBefore }: ClaimOptions): Promise<Job[]> {
    const ready = this.db
      .select({ id: jobs.id })
      .from(jobs)
      .where(
        or(
          and(eq(jobs.status, 'pending'), lte(jobs.runAt, now)),
          and(eq(jobs.status, 'running'), lt(jobs.lockedAt, staleBefore)),
        ),
      )
      .orderBy(asc(jobs.runAt))
      .limit(limit)
      .for('update', { skipLocked: true });

    return this.db
      .update(jobs)
      .set({
        status: 'running',
        lockedAt: now,
        lockedBy: workerId,
        attempts: sql`${jobs.attempts} + 1`,
      })
      .where(inArray(jobs.id, ready))
      .returning();
  }

  // Les clôtures vérifient `locked_by` : un worker dont la réservation a expiré (et a été reprise
  // par un autre) ne peut pas écraser le résultat du nouveau propriétaire.
  async markSucceeded(id: string, workerId: string, now: Date): Promise<void> {
    await this.db
      .update(jobs)
      .set({ status: 'succeeded', finishedAt: now, lockedAt: null, lockedBy: null, lastError: null })
      .where(this.ownedBy(id, workerId));
  }

  async markFailed(id: string, workerId: string, { error, retryAt, now }: FailureOutcome): Promise<void> {
    await this.db
      .update(jobs)
      .set(
        retryAt
          ? { status: 'pending', runAt: retryAt, lockedAt: null, lockedBy: null, lastError: error }
          : { status: 'failed', finishedAt: now, lockedAt: null, lockedBy: null, lastError: error },
      )
      .where(this.ownedBy(id, workerId));
  }

  private ownedBy(id: string, workerId: string) {
    return and(eq(jobs.id, id), eq(jobs.status, 'running'), eq(jobs.lockedBy, workerId));
  }
}
