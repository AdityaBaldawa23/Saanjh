import { all, one, run, tx, now } from '../db.ts';
import { ensureWallet } from '../credits.ts';
import { bad, getMembership, notFound, notify, requireAdmin, requireMember, settingsFor, type Settings } from './common.ts';
import { closeOpenRequestsForListing, eligibility } from './exchanges.ts';

/** All figures are derived from completed_exchanges. Nothing here is stored or estimated client-side. */
export async function societyStats(userId: number) {
  const m = await requireMember(userId);
  const sid = m.society_id;
  const tot = (await one<any>(
    `SELECT COUNT(*) AS exchanges, COALESCE(SUM(est_grams),0) AS grams,
       COALESCE(SUM(CASE WHEN category='fruit' THEN est_grams END),0) AS fruit_grams,
       COALESCE(SUM(CASE WHEN category='vegetable' THEN est_grams END),0) AS veg_grams,
       COALESCE(SUM(CASE WHEN category='leafy' THEN est_grams END),0) AS leafy_grams,
       COALESCE(SUM(credits),0) AS credits
     FROM completed_exchanges WHERE society_id = ?`, sid))!;
  const households = (await one<{ n: number }>(
    `SELECT COUNT(*) AS n FROM (SELECT giver_id AS u FROM completed_exchanges WHERE society_id = ?
       UNION SELECT receiver_id FROM completed_exchanges WHERE society_id = ?) t`, sid, sid))!.n;
  const members = (await one<{ n: number }>(`SELECT COUNT(*) AS n FROM memberships WHERE society_id = ? AND status = 'approved'`, sid))!.n;
  const live = (await one<{ n: number }>(`SELECT COUNT(*) AS n FROM listings WHERE society_id = ? AND status='active' AND qty_available > 0 AND available_until > ?`, sid, now()))!.n;

  // Last 6 calendar months, zero-filled
  const months: { key: string; label: string; exchanges: number; grams: number }[] = [];
  const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0);
  for (let i = 5; i >= 0; i--) {
    const start = new Date(d.getFullYear(), d.getMonth() - i, 1);
    const end = new Date(d.getFullYear(), d.getMonth() - i + 1, 1);
    const r = (await one<any>(`SELECT COUNT(*) AS n, COALESCE(SUM(est_grams),0) AS g FROM completed_exchanges WHERE society_id = ? AND completed_at >= ? AND completed_at < ?`,
      sid, start.getTime(), end.getTime()))!;
    months.push({ key: `${start.getFullYear()}-${start.getMonth() + 1}`, label: start.toLocaleString('en-IN', { month: 'short' }), exchanges: r.n, grams: r.g });
  }
  const top = await all(`SELECT produce_name AS name, MAX(category) AS category, COUNT(*) AS exchanges, SUM(est_grams) AS grams FROM completed_exchanges
                   WHERE society_id = ? GROUP BY produce_name ORDER BY grams DESC LIMIT 5`, sid);
  return { society: { id: sid, name: m.society_name }, members, households, live_listings: live, ...tot, months, top };
}

export async function wallet(userId: number) {
  const m = await getMembership(userId);
  const w = await ensureWallet(userId);
  const txs = await all(`SELECT id, type, amount, balance_after, description, exchange_id, created_at FROM credit_transactions
                   WHERE user_id = ? ORDER BY id DESC LIMIT 200`, userId);
  const recent = await all(`SELECT produce_name, quantity, unit_type, credits, completed_at FROM completed_exchanges WHERE giver_id = ? ORDER BY completed_at DESC LIMIT 5`, userId);
  const settings = m?.status === 'approved' ? await settingsFor(m.society_id) : null;
  return { wallet: w, transactions: txs, recent_contributions: recent, eligibility: await eligibility(userId), settings };
}

export async function profile(userId: number) {
  const u = await one<any>('SELECT id, name, email, avatar_url, restricted_until, created_at FROM users WHERE id = ?', userId);
  if (!u) throw notFound('User');
  const m = await getMembership(userId);
  const shared = (await one<any>(`SELECT COUNT(*) AS n, COALESCE(SUM(est_grams),0) AS g FROM completed_exchanges WHERE giver_id = ?`, userId))!;
  const received = (await one<any>(`SELECT COUNT(*) AS n, COALESCE(SUM(est_grams),0) AS g FROM completed_exchanges WHERE receiver_id = ?`, userId))!;
  const strikes = (await one<{ n: number }>(`SELECT COUNT(*) AS n FROM strikes WHERE user_id = ? AND created_at > ?`, userId, now() - 30 * 86_400_000))!.n;
  const unread = (await one<{ n: number }>('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read = 0', userId))!.n;
  const admin = m?.status === 'approved' && m.role === 'admin';
  const pendingMembers = admin ? (await one<{ n: number }>(`SELECT COUNT(*) AS n FROM memberships WHERE society_id = ? AND status = 'pending'`, m!.society_id))!.n : 0;
  const openReports = admin ? (await one<{ n: number }>(`SELECT COUNT(*) AS n FROM reports WHERE society_id = ? AND status = 'open'`, m!.society_id))!.n : 0;
  return {
    user: u, membership: m ?? null, wallet: await ensureWallet(userId),
    stats: { shared: shared.n, shared_grams: shared.g, received: received.n, received_grams: received.g, strikes },
    unread_notifications: unread,
    admin_todo: admin ? { pending_members: pendingMembers, open_reports: openReports } : null,
  };
}

export async function updateProfile(userId: number, p: { name?: string; avatar_url?: string }) {
  if (p.name !== undefined) await run('UPDATE users SET name = ? WHERE id = ?', p.name, userId);
  if (p.avatar_url !== undefined) await run('UPDATE users SET avatar_url = ? WHERE id = ?', p.avatar_url, userId);
  return profile(userId);
}

export const notifications = async (userId: number) =>
  (await all('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 100', userId)).map((n: any) => ({ ...n, read: !!n.read }));
export const markRead = (userId: number, id?: number) =>
  id ? run('UPDATE notifications SET read = 1 WHERE user_id = ? AND id = ?', userId, id) : run('UPDATE notifications SET read = 1 WHERE user_id = ?', userId);

// ── Admin ──
export async function listReports(adminId: number) {
  const a = await requireAdmin(adminId);
  return all(`SELECT r.id, r.reason, r.details, r.status, r.created_at, r.listing_id, l.name AS listing_name, l.photo_url, l.status AS listing_status,
                u.name AS reporter_name, ou.name AS owner_name
              FROM reports r JOIN listings l ON l.id = r.listing_id JOIN users u ON u.id = r.reporter_id JOIN users ou ON ou.id = l.owner_id
              WHERE r.society_id = ? ORDER BY r.status = 'open' DESC, r.created_at DESC LIMIT 100`, a.society_id);
}

export function resolveReport(adminId: number, reportId: number, action: 'dismiss' | 'remove_listing') {
  return tx(async () => {
    const a = await requireAdmin(adminId);
    const r = await one<any>('SELECT * FROM reports WHERE id = ? FOR UPDATE', reportId);
    if (!r || r.society_id !== a.society_id) throw notFound('Report');
    const l = (await one<any>('SELECT * FROM listings WHERE id = ? FOR UPDATE', r.listing_id))!;
    if (action === 'remove_listing') {
      if (['active', 'paused', 'hidden'].includes(l.status)) {
        await closeOpenRequestsForListing(l, 'admin_removed');
        await run(`UPDATE listings SET status = 'removed', updated_at = ? WHERE id = ?`, now(), l.id);
        await notify(l.owner_id, 'listing_removed', `${l.name} was removed`, 'A society admin removed this listing after a quality report.', null);
      }
      await run(`UPDATE reports SET status = 'actioned', reviewed_by = ? WHERE listing_id = ? AND status = 'open'`, adminId, l.id);
    } else {
      await run(`UPDATE reports SET status = 'dismissed', reviewed_by = ? WHERE id = ?`, adminId, reportId);
      const open = (await one<{ n: number }>(`SELECT COUNT(*) AS n FROM reports WHERE listing_id = ? AND status = 'open'`, l.id))!.n;
      if (l.status === 'hidden' && open < (await settingsFor(l.society_id)).report_hide_threshold) {
        const status = l.available_until > now() ? 'active' : 'expired';
        await run('UPDATE listings SET status = ?, updated_at = ? WHERE id = ?', status, now(), l.id);
        if (status === 'active') await notify(l.owner_id, 'listing_restored', `${l.name} is visible again`, 'An admin reviewed the reports and restored your listing.', `/listing/${l.id}`);
      }
    }
    return { ok: true };
  });
}

const EDITABLE: (keyof Settings)[] = ['starter_credits', 'min_balance', 'min_credits_per_exchange', 'max_active_requests', 'weekly_receive_cap',
  'max_receives_without_sharing', 'no_show_penalty', 'strike_limit', 'restriction_days', 'report_hide_threshold'];

export async function getSettings(adminId: number) {
  return settingsFor((await requireAdmin(adminId)).society_id);
}
export async function updateSettings(adminId: number, patch: Partial<Settings>) {
  const a = await requireAdmin(adminId);
  const keys = Object.keys(patch).filter((k) => EDITABLE.includes(k as keyof Settings)) as (keyof Settings)[];
  if (!keys.length) throw bad('Nothing to update.');
  await run(`UPDATE society_settings SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE society_id = ?`, ...keys.map((k) => patch[k]), a.society_id);
  return settingsFor(a.society_id);
}

export const catalog = () => all('SELECT id, name, category, unit_type, rate, emoji FROM produce_catalog ORDER BY name');
