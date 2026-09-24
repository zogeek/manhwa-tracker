import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import { chapters } from '../../shared/db/schema.js';

export { chapters };

export type Chapter = InferSelectModel<typeof chapters>;
export type NewChapter = InferInsertModel<typeof chapters>;
