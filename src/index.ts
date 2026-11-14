import 'dotenv/config';
import { createServer } from 'node:http';
import { loadConfig } from './config/env.js';
import { createLogger } from './lib/logger.js';
import { createApp } from './app.js';
import { NoteRepository } from './modules/notes/note.repository.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);

  // Read stored notes before accepting traffic so the first request already
  // sees the full list, and so a corrupt file fails fast at startup.
  const noteRepository = new NoteRepository({ filePath: config.NOTES_FILE });
  await noteRepository.load();
  logger.info({ file: config.NOTES_FILE, notes: noteRepository.size }, 'loaded encrypted notes');

  const app = createApp({ config, logger, noteRepository });
  const server = createServer(app);

  server.listen(config.PORT, config.HOST, () => {
    logger.info(
      { host: config.HOST, port: config.PORT, env: config.NODE_ENV },
      `server listening on http://${config.HOST}:${config.PORT}`,
    );
  });

  // Stop accepting connections, then let in-flight requests finish before exit.
  const shutdown = (signal: NodeJS.Signals): void => {
    logger.info({ signal }, 'shutting down');

    const forceExit = setTimeout(() => {
      logger.error('graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, 10_000);
    forceExit.unref();

    server.close((error) => {
      clearTimeout(forceExit);

      if (error) {
        logger.error({ err: error }, 'error while closing server');
        process.exit(1);
      }

      logger.info('shutdown complete');
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'unhandled promise rejection');
    process.exit(1);
  });

  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'uncaught exception');
    process.exit(1);
  });
}

void main().catch((error: unknown) => {
  // Startup failed before the logger's handlers were installed, so report it
  // plainly and exit non-zero rather than surfacing an unhandled rejection.
  console.error('failed to start server:', error);
  process.exit(1);
});
