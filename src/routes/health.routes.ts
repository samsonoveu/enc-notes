import { Router } from 'express';

const startedAt = Date.now();

/** Liveness and readiness endpoints for orchestrators and load balancers. */
export function createHealthRouter(version: string): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      uptime: Math.round((Date.now() - startedAt) / 1000),
      version,
    });
  });

  router.get('/ready', (_req, res) => {
    res.json({ status: 'ready' });
  });

  return router;
}
