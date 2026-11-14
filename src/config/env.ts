import { z } from 'zod';

/**
 * Environment variable schema. Parsing happens once at startup so that a
 * misconfigured deployment fails fast, with a readable message, instead of
 * throwing somewhere deep inside a request handler.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().max(65535).default(3000),
  HOST: z.string().min(1).default('127.0.0.1'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  CORS_ORIGIN: z.string().default('*'),
  NOTES_FILE: z.string().min(1).default('data/notes.json'),
});

export type Env = z.infer<typeof envSchema>;

export interface AppConfig extends Env {
  /** `true` when CORS should accept requests from any origin. */
  readonly corsAllowAll: boolean;
  /** Explicit list of allowed origins; empty when `corsAllowAll` is set. */
  readonly corsOrigins: readonly string[];
  readonly isProduction: boolean;
  readonly isTest: boolean;
}

/**
 * Parse an environment object into a validated, immutable config.
 *
 * @throws {Error} when a variable is present but invalid.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  const values = parsed.data;
  const corsOrigins = values.CORS_ORIGIN.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  return Object.freeze({
    ...values,
    corsAllowAll: corsOrigins.includes('*'),
    corsOrigins,
    isProduction: values.NODE_ENV === 'production',
    isTest: values.NODE_ENV === 'test',
  });
}
