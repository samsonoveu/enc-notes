/**
 * An error that carries an HTTP status code and a stable, machine-readable
 * error code. Anything else thrown inside a handler is treated as an
 * unexpected failure and reported as HTTP 500.
 */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;

    Error.captureStackTrace?.(this, HttpError);
  }

  static badRequest(message: string, details?: unknown): HttpError {
    return new HttpError(400, 'BAD_REQUEST', message, details);
  }

  static notFound(message = 'Resource not found', details?: unknown): HttpError {
    return new HttpError(404, 'NOT_FOUND', message, details);
  }

  static conflict(message: string, details?: unknown): HttpError {
    return new HttpError(409, 'CONFLICT', message, details);
  }

  static unprocessable(message: string, details?: unknown): HttpError {
    return new HttpError(422, 'UNPROCESSABLE_ENTITY', message, details);
  }

  static internal(message = 'Internal server error', details?: unknown): HttpError {
    return new HttpError(500, 'INTERNAL_ERROR', message, details);
  }
}

/** Narrow an unknown thrown value to a `HttpError`. */
export function isHttpError(error: unknown): error is HttpError {
  return error instanceof HttpError;
}
