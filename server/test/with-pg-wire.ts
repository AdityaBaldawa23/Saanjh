/**
 * Runs the test suite through the production code path (node-postgres + DATABASE_URL) without needing
 * a Postgres install: an in-memory PGlite is exposed over the real Postgres wire protocol.
 *   npm run test:pg
 */
import { spawn } from 'node:child_process';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const port = 54329;
const db = new PGlite();
const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1' });
await server.start();

const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '--test', 'test/exchange.test.ts'], {
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: `postgres://postgres:postgres@127.0.0.1:${port}/postgres?sslmode=disable`, PG_POOL_MAX: '1' },
});
child.on('exit', async (code) => {
  await server.stop();
  await db.close();
  process.exit(code ?? 1);
});
