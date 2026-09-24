import { createInsertSchema } from 'drizzle-zod';
import { z } from 'zod';
import { readingListItems, readingLists } from './reading-list.schema.js';

export const createReadingListSchema = createInsertSchema(readingLists, {
  name: z.string().trim().min(1).max(100),
  description: z.string().max(1_000).nullish(),
  color: z.string().max(32).nullish(),
  icon: z.string().max(64).nullish(),
  // Une surcharge Zod remplace la colonne : on restitue l'optionalité due au DEFAULT SQL.
  sortOrder: z.number().int().nonnegative().optional(),
}).pick({ name: true, description: true, color: true, icon: true, sortOrder: true });

export const updateReadingListSchema = createReadingListSchema.partial();

export const addListItemSchema = createInsertSchema(readingListItems, {
  manhwaId: z.uuid(),
  sortOrder: z.number().int().nonnegative().optional(),
}).pick({ manhwaId: true, sortOrder: true });

export const listIdParamSchema = z.object({
  id: z.uuid(),
});

export const listItemParamSchema = z.object({
  id: z.uuid(),
  manhwaId: z.uuid(),
});

export type CreateReadingListInput = z.infer<typeof createReadingListSchema>;
export type UpdateReadingListInput = z.infer<typeof updateReadingListSchema>;
export type AddListItemInput = z.infer<typeof addListItemSchema>;
