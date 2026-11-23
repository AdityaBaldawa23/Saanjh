/**
 * The ONLY module allowed to change wallet balances. Every change writes exactly one
 * append-only ledger row with the resulting balance, inside the caller's transaction.
 */
import { one, run, now, isTransaction } from './db.ts';

export type TxType = 'starter' | 'hold' | 'release' | 'spend' | 'refund' | 'earn' | 'penalty' | 'adjustment';

export interface Wallet {
  user_id: number;
  balance: number;
  held: number;
  total_earned: number;
  total_spent: number;
}

export async function ensureWallet(userId: number): Promise<Wallet> {
  await run('INSERT INTO wallets (user_id) VALUES (?) ON CONFLICT (user_id) DO NOTHING', userId);
  return (await one<Wallet>('SELECT * FROM wallets WHERE user_id = ?', userId))!;
}

/** Lock the wallet row for the rest of the transaction (serialises concurrent requests by one user). */
export async function lockWallet(userId: number): Promise<Wallet> {
  await ensureWallet(userId);
  return (await one<Wallet>('SELECT * FROM wallets WHERE user_id = ? FOR UPDATE', userId))!;
}

interface Movement { balance?: number; held?: number; earned?: number; spent?: number }

async function apply(userId: number, type: TxType, m: Movement, description: string, exchangeId: number | null) {
  if (!isTransaction()) throw new Error('credit movement must run inside a transaction');
  await ensureWallet(userId);
  const w = (await one<Wallet>(
    `UPDATE wallets SET balance = balance + ?, held = held + ?, total_earned = total_earned + ?, total_spent = total_spent + ?
     WHERE user_id = ? RETURNING *`,
    m.balance ?? 0, m.held ?? 0, m.earned ?? 0, m.spent ?? 0, userId))!;
  await run(
    `INSERT INTO credit_transactions (user_id, exchange_id, type, amount, balance_after, description, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    userId, exchangeId, type, m.balance ?? 0, w.balance, description, now());
  return w;
}

export const credits = {
  starter: (userId: number, amount: number) =>
    apply(userId, 'starter', { balance: amount }, 'Welcome credits for joining your society', null),
  /** Request placed: move credits from available into held. */
  hold: (userId: number, amount: number, exId: number, what: string) =>
    apply(userId, 'hold', { balance: -amount, held: amount }, `Reserved for request: ${what}`, exId),
  /** Request closed before it was confirmed: give the held credits back. */
  release: (userId: number, amount: number, exId: number, why: string) =>
    apply(userId, 'release', { balance: amount, held: -amount }, why, exId),
  /** Booking confirmed by contributor: held credits are now spent. Available balance unchanged. */
  spend: (userId: number, amount: number, exId: number, what: string) =>
    apply(userId, 'spend', { held: -amount, spent: amount }, `Booking confirmed: ${what}`, exId),
  /** Confirmed booking fell through: return spent credits. */
  refund: (userId: number, amount: number, exId: number, why: string) =>
    apply(userId, 'refund', { balance: amount, spent: -amount }, why, exId),
  penalty: (userId: number, amount: number, exId: number, why: string) =>
    apply(userId, 'penalty', { balance: -amount }, why, exId),
  earn: (userId: number, amount: number, exId: number, what: string) =>
    apply(userId, 'earn', { balance: amount, earned: amount }, `Shared: ${what}`, exId),
};

/** Credits for a quantity in base units (grams or pieces). Transparent and deterministic. */
export function priceFor(unitType: 'weight' | 'piece', rate: number, qty: number, minCredits: number) {
  const raw = unitType === 'weight' ? (qty / 1000) * rate : qty * rate;
  return Math.max(minCredits, Math.round(raw));
}

export function formatQty(unitType: 'weight' | 'piece', qty: number) {
  if (unitType === 'piece') return `${qty} pc${qty === 1 ? '' : 's'}`;
  return qty >= 1000 ? `${+(qty / 1000).toFixed(2)} kg` : `${qty} g`;
}
