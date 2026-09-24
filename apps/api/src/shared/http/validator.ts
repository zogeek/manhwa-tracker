import { zValidator } from '@hono/zod-validator';
import type { ValidationTargets } from 'hono';
import type { $ZodType } from 'zod/v4/core';
import { ValidationError } from '../lib/errors.js';

/**
 * `zValidator` avec le format d'erreur de l'application : l'échec est levé en `ValidationError`
 * puis sérialisé par le handler d'erreur global, au lieu de la réponse brute de Zod.
 */
export const validate = <Target extends keyof ValidationTargets, Schema extends $ZodType>(
  target: Target,
  schema: Schema,
) =>
  zValidator(target, schema, (result) => {
    if (!result.success) {
      throw new ValidationError(
        `Invalid request ${target}`,
        result.error.issues.map((issue) => ({
          path: issue.path.map(String).join('.'),
          message: issue.message,
        })),
      );
    }
  });
