import { and, eq } from 'drizzle-orm';
import type { DbClient } from '../../shared/db/index.js';
import { manhwaCovers } from '../../shared/db/schema.js';
import { firstOrNull } from '../../shared/db/utils.js';
import { systemClock, type Clock } from '../../shared/lib/clock.js';
import { BadRequestError, NotFoundError } from '../../shared/lib/errors.js';
import { mediaKeyFor, type MediaStorage } from '../../shared/storage/media-storage.js';
import { PermanentJobError, type JobHandler, type JobPayloads } from '../jobs/job.types.js';
import type { ImageProxyService } from './image-proxy.service.js';

export type CoverToMirror = { id: string; storageKey: string | null };

export interface CoverMirrorRepository {
  findCover(manhwaId: string, imageUrl: string): Promise<CoverToMirror | null>;
  markMirrored(coverId: string, storageKey: string, at: Date): Promise<void>;
}

export class DrizzleCoverMirrorRepository implements CoverMirrorRepository {
  constructor(private readonly db: DbClient) {}

  async findCover(manhwaId: string, imageUrl: string): Promise<CoverToMirror | null> {
    const rows = await this.db
      .select({ id: manhwaCovers.id, storageKey: manhwaCovers.storageKey })
      .from(manhwaCovers)
      .where(and(eq(manhwaCovers.manhwaId, manhwaId), eq(manhwaCovers.imageUrl, imageUrl)))
      .limit(1);
    return firstOrNull(rows);
  }

  async markMirrored(coverId: string, storageKey: string, at: Date): Promise<void> {
    await this.db.update(manhwaCovers).set({ storageKey, mirroredAt: at }).where(eq(manhwaCovers.id, coverId));
  }
}

/**
 * Tâche `cover.mirror` : copie locale d'une couverture tierce. Le téléchargement passe par le
 * proxy durci (liste blanche, HTTPS, taille et type contrôlés) : un job ne contourne jamais l'anti-SSRF.
 * Idempotente : une couverture déjà copiée (ou supprimée entre-temps) est ignorée.
 */
export class CoverMirrorJob implements JobHandler<'cover.mirror'> {
  readonly type: 'cover.mirror' = 'cover.mirror';

  constructor(
    private readonly covers: CoverMirrorRepository,
    private readonly images: Pick<ImageProxyService, 'fetchImage'>,
    private readonly storage: MediaStorage,
    private readonly clock: Clock = systemClock,
  ) {}

  async handle({ manhwaId, imageUrl }: JobPayloads['cover.mirror']): Promise<void> {
    const cover = await this.covers.findCover(manhwaId, imageUrl);
    if (!cover || cover.storageKey) return;

    const image = await this.images.fetchImage(imageUrl).catch((error: unknown) => {
      // Image disparue ou domaine refusé : ré-essayer ne changera rien.
      if (error instanceof NotFoundError || error instanceof BadRequestError) {
        throw new PermanentJobError(error.message, { cause: error });
      }
      throw error; // panne réseau, CDN en erreur… : ré-essai avec backoff
    });

    const key = mediaKeyFor(image.body, image.contentType);
    await this.storage.put(key, image.body, image.contentType);
    await this.covers.markMirrored(cover.id, key, new Date(this.clock()));
  }
}
