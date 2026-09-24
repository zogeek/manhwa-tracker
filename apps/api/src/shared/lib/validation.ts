import { z } from 'zod';

/** Numéro de chapitre : `numeric(8,2)` en base (0 = prologue, 10.5 = chapitre bonus). */
export const chapterNumberSchema = z.number().nonnegative().max(999_999.99).multipleOf(0.01);
