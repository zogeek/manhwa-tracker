import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import { chapterReleases, chapters, scanlationGroups } from '../../shared/db/schema.js';

export { chapters };

export type Chapter = InferSelectModel<typeof chapters>;
export type NewChapter = InferInsertModel<typeof chapters>;

/** Team créditée sur une parution, dans l'ordre de crédit de la source (team principale en tête). */
export type ReleaseTeam = Pick<InferSelectModel<typeof scanlationGroups>, 'id' | 'name' | 'websiteUrl'>;

/** Parution d'un chapitre telle qu'affichée au lecteur : où la lire, en quelle langue, par qui. */
export type ChapterReleaseSummary = Pick<InferSelectModel<typeof chapterReleases>, 'id' | 'url' | 'language'> & {
  sourceName: string;
  /** Vide quand la source ne crédite aucune team. */
  teams: ReleaseTeam[];
};

export type ChapterWithReleases = Chapter & { releases: ChapterReleaseSummary[] };
