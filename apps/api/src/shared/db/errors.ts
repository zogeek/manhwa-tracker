import { DatabaseError } from 'pg';
import {
  AppError,
  BadRequestError,
  ConflictError,
  UnprocessableEntityError,
} from '../lib/errors.js';

/** Codes SQLSTATE Postgres traduits en erreurs applicatives. */
const PG_ERROR = {
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  NOT_NULL_VIOLATION: '23502',
  CHECK_VIOLATION: '23514',
  INVALID_TEXT_REPRESENTATION: '22P02',
  NUMERIC_VALUE_OUT_OF_RANGE: '22003',
} as const;

/** Remonte la chaîne `cause` (Drizzle enveloppe les erreurs pg dans `DrizzleQueryError`). */
function findDatabaseError(error: unknown): DatabaseError | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
    if (current instanceof DatabaseError) return current;
    current = current.cause;
  }
  return undefined;
}

/** Traduit une violation de contrainte Postgres en `AppError`, ou `undefined` si l'erreur n'est pas mappable. */
export function mapDatabaseError(error: unknown): AppError | undefined {
  const dbError = findDatabaseError(error);
  if (!dbError) return undefined;

  const options = { cause: error };
  switch (dbError.code) {
    case PG_ERROR.UNIQUE_VIOLATION:
      return new ConflictError('Resource already exists', options);
    case PG_ERROR.FOREIGN_KEY_VIOLATION:
      return new UnprocessableEntityError('Referenced resource does not exist', options);
    case PG_ERROR.NOT_NULL_VIOLATION:
    case PG_ERROR.CHECK_VIOLATION:
    case PG_ERROR.INVALID_TEXT_REPRESENTATION:
    case PG_ERROR.NUMERIC_VALUE_OUT_OF_RANGE:
      return new BadRequestError('Invalid data', options);
    default:
      return undefined;
  }
}
