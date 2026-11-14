import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import type { Express } from 'express';
import cors from 'cors';
import { pinoHttp } from 'pino-http';
import type { AppConfig } from './config/env.js';
import type { Logger } from './lib/logger.js';
import { createErrorHandler, notFoundHandler } from './middleware/error-handler.js';
import { createHealthRouter } from './routes/health.routes.js';
import { createNotesRouter } from './modules/notes/note.routes.js';
import { NoteRepository } from './modules/notes/note.repository.js';

/** Repository for notes. Injected by tests to share state with assertions. */
export interface AppDependencies {
  readonly config: AppConfig;
  readonly logger: Logger;
  readonly noteRepository?: NoteRepository;
}

/** Directory holding the compiled module, used to locate the web client. */
const here = dirname(fileURLToPath(import.meta.url));

/**
 * Locate the static web client.
 *
 * In development this module lives in `src/`, so the client is one level up in
 * `public/`. A production build bundles into `dist/` and tsup copies the
 * client's *contents* next to the bundle, so it is `dist/` itself. Checking
 * for a marker file keeps both layouts working without an env toggle.
 */
function resolvePublicDir(): string {
  const candidates = [
    join(here, '..', 'public'), // src/ -> public/
    join(here, '..'), // dist/ -> dist/
    here, // dist/ when nested
  ];

  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'index.html'))) {
      return candidate;
    }
  }

  return candidates[0] as string;
}

const publicDir = resolvePublicDir();

/**
 * Version reported by the health endpoint, read from the nearest package.json
 * so it always matches the published metadata and cannot drift.
 */
const APP_VERSION = readVersion();

function readVersion(): string {
  const candidates = [join(here, '..', 'package.json'), join(here, '..', '..', 'package.json')];

  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(candidate, 'utf8'));

      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        typeof (parsed as { version?: unknown }).version === 'string'
      ) {
        return (parsed as { version: string }).version;
      }
    } catch {
      // Try the next candidate; an unreadable package.json is not fatal.
    }
  }

  return '0.0.0';
}

/**
 * Compose the Express application. Kept free of `listen` so that tests can
 * drive it in-process with supertest.
 */
export function createApp({ config, logger, noteRepository }: AppDependencies): Express {
  const app = express();
  const notes = noteRepository ?? new NoteRepository({ filePath: config.NOTES_FILE });

  app.disable('x-powered-by');
  app.use(pinoHttp({ logger, autoLogging: !config.isTest }));
  app.use(
    cors({
      origin: config.corsAllowAll ? true : [...config.corsOrigins],
      credentials: !config.corsAllowAll,
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));

  app.use('/api', createHealthRouter(APP_VERSION));
  app.use('/api/notes', createNotesRouter(notes));

  // The web client is served from the same origin as the API, so no CORS
  // configuration is needed in the browser and cookies would work if added.
  app.use(express.static(publicDir, { extensions: ['html'] }));

  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));

  return app;
}
