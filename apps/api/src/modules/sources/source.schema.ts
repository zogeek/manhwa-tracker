import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import { sources } from '../../shared/db/schema.js';

export { sources };

export type Source = InferSelectModel<typeof sources>;
export type NewSource = InferInsertModel<typeof sources>;
