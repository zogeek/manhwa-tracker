import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import { manhwaTerms, termAliases, terms, vocabularies } from '../../shared/db/schema.js';

export { manhwaTerms, termAliases, terms, vocabularies };

export type Vocabulary = InferSelectModel<typeof vocabularies>;
export type NewVocabulary = InferInsertModel<typeof vocabularies>;
export type Term = InferSelectModel<typeof terms>;
export type NewTerm = InferInsertModel<typeof terms>;
export type ManhwaTerm = InferSelectModel<typeof manhwaTerms>;
export type NewManhwaTerm = InferInsertModel<typeof manhwaTerms>;

/** Tag d'une œuvre, avec le terme et son vocabulaire (pour grouper l'affichage). */
export type ManhwaTag = ManhwaTerm & { term: Term; vocabularySlug: string };
