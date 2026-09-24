import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import { genres } from '../../shared/db/schema.js';

export { genres };

export type Genre = InferSelectModel<typeof genres>;
export type NewGenre = InferInsertModel<typeof genres>;
