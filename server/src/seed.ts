/**
 * Resets the database to a clean starting point: ONE society, four verified residents, 150 credits each.
 * No listings or exchanges; those come from real use.
 *
 *   npm run seed                                  → local PGlite database
 *   DATABASE_URL=postgres://… npm run seed        → your production Postgres (e.g. Neon)
 *
 * Everything goes through the real services, so every credit has a ledger entry.
 */
import { readdirSync, rmSync, existsSync } from 'node:fs';
import './catalog.ts';
import { execRaw, ready, run, closeDb } from './db.ts';
import { registerUser } from './auth.ts';
import * as M from './services/membership.ts';
import { UPLOAD_DIR } from './storage.ts';

const STARTER = 150;
const PW = process.env.SEED_PASSWORD || 'password123'; // set SEED_PASSWORD when seeding a public deployment

// The local database folder can only be opened by one process: refuse to run next to `npm run dev`.
if (!process.env.DATABASE_URL) {
  const alive = await fetch(`http://localhost:${process.env.PORT ?? 4000}/api/health`).then(() => true, () => false);
  if (alive) {
    console.error('\nThe dev server is running. Stop "npm run dev" (Ctrl+C), run "npm run seed", then start it again.\n');
    process.exit(1);
  }
}

await ready();
await execRaw(`TRUNCATE notifications, reports, credit_transactions, completed_exchanges, strikes, exchange_requests,
  listings, wallets, memberships, society_settings, societies, users RESTART IDENTITY CASCADE`);
await run(`ALTER TABLE society_settings ALTER COLUMN starter_credits SET DEFAULT ${STARTER}`);

// Local photos from earlier runs (cloud photos in Vercel Blob are left alone; delete them from the Vercel dashboard if needed)
if (!process.env.DATABASE_URL && existsSync(UPLOAD_DIR))
  for (const f of readdirSync(UPLOAD_DIR)) if (f !== '.gitkeep') rmSync(UPLOAD_DIR + f, { force: true });

const admin = await registerUser('Priya Sharma', 'priya@greenvalley.test', PW);
const society = (await M.createSociety(admin, { name: 'Green Valley Residency', city: 'Pune', area: 'Baner', building: 'Tower A', wing: 'East', flat: '304' }))!;
await run('UPDATE society_settings SET starter_credits = ? WHERE society_id = ?', STARTER, society.society_id);

const residents: [string, string, string, string, string][] = [
  ['Rohan Mehta', 'rohan@greenvalley.test', 'Tower A', 'West', '1201'],
  ['Anjali Iyer', 'anjali@greenvalley.test', 'Tower B', 'East', '502'],
  ['Vikram Singh', 'vikram@greenvalley.test', 'Tower C', '', '803'],
];
for (const [name, email, building, wing, flat] of residents) {
  const id = await registerUser(name, email, PW);
  const m = (await M.joinSociety(id, society.society_id, { building, wing, flat }))!;
  await M.reviewMembership(admin, m.membership_id, true);
}
await run('DELETE FROM notifications'); // start with an empty inbox

console.log(`
Database reset ✓   ${process.env.DATABASE_URL ? '(Postgres from DATABASE_URL)' : '(local PGlite)'}

Society: Green Valley Residency, Baner, Pune
Every account starts with ${STARTER} credits. Password for all: ${process.env.SEED_PASSWORD ? '(the SEED_PASSWORD you set)' : PW}

  admin     priya@greenvalley.test    Tower A, East, 304
  resident  rohan@greenvalley.test    Tower A, West, 1201
  resident  anjali@greenvalley.test   Tower B, East, 502
  resident  vikram@greenvalley.test   Tower C, 803
`);
await closeDb();
