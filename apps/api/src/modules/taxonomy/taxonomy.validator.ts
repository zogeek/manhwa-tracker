import { createInsertSchema } from 'drizzle-zod';
import { z } from 'zod';
import { manhwaTerms, terms, vocabularies } from './taxonomy.schema.js';

const slugSchema = z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, 'Slug : minuscules, chiffres et tirets');

export const createVocabularySchema = createInsertSchema(vocabularies, {
  slug: slugSchema,
  name: z.string().trim().min(1).max(100),
  description: z.string().max(1_000).nullish(),
}).pick({ slug: true, name: true, description: true, isHierarchical: true });

export const createTermSchema = createInsertSchema(terms, {
  vocabularyId: z.uuid(),
  parentId: z.uuid().nullish(),
  slug: slugSchema,
  name: z.string().trim().min(1).max(100),
  description: z.string().max(1_000).nullish(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Couleur hexadécimale attendue (#rrggbb)').nullish(),
}).pick({ vocabularyId: true, parentId: true, slug: true, name: true, description: true, color: true });

// Un terme ne change pas de vocabulaire ; `parentId: null` le remonte à la racine.
export const updateTermSchema = createTermSchema.omit({ vocabularyId: true }).partial();

export const tagManhwaSchema = createInsertSchema(manhwaTerms, {
  relevance: z.number().int().min(0).max(100).optional(),
}).pick({ relevance: true, isSpoiler: true });

export const vocabularySlugParamSchema = z.object({ slug: slugSchema });
export const termIdParamSchema = z.object({ id: z.uuid() });
export const manhwaIdParamSchema = z.object({ manhwaId: z.uuid() });
export const manhwaTermParamSchema = z.object({ manhwaId: z.uuid(), termId: z.uuid() });

export type CreateVocabularyInput = z.infer<typeof createVocabularySchema>;
export type CreateTermInput = z.infer<typeof createTermSchema>;
export type UpdateTermInput = z.infer<typeof updateTermSchema>;
export type TagManhwaInput = z.infer<typeof tagManhwaSchema>;
