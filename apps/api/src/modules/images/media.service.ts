import { NotFoundError } from '../../shared/lib/errors.js';
import type { MediaStorage, StoredMedia } from '../../shared/storage/media-storage.js';

/** Lecture des médias copiés localement (couvertures miroir). */
export class MediaService {
  constructor(private readonly storage: MediaStorage) {}

  async getFile(key: string): Promise<StoredMedia> {
    const media = await this.storage.get(key);
    if (!media) throw new NotFoundError('Media', key);
    return media;
  }
}
