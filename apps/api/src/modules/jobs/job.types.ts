import type { InferSelectModel } from 'drizzle-orm';
import { z } from 'zod';
import type { jobs } from '../../shared/db/schema.js';
import { EXTERNAL_PROVIDERS } from '../discovery/external-catalog.js';

export type Job = InferSelectModel<typeof jobs>;

// Catalogue des tâches : type → forme du payload. C'est le contrat entre les producteurs
// (qui mettent en file) et les handlers (qui exécutent). Le payload est revalidé à l'exécution :
// une ligne jsonb reste une donnée externe (Zero Trust), même écrite par nous.
export const JOB_PAYLOAD_SCHEMAS = {
  /** Copie locale d'une couverture tierce (téléchargée via le proxy anti-SSRF). */
  'cover.mirror': z.object({
    manhwaId: z.uuid(),
    imageUrl: z.url({ protocol: /^https$/ }),
  }),
  /** Synchronisation des chapitres d'une œuvre depuis le flux d'un fournisseur externe. */
  'chapters.sync': z.object({
    manhwaId: z.uuid(),
    provider: z.enum(EXTERNAL_PROVIDERS),
    externalId: z.string().min(1).max(64),
  }),
};

export type JobType = keyof typeof JOB_PAYLOAD_SCHEMAS;
export type JobPayloads = { [T in JobType]: z.infer<(typeof JOB_PAYLOAD_SCHEMAS)[T]> };

type JobRequestOf<T extends JobType> = {
  type: T;
  payload: JobPayloads[T];
  /** Tant qu'une tâche avec cette clé est en attente ou en cours, une nouvelle demande est ignorée. */
  dedupeKey?: string;
  /** Exécution différée (défaut : dès que possible). */
  runAt?: Date;
  maxAttempts?: number;
};

/** Demande de mise en file, typée : le payload correspond forcément au type de tâche. */
export type JobRequest = { [T in JobType]: JobRequestOf<T> }[JobType];

export type JobContext = { jobId: string; attempt: number };

/**
 * Stratégie d'exécution d'un type de tâche. Le worker ne connaît que cette interface :
 * ajouter un type de tâche = écrire un handler et l'enregistrer dans la composition root.
 * Livraison « au moins une fois » : un handler doit être idempotent (rejouable sans effet de bord).
 */
export interface JobHandler<T extends JobType = JobType> {
  readonly type: T;
  handle(payload: JobPayloads[T], context: JobContext): Promise<void>;
}

/** Échec définitif : la tâche part directement en `failed`, sans ré-essai (ré-essayer ne changerait rien). */
export class PermanentJobError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'PermanentJobError';
  }
}
