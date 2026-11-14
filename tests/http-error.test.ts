import { describe, expect, it } from 'vitest';
import { HttpError, isHttpError } from '../src/lib/http-error.js';

describe('HttpError', () => {
  it('captures status, code and message', () => {
    const error = HttpError.notFound('Note 42 not found');

    expect(error).toBeInstanceOf(Error);
    expect(error.status).toBe(404);
    expect(error.code).toBe('NOT_FOUND');
    expect(error.message).toBe('Note 42 not found');
  });

  it('keeps optional details', () => {
    const details = [{ path: 'title', message: 'required' }];
    const error = HttpError.badRequest('Invalid request body', details);

    expect(error.details).toEqual(details);
  });

  it('omits details when none are given', () => {
    expect(HttpError.internal().details).toBeUndefined();
  });

  it('is recognised by the type guard', () => {
    expect(isHttpError(HttpError.conflict('duplicate'))).toBe(true);
    expect(isHttpError(new Error('plain'))).toBe(false);
    expect(isHttpError('string')).toBe(false);
    expect(isHttpError(null)).toBe(false);
  });

  it('uses the documented status codes', () => {
    expect(HttpError.badRequest('x').status).toBe(400);
    expect(HttpError.notFound('x').status).toBe(404);
    expect(HttpError.conflict('x').status).toBe(409);
    expect(HttpError.unprocessable('x').status).toBe(422);
    expect(HttpError.internal().status).toBe(500);
  });
});
