import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
export { chapters } from '../../shared/db/schema.js';
import { chapters } from '../../shared/db/schema.js';

export type Chapter = InferSelectModel<typeof chapters>;
export type NewChapter = InferInsertModel<typeof chapters>;