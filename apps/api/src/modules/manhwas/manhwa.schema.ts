import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import { authorRoleEnum, manhwas, manhwaStatusEnum, manhwaTypeEnum } from '../../shared/db/schema.js';

export { manhwas, manhwaStatusEnum, manhwaTypeEnum };

export type AuthorRole = (typeof authorRoleEnum.enumValues)[number];

/** Auteur tel qu'affiché : nom + rôle (scénario, dessin, les deux), dans l'ordre du catalogue d'origine. */
export type ManhwaAuthor = { name: string; nativeName: string | null; role: AuthorRole };

export type ManhwaExtras = {
  authors: ManhwaAuthor[];
  /** Copie locale de la couverture (`/images/media/…`), `null` tant que la tâche `cover.mirror` n'a pas réussi. */
  localCoverUrl: string | null;
};

export type Manhwa = InferSelectModel<typeof manhwas>;
export type NewManhwa = InferInsertModel<typeof manhwas>;

/** Résultat de la recherche floue : la fiche + son score de pertinence (0 → 1, pg_trgm). */
export type ManhwaSearchHit = ManhwaView & { score: number };

/** Fiche prête à afficher : colonnes de `manhwas` + auteurs + couverture locale. */
export type ManhwaView = Manhwa & ManhwaExtras;
