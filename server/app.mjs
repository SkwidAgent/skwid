import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { loadConfig } from './config.mjs';
import { createPool, databaseReady } from './db.mjs';
import { HttpError, publicError } from './errors.mjs';
import { Repository } from './repository.mjs';
import { createApiRouter } from './routes.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

export function createApp(options = {}) {
  const config = options.config || loadConfig();
  const pool = options.pool === undefined ? createPool(config) : options.pool;
  const repository = options.repository || (pool ? new Repository(pool) : null);
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);
  app.use((_req, res, next) => {
    res.set({
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    });
    next();
  });
  app.use(express.json({ limit: '128kb', strict: true }));
  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.get('/ready', async (_req, res) => {
    const ready = await databaseReady(pool);
    res.status(ready ? 200 : 503).json({ ready });
  });
  if (repository) app.use('/api', createApiRouter({ config, repository, pool }));
  else app.use('/api', (_req, _res, next) => next(new HttpError(503, 'database_unavailable', 'Database is unavailable.')));

  const publicDir = path.resolve(here, '../public');
  app.use(express.static(publicDir, { fallthrough: true, etag: true, maxAge: config.nodeEnv === 'production' ? '1h' : 0 }));
  app.get(['/', '/Home', '/docs', '/journal', '/lab'], (_req, res, next) => res.sendFile(path.join(publicDir, 'index.html'), (error) => error && next(error)));
  app.use((error, _req, res, _next) => {
    const normalized = error?.type === 'entity.too.large'
      ? { status: 413, body: { error: { code: 'payload_too_large', message: 'Request body is too large.' } } }
      : publicError(error);
    res.status(normalized.status).json(normalized.body);
  });
  return { app, pool, config };
}

export async function start(options = {}) {
  const created = createApp(options);
  return new Promise((resolve, reject) => {
    const server = created.app.listen(created.config.port, () => resolve({ ...created, server }));
    server.on('error', reject);
  });
}
