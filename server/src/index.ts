import { createApp } from './app.ts';
import { ready } from './db.ts';
import { sweep } from './services/exchanges.ts';

const PORT = Number(process.env.PORT ?? 4000);
await ready(); // create the schema before accepting traffic

const server = createApp().listen(PORT, () =>
  console.log(`Saanjha API on http://localhost:${PORT}  (database: ${process.env.DATABASE_URL ? 'Postgres via DATABASE_URL' : 'local PGlite in server/data/pg'})`));
server.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\nPort ${PORT} is already in use - another copy of the API is probably running.\nClose the other terminal (or stop that process) and run "npm run dev" again.\n`);
    process.exit(1);
  }
  throw e;
});

setInterval(() => {
  sweep().then((n) => { if (n) console.log(`sweeper: ${n} item(s) expired/resolved`); }).catch((e) => console.error('sweeper', e));
}, 60_000).unref();
