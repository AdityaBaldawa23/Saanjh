/**
 * Postgres data layer with two drivers:
 *  - DATABASE_URL set  → node-postgres pool (production: Neon / any Postgres)
 *  - otherwise         → PGlite, an embedded Postgres stored in server/data/pg (zero-setup local dev)
 *
 * Both run the same SQL. Queries use `?` placeholders (converted to $1, $2…).
 * Transactions are carried implicitly through AsyncLocalStorage, so service code calls
 * one()/all()/run() and they automatically join the surrounding tx().
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

type Result = { rows: any[]; rowCount: number };
type Exec = (sql: string, params: unknown[]) => Promise<Result>;
interface Driver {
  query: Exec;
  exec: (sql: string) => Promise<void>;
  transaction: <T>(fn: (q: Exec) => Promise<T>) => Promise<T>;
  close: () => Promise<void>;
}

const txStore = new AsyncLocalStorage<Exec>();
const toPg = (sql: string) => { let i = 0; return sql.replace(/\?/g, () => `$${++i}`); };
const toNumber = (v: string) => (v === null ? null : Number(v));

async function pgDriver(url: string): Promise<Driver> {
  const { default: pg } = await import('pg');
  pg.types.setTypeParser(20, toNumber as any);   // int8 (COUNT, SUM, BIGINT timestamps)
  pg.types.setTypeParser(1700, toNumber as any); // numeric (SUM of bigint)
  const pool = new pg.Pool({ connectionString: url, max: Number(process.env.PG_POOL_MAX ?? 5), idleTimeoutMillis: 10_000 });
  const wrap = (c: { query: (s: string, p?: unknown[]) => Promise<any> }): Exec => async (s, p) => {
    const r = await c.query(s, p);
    return { rows: r.rows, rowCount: r.rowCount ?? 0 };
  };
  return {
    query: wrap(pool),
    exec: async (sql) => { await pool.query(sql); },
    transaction: async (fn) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out = await fn(wrap(client));
        await client.query('COMMIT');
        return out;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally { client.release(); }
    },
    close: () => pool.end(),
  };
}

async function pgliteDriver(dir: string): Promise<Driver> {
  const { PGlite } = await import('@electric-sql/pglite');
  if (dir !== ':memory:') mkdirSync(dir, { recursive: true });
  const db = new PGlite(dir === ':memory:' ? undefined : dir, { parsers: { 20: toNumber, 1700: toNumber } });
  // PGlite is a single connection, so every statement and transaction is serialised through one lock.
  let lock: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = lock.then(fn, fn);
    lock = next.catch(() => {});
    return next;
  };
  const raw: Exec = async (s, p) => { const r = await db.query(s, p as any[]); return { rows: r.rows as any[], rowCount: r.affectedRows ?? r.rows.length }; };
  return {
    query: (s, p) => exclusive(() => raw(s, p)),
    exec: (sql) => exclusive(async () => { await db.exec(sql); }),
    transaction: (fn) => exclusive(async () => {
      await db.exec('BEGIN');
      try {
        const out = await fn(raw);
        await db.exec('COMMIT');
        return out;
      } catch (e) {
        await db.exec('ROLLBACK').catch(() => {});
        throw e;
      }
    }),
    close: () => db.close(),
  };
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS societies (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  area TEXT NOT NULL DEFAULT '',
  created_by INTEGER,
  created_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_society_name_city ON societies (lower(name), lower(city));

CREATE TABLE IF NOT EXISTS society_settings (
  society_id INTEGER PRIMARY KEY REFERENCES societies(id) ON DELETE CASCADE,
  starter_credits INTEGER NOT NULL DEFAULT 150,
  min_balance INTEGER NOT NULL DEFAULT -20,
  min_credits_per_exchange INTEGER NOT NULL DEFAULT 2,
  max_active_requests INTEGER NOT NULL DEFAULT 3,
  weekly_receive_cap INTEGER NOT NULL DEFAULT 150,
  max_receives_without_sharing INTEGER NOT NULL DEFAULT 4,
  no_show_penalty INTEGER NOT NULL DEFAULT 5,
  strike_limit INTEGER NOT NULL DEFAULT 3,
  restriction_days INTEGER NOT NULL DEFAULT 7,
  report_hide_threshold INTEGER NOT NULL DEFAULT 3
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE,
  phone TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  avatar_url TEXT,
  restricted_until BIGINT,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS memberships (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  society_id INTEGER NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
  building TEXT NOT NULL,
  wing TEXT NOT NULL DEFAULT '',
  flat TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','approved','rejected')),
  role TEXT NOT NULL DEFAULT 'resident' CHECK (role IN ('resident','admin')),
  reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at BIGINT,
  reject_reason TEXT,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS strikes (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exchange_id INTEGER,
  reason TEXT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS produce_catalog (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL CHECK (category IN ('fruit','vegetable','leafy')),
  unit_type TEXT NOT NULL CHECK (unit_type IN ('weight','piece')),
  rate DOUBLE PRECISION NOT NULL,
  avg_piece_grams INTEGER,
  emoji TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS listings (
  id SERIAL PRIMARY KEY,
  society_id INTEGER NOT NULL REFERENCES societies(id),
  owner_id INTEGER NOT NULL REFERENCES users(id),
  catalog_id INTEGER REFERENCES produce_catalog(id),
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('fruit','vegetable','leafy')),
  unit_type TEXT NOT NULL CHECK (unit_type IN ('weight','piece')),
  display_unit TEXT NOT NULL CHECK (display_unit IN ('g','kg','pcs')),
  qty_total INTEGER NOT NULL CHECK (qty_total > 0),
  qty_available INTEGER NOT NULL CHECK (qty_available >= 0),
  rate DOUBLE PRECISION NOT NULL,
  avg_piece_grams INTEGER,
  photo_url TEXT NOT NULL,
  purchase_date TEXT,
  condition TEXT NOT NULL CHECK (condition IN ('fresh','good','use_soon')),
  pickup_from BIGINT NOT NULL,
  available_until BIGINT NOT NULL,
  pickup_note TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','expired','removed','hidden','completed')),
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_listings_society ON listings(society_id, status, created_at);

CREATE TABLE IF NOT EXISTS exchange_requests (
  id SERIAL PRIMARY KEY,
  listing_id INTEGER NOT NULL REFERENCES listings(id),
  society_id INTEGER NOT NULL REFERENCES societies(id),
  requester_id INTEGER NOT NULL REFERENCES users(id),
  owner_id INTEGER NOT NULL REFERENCES users(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  credits INTEGER NOT NULL CHECK (credits > 0),
  status TEXT NOT NULL CHECK (status IN ('pending','accepted','completed','rejected','cancelled','no_show','expired')),
  message TEXT NOT NULL DEFAULT '',
  owner_note TEXT NOT NULL DEFAULT '',
  cancelled_by TEXT CHECK (cancelled_by IN ('requester','owner','system')),
  close_reason TEXT,
  owner_confirmed INTEGER NOT NULL DEFAULT 0,
  requester_confirmed INTEGER NOT NULL DEFAULT 0,
  owner_confirmed_at BIGINT,
  requester_confirmed_at BIGINT,
  created_at BIGINT NOT NULL,
  accepted_at BIGINT,
  closed_at BIGINT
);
CREATE INDEX IF NOT EXISTS ix_ex_requester ON exchange_requests(requester_id, status);
CREATE INDEX IF NOT EXISTS ix_ex_owner ON exchange_requests(owner_id, status);
CREATE INDEX IF NOT EXISTS ix_ex_listing ON exchange_requests(listing_id, status);

CREATE TABLE IF NOT EXISTS completed_exchanges (
  id SERIAL PRIMARY KEY,
  exchange_id INTEGER NOT NULL UNIQUE REFERENCES exchange_requests(id),
  society_id INTEGER NOT NULL,
  listing_id INTEGER NOT NULL,
  giver_id INTEGER NOT NULL,
  receiver_id INTEGER NOT NULL,
  produce_name TEXT NOT NULL,
  category TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_type TEXT NOT NULL,
  est_grams INTEGER NOT NULL,
  credits INTEGER NOT NULL,
  completed_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_completed_society ON completed_exchanges(society_id, completed_at);

CREATE TABLE IF NOT EXISTS wallets (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  balance INTEGER NOT NULL DEFAULT 0,
  held INTEGER NOT NULL DEFAULT 0 CHECK (held >= 0),
  total_earned INTEGER NOT NULL DEFAULT 0,
  total_spent INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS credit_transactions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exchange_id INTEGER REFERENCES exchange_requests(id),
  type TEXT NOT NULL CHECK (type IN ('starter','hold','release','spend','refund','earn','penalty','adjustment')),
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  description TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_ctx_user ON credit_transactions(user_id, created_at);

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  link TEXT,
  read INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_notif_user ON notifications(user_id, read, created_at);

CREATE TABLE IF NOT EXISTS reports (
  id SERIAL PRIMARY KEY,
  society_id INTEGER NOT NULL,
  listing_id INTEGER NOT NULL REFERENCES listings(id),
  reporter_id INTEGER NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL CHECK (reason IN ('spoiled','misdescribed','unsafe','inappropriate','other')),
  details TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','actioned','dismissed')),
  reviewed_by INTEGER,
  created_at BIGINT NOT NULL,
  UNIQUE (listing_id, reporter_id)
);
`;

let driverP: Promise<Driver> | null = null;
let afterInit: ((d: Driver) => Promise<void>) | null = null;
/** Register work to run once after the schema exists (used to seed the produce catalogue). */
export const onInit = (fn: (d: Driver) => Promise<void>) => { afterInit = fn; };

export const usingPostgresUrl = () => !!process.env.DATABASE_URL;

function driver() {
  if (!driverP) {
    driverP = (async () => {
      const d = process.env.DATABASE_URL
        ? await pgDriver(process.env.DATABASE_URL)
        : await pgliteDriver(process.env.DB_PATH ?? fileURLToPath(new URL('../data/pg', import.meta.url)));
      await d.exec(SCHEMA);
      if (afterInit) await afterInit(d);
      return d;
    })();
    driverP.catch(() => { driverP = null; }); // allow a retry if the database was unreachable
  }
  return driverP;
}

async function q(sql: string, params: unknown[]): Promise<Result> {
  const inTx = txStore.getStore();
  if (inTx) return inTx(toPg(sql), params);
  return (await driver()).query(toPg(sql), params);
}

export const one = async <T = Record<string, any>>(sql: string, ...p: unknown[]) => (await q(sql, p)).rows[0] as T | undefined;
export const all = async <T = Record<string, any>>(sql: string, ...p: unknown[]) => (await q(sql, p)).rows as T[];
export const run = (sql: string, ...p: unknown[]) => q(sql, p);
export const execRaw = async (sql: string) => (await driver()).exec(sql);
export const isTransaction = () => !!txStore.getStore();
export const now = () => Date.now();
export const ready = async () => { await driver(); };
export const closeDb = async () => { if (driverP) { const d = await driverP; driverP = null; await d.close(); } };

/** Run fn in one database transaction. Nested calls join the outer transaction. */
export async function tx<T>(fn: () => Promise<T>): Promise<T> {
  if (txStore.getStore()) return fn();
  const d = await driver();
  return d.transaction((exec) => txStore.run(exec, fn));
}
