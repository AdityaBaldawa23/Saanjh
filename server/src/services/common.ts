import { one, run, all, now } from '../db.ts';

export class AppError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
export const bad = (msg: string, details?: unknown) => new AppError(400, 'bad_request', msg, details);
export const forbidden = (msg = 'You do not have access to this.') => new AppError(403, 'forbidden', msg);
export const notFound = (what = 'Item') => new AppError(404, 'not_found', `${what} not found.`);
export const conflict = (msg: string, details?: unknown) => new AppError(409, 'conflict', msg, details);

export interface Settings {
  society_id: number;
  starter_credits: number;
  min_balance: number;
  min_credits_per_exchange: number;
  max_active_requests: number;
  weekly_receive_cap: number;
  max_receives_without_sharing: number;
  no_show_penalty: number;
  strike_limit: number;
  restriction_days: number;
  report_hide_threshold: number;
}
export const settingsFor = async (societyId: number) =>
  (await one<Settings>('SELECT * FROM society_settings WHERE society_id = ?', societyId))!;

export interface Member {
  membership_id: number;
  user_id: number;
  society_id: number;
  society_name: string;
  building: string;
  wing: string;
  flat: string;
  status: 'pending' | 'approved' | 'rejected';
  role: 'resident' | 'admin';
  reject_reason: string | null;
}

export const getMembership = (userId: number) =>
  one<Member>(
    `SELECT m.id AS membership_id, m.user_id, m.society_id, s.name AS society_name, m.building, m.wing, m.flat, m.status, m.role, m.reject_reason
     FROM memberships m JOIN societies s ON s.id = m.society_id WHERE m.user_id = ?`, userId);

export async function requireMember(userId: number): Promise<Member> {
  const m = await getMembership(userId);
  if (!m) throw new AppError(403, 'no_society', 'Join a society to continue.');
  if (m.status !== 'approved') throw new AppError(403, 'not_verified', 'Your society membership is awaiting verification.');
  return m;
}

export async function requireAdmin(userId: number): Promise<Member> {
  const m = await requireMember(userId);
  if (m.role !== 'admin') throw forbidden('Only society admins can do this.');
  return m;
}

export async function notify(userId: number, type: string, title: string, body: string, link: string | null = null) {
  await run('INSERT INTO notifications (user_id, type, title, body, link, created_at) VALUES (?,?,?,?,?,?)',
    userId, type, title, body, link, now());
}

export async function notifyAdmins(societyId: number, type: string, title: string, body: string, link: string | null = null) {
  for (const a of await all<{ user_id: number }>(
    `SELECT user_id FROM memberships WHERE society_id = ? AND role = 'admin' AND status = 'approved'`, societyId))
    await notify(a.user_id, type, title, body, link);
}

export const firstName = (name: string) => name.trim().split(/\s+/)[0];
export const DAY = 86_400_000;

/** Record a strike; enough strikes in 30 days places a temporary booking restriction. */
export async function addStrike(userId: number, exchangeId: number | null, reason: string, s: Settings) {
  await run('INSERT INTO strikes (user_id, exchange_id, reason, created_at) VALUES (?,?,?,?)', userId, exchangeId, reason, now());
  const { n } = (await one<{ n: number }>('SELECT COUNT(*) AS n FROM strikes WHERE user_id = ? AND created_at > ?', userId, now() - 30 * DAY))!;
  if (n >= s.strike_limit) {
    const until = now() + s.restriction_days * DAY;
    await run('UPDATE users SET restricted_until = ? WHERE id = ?', until, userId);
    await run('DELETE FROM strikes WHERE user_id = ?', userId); // start fresh once the restriction is served
    await notify(userId, 'restriction', 'Booking paused for a few days',
      `Because of ${n} missed pickups or late cancellations in 30 days, you can't request produce until ${new Date(until).toDateString()}. You can still share.`,
      '/wallet');
  }
}
