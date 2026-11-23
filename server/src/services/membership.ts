import { all, one, run, tx, now } from '../db.ts';
import { credits, ensureWallet } from '../credits.ts';
import { bad, conflict, forbidden, notFound, notify, notifyAdmins, requireAdmin, settingsFor, getMembership } from './common.ts';

export function listSocieties(q = '') {
  const like = `%${q.trim()}%`;
  return all(
    `SELECT s.id, s.name, s.city, s.area,
       (SELECT COUNT(*) FROM memberships m WHERE m.society_id = s.id AND m.status = 'approved') AS members
     FROM societies s WHERE s.name ILIKE ? OR s.city ILIKE ? OR s.area ILIKE ? ORDER BY s.name LIMIT 50`, like, like, like);
}

interface Address { building: string; wing: string; flat: string }

async function grantStarter(userId: number, societyId: number) {
  await ensureWallet(userId);
  const already = await one("SELECT 1 FROM credit_transactions WHERE user_id = ? AND type = 'starter'", userId);
  if (!already) await credits.starter(userId, (await settingsFor(societyId)).starter_credits);
}

export function joinSociety(userId: number, societyId: number, a: Address) {
  return tx(async () => {
    const soc = await one<{ id: number; name: string }>('SELECT id, name FROM societies WHERE id = ?', societyId);
    if (!soc) throw notFound('Society');
    const existing = await getMembership(userId);
    if (existing && existing.status !== 'rejected') throw conflict('You already belong to (or have applied to) a society.');
    // Several family members may share a flat, so this is only flagged to the admin, not blocked.
    const dup = await one(
      `SELECT 1 FROM memberships WHERE society_id = ? AND lower(building) = lower(?) AND lower(wing) = lower(?) AND lower(flat) = lower(?)
       AND status = 'approved' AND user_id != ?`, societyId, a.building, a.wing, a.flat, userId);
    if (existing) await run('DELETE FROM memberships WHERE user_id = ?', userId);
    await run(`INSERT INTO memberships (user_id, society_id, building, wing, flat, status, created_at) VALUES (?,?,?,?,?, 'pending', ?)`,
      userId, societyId, a.building, a.wing, a.flat, now());
    const u = (await one<{ name: string }>('SELECT name FROM users WHERE id = ?', userId))!;
    await notifyAdmins(societyId, 'membership_request', 'New resident awaiting verification',
      `${u.name} · ${[a.wing, a.building].filter(Boolean).join(', ')} · Flat ${a.flat}${dup ? ' (another verified member lives at this flat)' : ''}`,
      '/admin');
    return getMembership(userId);
  });
}

export function createSociety(userId: number, s: { name: string; city: string; area: string } & Address) {
  return tx(async () => {
    if ((await getMembership(userId))?.status === 'approved') throw conflict('You already belong to a society.');
    if (await one('SELECT 1 FROM societies WHERE lower(name) = lower(?) AND lower(city) = lower(?)', s.name, s.city))
      throw conflict('A society with this name already exists in this city. Search for it and request to join.');
    const { id } = (await one<{ id: number }>('INSERT INTO societies (name, city, area, created_by, created_at) VALUES (?,?,?,?,?) RETURNING id',
      s.name, s.city, s.area, userId, now()))!;
    await run('INSERT INTO society_settings (society_id) VALUES (?)', id);
    await run('DELETE FROM memberships WHERE user_id = ?', userId);
    await run(`INSERT INTO memberships (user_id, society_id, building, wing, flat, status, role, reviewed_at, created_at)
         VALUES (?,?,?,?,?, 'approved', 'admin', ?, ?)`, userId, id, s.building, s.wing, s.flat, now(), now());
    await grantStarter(userId, id);
    return getMembership(userId);
  });
}

export async function listMembers(adminId: number) {
  const admin = await requireAdmin(adminId);
  return all(
    `SELECT m.id, m.user_id, u.name, u.email, m.building, m.wing, m.flat, m.status, m.role, m.created_at,
       (SELECT COUNT(*) FROM memberships m2 WHERE m2.society_id = m.society_id AND m2.status='approved' AND m2.user_id != m.user_id
          AND lower(m2.building)=lower(m.building) AND lower(m2.wing)=lower(m.wing) AND lower(m2.flat)=lower(m.flat)) AS same_flat
     FROM memberships m JOIN users u ON u.id = m.user_id
     WHERE m.society_id = ? ORDER BY m.status = 'pending' DESC, m.created_at DESC`, admin.society_id);
}

export function reviewMembership(adminId: number, membershipId: number, approve: boolean, reason = '') {
  return tx(async () => {
    const admin = await requireAdmin(adminId);
    const m = await one<{ id: number; user_id: number; society_id: number; status: string }>('SELECT * FROM memberships WHERE id = ? FOR UPDATE', membershipId);
    if (!m || m.society_id !== admin.society_id) throw notFound('Membership request');
    if (m.status !== 'pending') throw bad('This request has already been reviewed.');
    await run('UPDATE memberships SET status = ?, reviewed_by = ?, reviewed_at = ?, reject_reason = ? WHERE id = ?',
      approve ? 'approved' : 'rejected', adminId, now(), approve ? null : reason, m.id);
    if (approve) {
      await grantStarter(m.user_id, m.society_id);
      await notify(m.user_id, 'membership_approved', `Welcome to ${admin.society_name}!`,
        `You're verified. ${(await settingsFor(m.society_id)).starter_credits} welcome credits have been added to your wallet.`, '/');
    } else {
      await notify(m.user_id, 'membership_rejected', 'Membership not approved',
        reason || 'Your society admin could not verify your details. Please check them and apply again.', '/onboarding');
    }
    return { ok: true };
  });
}

export function setRole(adminId: number, membershipId: number, role: 'resident' | 'admin') {
  return tx(async () => {
    const admin = await requireAdmin(adminId);
    const m = await one<{ user_id: number; society_id: number; status: string }>('SELECT * FROM memberships WHERE id = ? FOR UPDATE', membershipId);
    if (!m || m.society_id !== admin.society_id) throw notFound('Member');
    if (m.status !== 'approved') throw bad('Only verified members can be admins.');
    if (m.user_id === adminId && role === 'resident') {
      const { n } = (await one<{ n: number }>(`SELECT COUNT(*) AS n FROM memberships WHERE society_id = ? AND role='admin'`, admin.society_id))!;
      if (n <= 1) throw forbidden('A society needs at least one admin.');
    }
    await run('UPDATE memberships SET role = ? WHERE id = ?', role, membershipId);
    return { ok: true };
  });
}
