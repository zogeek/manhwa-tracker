import type { ErrorHandler, NotFoundHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { mapDatabaseError } from '../db/errors.js';
import { AppError, type ErrorCode, type ErrorDetail } from '../lib/errors.js';
import type { AppEnv } from './types.js';

/** Format de réponse unique pour les erreurs. */
export type ApiErrorBody = {
  error: {
    code: ErrorCode;
    message: string;
    details?: readonly ErrorDetail[];
  };
};

const HTTP_EXCEPTION_CODES: Partial<Record<number, ErrorCode>> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'UNPROCESSABLE_ENTITY',
};

function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;

  const databaseError = mapDatabaseError(error);
  if (databaseError) return databaseError;

  // Levées par Hono lui-même (ex. JSON malformé dans le body).
  if (error instanceof HTTPException) {
    const code = HTTP_EXCEPTION_CODES[error.status];
    if (code) return new AppError(error.status, code, error.message, undefined, { cause: error });
  }

  return new AppError(500, 'INTERNAL_ERROR', 'Internal server error', undefined, { cause: error });
}

export const errorHandler: ErrorHandler<AppEnv> = (error, c) => {
  const appError = toAppError(error);

  if (appError.status >= 500) {
    console.error('[UNHANDLED_ERROR]', { requestId: c.get('requestId'), error });
  }

  const body: ApiErrorBody = {
    error: {
      code: appError.code,
      message: appError.message,
      ...(appError.details ? { details: appError.details } : {}),
    },
  };
  return c.json(body, appError.status);
};

export const notFoundHandler: NotFoundHandler<AppEnv> = (c) => {
  const body: ApiErrorBody = {
    error: { code: 'NOT_FOUND', message: `Route ${c.req.method} ${c.req.path} not found` },
  };
  return c.json(body, 404);
};
