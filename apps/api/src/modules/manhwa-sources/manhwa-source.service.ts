import { ForbiddenError, NotFoundError, UnprocessableEntityError } from '../../shared/lib/errors.js';
import type { ManhwaSourceRepository } from './manhwa-source.repository.js';
import type { ManhwaSource } from './manhwa-source.schema.js';
import type { UpdateManhwaSourceUrlInput } from './manhwa-source.validator.js';

/** Auteur d'une correction, tel qu'établi par la session (jamais par le client). */
export type Editor = { id: string; isAdmin: boolean };

const hostOf = (url: string) => new URL(url).hostname.replace(/^www\./, '');

export class ManhwaSourceService {
  constructor(private readonly repo: ManhwaSourceRepository) {}

  /**
   * Corrige l'URL d'une œuvre sur une source (le Dorking s'est trompé de fiche).
   * Le lien est partagé par tous les lecteurs : seuls ceux qui suivent l'œuvre, ou un admin, peuvent le corriger.
   */
  async updateUrl(
    manhwaId: string,
    sourceId: string,
    { manhwaUrl }: UpdateManhwaSourceUrlInput,
    editor: Editor,
  ): Promise<ManhwaSource> {
    const link = await this.repo.findLink(manhwaId, sourceId);
    if (!link) throw new NotFoundError('Manhwa source link', `${manhwaId}/${sourceId}`);

    if (!editor.isAdmin && !(await this.repo.isFollowedBy(manhwaId, editor.id))) {
      throw new ForbiddenError('You can only correct a series you follow');
    }

    // Le worker visite cette URL telle quelle : elle doit rester sur le site de la source
    // (sinon il irait sur un hôte dont personne n'a vérifié le robots.txt).
    if (manhwaUrl !== null && hostOf(manhwaUrl) !== hostOf(link.sourceBaseUrl)) {
      throw new UnprocessableEntityError(`The URL must belong to the source site (${new URL(link.sourceBaseUrl).hostname})`);
    }

    const updated = await this.repo.updateUrl(manhwaId, sourceId, manhwaUrl);
    if (!updated) throw new NotFoundError('Manhwa source link', `${manhwaId}/${sourceId}`);
    return updated;
  }
}
