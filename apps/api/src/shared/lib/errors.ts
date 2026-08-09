export class AppError extends Error {
  public readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
  }
}

export class NotFoundError extends AppError {
  constructor(entity: string, id: string) {
    super(404, `${entity} with id "${id}" not found`);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, message);
    this.name = 'ConflictError';
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(400, message);
    this.name = 'ValidationError';
  }
}
