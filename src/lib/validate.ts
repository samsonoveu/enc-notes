import type { z } from 'zod';
import { HttpError } from './http-error.js';

/**
 * Parse and validate request input, turning a schema mismatch into a 400
 * response that lists the offending fields.
 */
export function parseOrThrow<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  input: unknown,
  label: string,
): z.infer<TSchema> {
  const result = schema.safeParse(input);

  if (!result.success) {
    throw HttpError.badRequest(
      `Invalid ${label}`,
      result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    );
  }

  return result.data as z.infer<TSchema>;
}
