import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import { readingListItems, readingLists } from '../../shared/db/schema.js';

export { readingListItems, readingLists };

export type ReadingList = InferSelectModel<typeof readingLists>;
export type NewReadingList = InferInsertModel<typeof readingLists>;
export type ReadingListItem = InferSelectModel<typeof readingListItems>;
export type NewReadingListItem = InferInsertModel<typeof readingListItems>;
export type ReadingListWithItems = ReadingList & { items: ReadingListItem[] };
