import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
export { genres } from '../../shared/db/schema.js';
import { genres } from '../../shared/db/schema.js';

export type Genre = InferSelectModel<typeof genres>;
export type NewGenre = InferInsertModel<typeof genres>;
