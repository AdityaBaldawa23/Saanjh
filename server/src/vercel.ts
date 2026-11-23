/** Entry point for Vercel: the Express app as a single serverless function (bundled to server/dist/vercel.mjs). */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp } from './app.ts';

const app = createApp();

export default function handler(req: IncomingMessage, res: ServerResponse) {
  // vercel.json rewrites /api/<path> to /api?__path=<path>. Depending on the runtime, req.url is either the
  // original URL or the rewritten one; rebuild the original so Express routing works either way.
  const url = new URL(req.url ?? '/', 'http://local');
  const path = url.searchParams.get('__path');
  if (path !== null && !url.pathname.startsWith('/api/')) {
    url.searchParams.delete('__path');
    req.url = `/api/${path}${url.search}`;
  }
  return app(req as any, res as any);
}
