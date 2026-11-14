import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { createLogger } from '../src/lib/logger.js';

interface ErrorPayload {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: Array<{ readonly path: string; readonly message: string }>;
  };
}

interface HealthPayload {
  readonly status: string;
  readonly uptime: number;
}

/** Narrow the untyped supertest body to a known shape for assertions. */
function bodyOf<T>(response: { body: unknown }): T {
  return response.body as T;
}

describe('HTTP API', () => {
  let app: Express;

  beforeEach(() => {
    const config = loadConfig({ NODE_ENV: 'test' });
    const logger = createLogger(config);

    app = createApp({ config, logger });
  });

  describe('GET /api/health', () => {
    it('reports the service as healthy', async () => {
      const response = await request(app).get('/api/health').expect(200);
      const body = bodyOf<HealthPayload>(response);

      expect(body.status).toBe('ok');
      expect(typeof body.uptime).toBe('number');
    });
  });

  describe('GET /api/ready', () => {
    it('reports the service as ready', async () => {
      const response = await request(app).get('/api/ready').expect(200);

      expect(bodyOf<{ status: string }>(response).status).toBe('ready');
    });
  });

  describe('fallbacks', () => {
    it('returns a JSON 404 for an unknown route', async () => {
      const response = await request(app).get('/api/nope').expect(404);
      const body = bodyOf<ErrorPayload>(response);

      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error.message).toContain('/api/nope');
    });

    it('no longer serves the removed tasks API', async () => {
      await request(app).get('/api/tasks').expect(404);
    });

    it('does not advertise the server technology', async () => {
      const response = await request(app).get('/api/health').expect(200);

      expect(response.headers['x-powered-by']).toBeUndefined();
    });
  });
});
