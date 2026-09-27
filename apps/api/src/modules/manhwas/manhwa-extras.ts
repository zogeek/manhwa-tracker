import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm';
import type { DbClient } from '../../shared/db/index.js';
import { authors, manhwaAuthors, manhwaCovers, manhwas } from '../../shared/db/schema.js';
import { mediaUrl } from '../images/media.service.js';
import type { ManhwaExtras } from './manhwa.schema.js';

/**
 * Données d'affichage d'une LISTE de fiches (cartes, fiche détaillée, bibliothèque) :
 * - `authors` : via la table de liaison, dans l'ordre du catalogue d'origine ;
 * - `localCoverUrl` : copie locale de la couverture AFFICHÉE (`manhwas.cover_url`), si la tâche
 *   `cover.mirror` a réussi — chemin relatif à l'API (`/images/media/<sha256>.<ext>`).
 * Deux requêtes groupées (`WHERE manhwa_id IN …`), quelle que soit la taille de la liste : pas de N+1.
 */
export async function loadManhwaExtras(db: DbClient, ids: readonly string[]): Promise<Map<string, ManhwaExtras>> {
  const extras = new Map<string, ManhwaExtras>(ids.map((id) => [id, { authors: [], localCoverUrl: null }]));
  if (ids.length === 0) return extras;
  const idList = [...new Set(ids)];

  const [authorRows, coverRows] = await Promise.all([
    db
      .select({
        manhwaId: manhwaAuthors.manhwaId,
        name: authors.name,
        nativeName: authors.nativeName,
        role: manhwaAuthors.role,
      })
      .from(manhwaAuthors)
      .innerJoin(authors, eq(authors.id, manhwaAuthors.authorId))
      .where(inArray(manhwaAuthors.manhwaId, idList))
      .orderBy(asc(manhwaAuthors.manhwaId), asc(manhwaAuthors.position), asc(authors.name)),
    db
      .select({ manhwaId: manhwaCovers.manhwaId, storageKey: manhwaCovers.storageKey })
      .from(manhwaCovers)
      // La copie doit correspondre à la couverture actuellement affichée, pas à une ancienne.
      .innerJoin(manhwas, and(eq(manhwas.id, manhwaCovers.manhwaId), eq(manhwas.coverUrl, manhwaCovers.imageUrl)))
      .where(and(inArray(manhwaCovers.manhwaId, idList), isNotNull(manhwaCovers.storageKey))),
  ]);

  for (const { manhwaId, ...author } of authorRows) extras.get(manhwaId)?.authors.push(author);
  for (const { manhwaId, storageKey } of coverRows) {
    const entry = extras.get(manhwaId);
    if (entry && storageKey) entry.localCoverUrl = mediaUrl(storageKey);
  }
  return extras;
}

/** Ajoute auteurs et couverture locale à chaque fiche (ordre et champs d'origine conservés). */
export async function withManhwaExtras<T extends { id: string }>(db: DbClient, rows: readonly T[]): Promise<(T & ManhwaExtras)[]> {
  const extras = await loadManhwaExtras(
    db,
    rows.map((row) => row.id),
  );
  return rows.map((row) => ({ ...row, ...(extras.get(row.id) ?? { authors: [], localCoverUrl: null }) }));
}
