import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { HttpError, isHttpError } from '../lib/http-error.js';
import type { Logger } from '../lib/logger.js';

/** Shape of every error response the API emits. */
export interface ErrorResponseBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: unknown;
  };
}

/** Route that never matched any handler. */
export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(HttpError.notFound(`Cannot ${req.method} ${req.originalUrl}`));
};

/**
 * Convert any thrown value into a consistent JSON error response.
 *
 * Express identifies error-handling middleware by its four parameters, so the
 * unused `next` must stay in the signature.
 */
export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, req, res, _next): void => {
    const httpError = normalizeError(error);

    if (httpError.status >= 500) {
      logger.error({ err: error, path: req.originalUrl }, 'request failed');
    } else {
      logger.warn(
        { code: httpError.code, path: req.originalUrl, status: httpError.status },
        'request rejected',
      );
    }

    const body: ErrorResponseBody = {
      error: {
        code: httpError.code,
        message: httpError.message,
        ...(httpError.details === undefined ? {} : { details: httpError.details }),
      },
    };

    res.status(httpError.status).json(body);
  };
}

/** Map a thrown value onto an `HttpError` without leaking internals. */
function normalizeError(error: unknown): HttpError {
  if (isHttpError(error)) {
    return error;
  }

  if (error instanceof ZodError) {
    return HttpError.badRequest(
      'Request validation failed',
      error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    );
  }

  return HttpError.internal();
}
