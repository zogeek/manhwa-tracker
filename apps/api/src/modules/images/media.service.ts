import { NotFoundError } from '../../shared/lib/errors.js';
import type { MediaStorage, StoredMedia } from '../../shared/storage/media-storage.js';

/**
 * URL (relative à l'API) d'un média copié localement : route `GET /images/media/:key`
 * (montée sous `/images` dans app.ts). Le front y accède via son proxy `/api/images/media/…`.
 */
export const mediaUrl = (key: string) => `/images/media/${key}`;

/** Lecture des médias copiés localement (couvertures miroir). */
export class MediaService {
  constructor(private readonly storage: MediaStorage) {}

  async getFile(key: string): Promise<StoredMedia> {
    const media = await this.storage.get(key);
    if (!media) throw new NotFoundError('Media', key);
    return media;
  }
}
