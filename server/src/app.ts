import express, { type NextFunction, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import multer from 'multer';
import './catalog.ts'; // registers the catalogue seed that runs right after the schema is created
import { api } from './routes.ts';
import { UPLOAD_DIR, usingBlob } from './storage.ts';
import { AppError } from './services/common.ts';
import { sweep } from './services/exchanges.ts';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  // Expiry is lazy: before an API call, resolve anything overdue (at most every 5 s per server instance).
  // This also works on serverless hosts, where background timers don't run.
  let last = 0;
  app.use('/api', async (_req, _res, next) => {
    if (Date.now() - last > 5_000) {
      last = Date.now();
      try { await sweep(); } catch (e) { console.error('sweep failed', e); }
    }
    next();
  });
  app.use('/api', api);
  if (!usingBlob()) app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d', fallthrough: false }));

  // Single-server mode (npm start): serve the built web app too. On Vercel the CDN serves it instead.
  const dist = fileURLToPath(new URL('../../web/dist/', import.meta.url));
  if (!process.env.VERCEL && existsSync(dist)) {
    app.use(express.static(dist));
    app.get('*', (_req, res) => res.sendFile(dist + 'index.html'));
  }

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof multer.MulterError) err = new AppError(400, 'bad_file', err.code === 'LIMIT_FILE_SIZE' ? 'Photo must be under 4 MB.' : err.message);
    if (err?.type === 'entity.parse.failed') err = new AppError(400, 'bad_request', 'Invalid JSON.');
    if (err?.code === '23505') err = new AppError(409, 'conflict', 'That already exists.'); // Postgres unique violation (race)
    if (err instanceof AppError) return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    if (err?.status === 404 || err?.statusCode === 404) return res.status(404).json({ error: { code: 'not_found', message: 'Not found.' } });
    console.error(err);
    res.status(500).json({ error: { code: 'server_error', message: 'Something went wrong. Please try again.' } });
  });
  return app;
}
