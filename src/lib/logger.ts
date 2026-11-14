import pino from 'pino';
import type { Logger, LoggerOptions } from 'pino';
import type { AppConfig } from '../config/env.js';

/**
 * Build the application logger.
 *
 * In development logs are pretty-printed for readability; in production the
 * default JSON output is kept so that log collectors can parse it.
 */
export function createLogger(config: AppConfig): Logger {
  const options: LoggerOptions = {
    level: config.isTest ? 'silent' : config.LOG_LEVEL,
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  if (config.isProduction) {
    options.base = { pid: process.pid };
  } else if (!config.isTest) {
    // Pretty printing runs in a worker thread and is meant for humans only,
    // so it is enabled in development but never in tests or production.
    options.transport = {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:HH:MM:ss.l',
        ignore: 'pid,hostname',
      },
    };
  }

  return pino(options);
}

export type { Logger };
