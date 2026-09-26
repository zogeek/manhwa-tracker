import type { ContentfulStatusCode } from 'hono/utils/http-status';

export type ErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_FAILED'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'UNPROCESSABLE_ENTITY'
  | 'PAYLOAD_TOO_LARGE'
  | 'INTERNAL_ERROR'
  | 'BAD_GATEWAY'
  | 'SERVICE_UNAVAILABLE';

export type ErrorDetail = {
  path: string;
  message: string;
};

/** Erreur applicative : porte un code machine stable, un statut HTTP et des détails optionnels. */
export class AppError extends Error {
  constructor(
    public readonly status: ContentfulStatusCode,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: readonly ErrorDetail[],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Bad request', options?: ErrorOptions) {
    super(400, 'BAD_REQUEST', message, undefined, options);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: readonly ErrorDetail[]) {
    super(400, 'VALIDATION_FAILED', message, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(401, 'UNAUTHORIZED', message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(403, 'FORBIDDEN', message);
  }
}

export class NotFoundError extends AppError {
  constructor(entity: string, id: string) {
    super(404, 'NOT_FOUND', `${entity} with id "${id}" not found`);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, options?: ErrorOptions) {
    super(409, 'CONFLICT', message, undefined, options);
  }
}

export class UnprocessableEntityError extends AppError {
  constructor(message: string, options?: ErrorOptions) {
    super(422, 'UNPROCESSABLE_ENTITY', message, undefined, options);
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(message = 'Payload too large') {
    super(413, 'PAYLOAD_TOO_LARGE', message);
  }
}

/** Un service tiers (AniList, CDN d'images…) a répondu une erreur ou une donnée invalide. */
export class BadGatewayError extends AppError {
  constructor(message: string, options?: ErrorOptions) {
    super(502, 'BAD_GATEWAY', message, undefined, options);
  }
}

/** Un service tiers est temporairement indisponible pour nous (quota de requêtes atteint…). */
export class ServiceUnavailableError extends AppError {
  constructor(message: string, options?: ErrorOptions) {
    super(503, 'SERVICE_UNAVAILABLE', message, undefined, options);
  }
}
