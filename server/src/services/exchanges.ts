import { all, one, run, tx, now } from '../db.ts';
import { credits, ensureWallet, formatQty, lockWallet, priceFor } from '../credits.ts';
import { addStrike, AppError, bad, DAY, firstName, forbidden, notFound, notify, notifyAdmins, requireMember, settingsFor, getMembership } from './common.ts';
import { minRequest, type ListingRow } from './listings.ts';

export interface Exchange {
  id: number; listing_id: number; society_id: number; requester_id: number; owner_id: number; quantity: number; credits: number;
  status: 'pending' | 'accepted' | 'completed' | 'rejected' | 'cancelled' | 'no_show' | 'expired';
  message: string; owner_note: string; cancelled_by: string | null; close_reason: string | null;
  owner_confirmed: number; requester_confirmed: number; owner_confirmed_at: number | null; requester_confirmed_at: number | null;
  created_at: number; accepted_at: number | null; closed_at: number | null;
}

const OPEN = `('pending','accepted')`;
/** Accepted bookings nobody confirmed are closed this long after the pickup deadline. */
export const GRACE_AFTER_DEADLINE = DAY;
/** Once one side has confirmed, the other has this long to confirm (or dispute) before it completes automatically. */
export const CONFIRM_WINDOW = DAY;

// ───────────────────────────── Eligibility ─────────────────────────────

export interface Check { key: string; ok: boolean; label: string; detail: string }

export async function eligibility(userId: number, creditsNeeded = 0) {
  const m = await getMembership(userId);
  const checks: Check[] = [];
  const verified = m?.status === 'approved';
  checks.push({ key: 'verified', ok: verified, label: 'Verified resident',
    detail: verified ? `Member of ${m!.society_name}` : 'Your society admin needs to verify your membership.' });
  if (!verified) return { eligible: false, checks, limits: null };

  const s = await settingsFor(m!.society_id);
  const w = await ensureWallet(userId);
  const u = (await one<{ restricted_until: number | null }>('SELECT restricted_until FROM users WHERE id = ?', userId))!;
  const restricted = !!u.restricted_until && u.restricted_until > now();
  checks.push({ key: 'restriction', ok: !restricted, label: 'Good pickup record',
    detail: restricted ? `Requests are paused until ${new Date(u.restricted_until!).toLocaleString('en-IN')} after repeated missed pickups.`
      : `Missing ${s.strike_limit} pickups in 30 days pauses requests for ${s.restriction_days} days.` });

  const { active } = (await one<{ active: number }>(`SELECT COUNT(*) AS active FROM exchange_requests WHERE requester_id = ? AND status IN ${OPEN}`, userId))!;
  checks.push({ key: 'active', ok: active < s.max_active_requests, label: 'Open requests',
    detail: `${active} of ${s.max_active_requests} open requests in use.` });

  const after = w.balance - creditsNeeded;
  checks.push({ key: 'balance', ok: after >= s.min_balance, label: 'Enough credits',
    detail: creditsNeeded
      ? (after >= s.min_balance ? `You'll have ${after} credits left.` : `You need ${creditsNeeded} credits but can go only down to ${s.min_balance}. Share something to earn more.`)
      : `${w.balance} available. Balance can dip to ${s.min_balance} at most.` });

  const { week } = (await one<{ week: number }>(
    `SELECT COALESCE(SUM(credits),0) AS week FROM exchange_requests WHERE requester_id = ? AND status IN ('pending','accepted','completed') AND created_at > ?`,
    userId, now() - 7 * DAY))!;
  checks.push({ key: 'weekly', ok: week + creditsNeeded <= s.weekly_receive_cap, label: 'Weekly receiving limit',
    detail: `${week} of ${s.weekly_receive_cap} credits received in the last 7 days.` });

  const lastShare = (await one<{ t: number | null }>('SELECT MAX(completed_at) AS t FROM completed_exchanges WHERE giver_id = ?', userId))!.t ?? 0;
  const { since } = (await one<{ since: number }>(
    `SELECT COUNT(*) AS since FROM exchange_requests WHERE requester_id = ? AND (status IN ${OPEN} OR (status = 'completed' AND closed_at > ?))`,
    userId, lastShare))!;
  const left = s.max_receives_without_sharing - since;
  checks.push({ key: 'give_take', ok: left > 0, label: 'Give & take balance',
    detail: left > 0
      ? `${left} more ${left === 1 ? 'pickup' : 'pickups'} before you'll need to share something.`
      : `You've received ${since} times since you last shared. Share something to keep receiving.` });

  return {
    eligible: checks.every((c) => c.ok),
    checks,
    limits: { balance: w.balance, held: w.held, min_balance: s.min_balance, max_spend: Math.max(0, w.balance - s.min_balance),
      weekly_used: week, weekly_cap: s.weekly_receive_cap },
  };
}

// ───────────────────────────── Helpers ─────────────────────────────

/** Loads and locks an exchange row: concurrent actions on one exchange run one after another. */
async function lockEx(id: number) {
  const e = await one<Exchange>('SELECT * FROM exchange_requests WHERE id = ? FOR UPDATE', id);
  if (!e) throw notFound('Exchange');
  return e;
}
const loadListing = async (id: number) => (await one<ListingRow>('SELECT * FROM listings WHERE id = ?', id))!;
const label = (l: ListingRow, qty: number) => `${formatQty(l.unit_type, qty)} ${l.name}`;

const returnQuantity = (e: Exchange) =>
  run('UPDATE listings SET qty_available = qty_available + ?, updated_at = ? WHERE id = ?', e.quantity, now(), e.listing_id);

const close = (e: Exchange, status: Exchange['status'], by: 'requester' | 'owner' | 'system' | null, reason: string) =>
  run('UPDATE exchange_requests SET status = ?, cancelled_by = ?, close_reason = ?, closed_at = ? WHERE id = ?', status, by, reason, now(), e.id);

/** After a request finishes, mark the listing done if everything has been handed over. */
async function maybeFinishListing(listingId: number) {
  const l = await loadListing(listingId);
  const open = (await one<{ n: number }>(`SELECT COUNT(*) AS n FROM exchange_requests WHERE listing_id = ? AND status IN ${OPEN}`, listingId))!.n;
  if (l.qty_available === 0 && open === 0 && ['active', 'paused'].includes(l.status))
    await run(`UPDATE listings SET status = 'completed', updated_at = ? WHERE id = ?`, now(), listingId);
}

// ───────────────────────────── Actions ─────────────────────────────

export async function requestListing(userId: number, listingId: number, quantity: number, message = '') {
  const id = await tx(async () => {
    const m = await requireMember(userId);
    await lockWallet(userId); // one request at a time per person: eligibility can't be raced
    const l = await one<ListingRow>('SELECT * FROM listings WHERE id = ? FOR UPDATE', listingId);
    if (!l || l.society_id !== m.society_id || ['removed', 'hidden'].includes(l.status)) throw notFound('Listing');
    if (l.owner_id === userId) throw bad("You can't request your own produce.");
    if (l.status !== 'active' || l.available_until <= now()) throw new AppError(409, 'unavailable', 'This produce is no longer available.');
    if (await one(`SELECT 1 FROM exchange_requests WHERE listing_id = ? AND requester_id = ? AND status IN ${OPEN}`, listingId, userId))
      throw new AppError(409, 'duplicate', 'You already have a request for this item.');

    if (!Number.isInteger(quantity) || quantity <= 0) throw bad('Choose a valid quantity.');
    const min = minRequest(l);
    if (quantity < min) throw bad(`The smallest amount you can request is ${formatQty(l.unit_type, min)}.`);
    if (quantity > l.qty_available)
      throw new AppError(409, 'insufficient_quantity', `Only ${formatQty(l.unit_type, l.qty_available)} is still available.`, { available: l.qty_available });

    const s = await settingsFor(m.society_id);
    const cost = priceFor(l.unit_type, l.rate, quantity, s.min_credits_per_exchange);
    const el = await eligibility(userId, cost);
    if (!el.eligible) {
      const failed = el.checks.find((c) => !c.ok)!;
      throw new AppError(403, 'not_eligible', failed.detail, { checks: el.checks });
    }

    // Atomic reservation: succeeds only if enough quantity is still free.
    const res = await run(`UPDATE listings SET qty_available = qty_available - ?, updated_at = ? WHERE id = ? AND status = 'active' AND qty_available >= ?`,
      quantity, now(), listingId, quantity);
    if (res.rowCount !== 1) throw new AppError(409, 'insufficient_quantity', 'Someone just booked this. Please choose a smaller quantity.');

    const { id } = (await one<{ id: number }>(
      `INSERT INTO exchange_requests (listing_id, society_id, requester_id, owner_id, quantity, credits, status, message, created_at)
       VALUES (?,?,?,?,?,?, 'pending', ?, ?) RETURNING id`, listingId, l.society_id, userId, l.owner_id, quantity, cost, message, now()))!;
    await credits.hold(userId, cost, id, label(l, quantity));
    const u = (await one<{ name: string }>('SELECT name FROM users WHERE id = ?', userId))!;
    await notify(l.owner_id, 'request_new', `${firstName(u.name)} requested ${label(l, quantity)}`,
      message || 'Accept or decline the request.', `/exchanges/${id}`);
    return id;
  });
  return getExchange(userId, id);
}

export async function acceptRequest(ownerId: number, id: number, note = '') {
  await tx(async () => {
    await requireMember(ownerId);
    const e = await lockEx(id);
    if (e.owner_id !== ownerId) throw forbidden();
    if (e.status !== 'pending') throw bad('This request is no longer pending.');
    const l = await loadListing(e.listing_id);
    await run(`UPDATE exchange_requests SET status = 'accepted', accepted_at = ?, owner_note = ? WHERE id = ?`, now(), note, id);
    await credits.spend(e.requester_id, e.credits, id, label(l, e.quantity));
    const owner = (await getMembership(ownerId))!;
    await notify(e.requester_id, 'request_accepted', `Your request for ${l.name} was accepted`,
      `Collect from ${[owner.wing, owner.building].filter(Boolean).join(', ')}, Flat ${owner.flat} before ${new Date(l.available_until).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}.`,
      `/exchanges/${id}`);
  });
  return getExchange(ownerId, id);
}

async function rejectLocked(e: Exchange, reason: string) {
  const l = await loadListing(e.listing_id);
  await close(e, 'rejected', 'owner', reason || 'Declined by contributor');
  await returnQuantity(e);
  await credits.release(e.requester_id, e.credits, e.id, `Request declined: ${label(l, e.quantity)}`);
  await notify(e.requester_id, 'request_rejected', `Request for ${l.name} declined`,
    `${reason || 'The contributor could not fulfil this one.'} Your ${e.credits} credits are back in your wallet.`, `/exchanges/${e.id}`);
}

export async function rejectRequest(ownerId: number, id: number, reason = '') {
  await tx(async () => {
    await requireMember(ownerId);
    const e = await lockEx(id);
    if (e.owner_id !== ownerId) throw forbidden();
    if (e.status !== 'pending') throw bad('This request is no longer pending.');
    await rejectLocked(e, reason);
  });
  return getExchange(ownerId, id);
}

export async function cancelRequest(userId: number, id: number, reason = '') {
  await tx(async () => {
    await requireMember(userId);
    const e = await lockEx(id);
    const isOwner = e.owner_id === userId, isRequester = e.requester_id === userId;
    if (!isOwner && !isRequester) throw forbidden();
    if (e.status === 'pending' && isOwner) return rejectLocked(e, reason);
    if (!['pending', 'accepted'].includes(e.status)) throw bad('This exchange is already closed.');
    if (e.requester_confirmed) throw bad('The produce has already been confirmed as received, so this can no longer be cancelled.');
    if (isRequester && e.owner_confirmed) throw bad('The contributor marked this as handed over. Confirm it, or use "Decline produce" if there was a problem.');
    const l = await loadListing(e.listing_id);
    const s = await settingsFor(e.society_id);
    const what = label(l, e.quantity);
    await close(e, 'cancelled', isOwner ? 'owner' : 'requester', reason || (isOwner ? 'Cancelled by contributor' : 'Cancelled by requester'));
    await returnQuantity(e);
    if (e.status === 'pending') {
      await credits.release(e.requester_id, e.credits, id, `You cancelled your request: ${what}`);
      await notify(e.owner_id, 'request_cancelled', `Request for ${l.name} withdrawn`, 'The quantity is available to others again.', `/listing/${l.id}`);
    } else if (isOwner) {
      await credits.refund(e.requester_id, e.credits, id, `Contributor cancelled: ${what}`);
      await addStrike(userId, id, 'contributor_cancelled_after_accepting', s);
      await notify(e.requester_id, 'booking_cancelled', `${l.name} pickup cancelled`,
        `${reason || 'The contributor is no longer able to share this.'} All ${e.credits} credits have been refunded.`, `/exchanges/${id}`);
    } else {
      await credits.refund(e.requester_id, e.credits, id, `You cancelled a confirmed booking: ${what}`);
      await addStrike(userId, id, 'requester_cancelled_after_accepting', s);
      await notify(e.owner_id, 'booking_cancelled', `Pickup of ${l.name} cancelled`, reason || 'The neighbour cancelled the pickup.', `/listing/${l.id}`);
    }
  });
  return getExchange(userId, id);
}

/** Must be called with the exchange row locked. Idempotent thanks to the UNIQUE exchange_id on completed_exchanges. */
async function complete(e: Exchange, via: string) {
  const l = await loadListing(e.listing_id);
  const done = await run(`UPDATE exchange_requests SET status = 'completed', closed_at = ?, close_reason = ? WHERE id = ? AND status = 'accepted'`, now(), via, e.id);
  if (done.rowCount !== 1) return;
  await credits.earn(e.owner_id, e.credits, e.id, label(l, e.quantity));
  const grams = l.unit_type === 'weight' ? e.quantity : e.quantity * (l.avg_piece_grams ?? 200);
  await run(`INSERT INTO completed_exchanges (exchange_id, society_id, listing_id, giver_id, receiver_id, produce_name, category, quantity, unit_type, est_grams, credits, completed_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    e.id, e.society_id, l.id, e.owner_id, e.requester_id, l.name, l.category, e.quantity, l.unit_type, grams, e.credits, now());
  await notify(e.owner_id, 'exchange_completed', `+${e.credits} credits for sharing ${l.name}`, 'Thank you for keeping food in the community.', `/exchanges/${e.id}`);
  await notify(e.requester_id, 'exchange_completed', `${l.name} collected`, 'Exchange complete. Enjoy, and share when you have extra!', `/exchanges/${e.id}`);
  await maybeFinishListing(l.id);
}

/**
 * Both parties confirm the handover. When only one side has confirmed, the exchange completes
 * automatically after CONFIRM_WINDOW (see sweep), so a forgetful neighbour never blocks credits.
 */
export async function confirmExchange(userId: number, id: number) {
  await tx(async () => {
    await requireMember(userId);
    const e = await lockEx(id);
    if (e.owner_id !== userId && e.requester_id !== userId) throw forbidden();
    if (e.status !== 'accepted') throw bad('Only confirmed bookings can be marked as collected.');
    const l = await loadListing(e.listing_id);
    const asOwner = e.owner_id === userId;
    if (asOwner ? e.owner_confirmed : e.requester_confirmed) throw bad('You have already confirmed this exchange.');
    await run(`UPDATE exchange_requests SET ${asOwner ? 'owner_confirmed = 1, owner_confirmed_at' : 'requester_confirmed = 1, requester_confirmed_at'} = ? WHERE id = ?`, now(), id);
    const otherDone = asOwner ? e.requester_confirmed : e.owner_confirmed;
    if (otherDone) await complete(e, 'both_confirmed');
    else if (asOwner) await notify(e.requester_id, 'confirm_needed', `Did you collect ${l.name}?`,
      'The contributor marked it as handed over. Please confirm. It completes automatically in 24 hours.', `/exchanges/${id}`);
    else await notify(e.owner_id, 'confirm_needed', `${l.name} was collected`,
      `Confirm the handover to receive your ${e.credits} credits. It completes automatically in 24 hours.`, `/exchanges/${id}`);
  });
  return getExchange(userId, id);
}

/** Receiver inspected the produce at pickup and turned it down: full refund, no strike, and a quality report. */
export async function declineAtPickup(userId: number, id: number, details = '') {
  await tx(async () => {
    const m = await requireMember(userId);
    const e = await lockEx(id);
    if (e.requester_id !== userId) throw forbidden();
    if (e.status !== 'accepted') throw bad('Only confirmed bookings can be declined at pickup.');
    if (e.requester_confirmed) throw bad('You have already confirmed receiving this.');
    const l = await loadListing(e.listing_id);
    await close(e, 'cancelled', 'requester', 'Declined at pickup: quality concern');
    // The quantity is NOT returned to the listing: produce that failed inspection shouldn't be offered again.
    await credits.refund(e.requester_id, e.credits, id, `Declined at pickup (quality): ${label(l, e.quantity)}`);
    if (!(await one('SELECT 1 FROM reports WHERE listing_id = ? AND reporter_id = ?', l.id, userId)))
      await run(`INSERT INTO reports (society_id, listing_id, reporter_id, reason, details, created_at) VALUES (?,?,?, 'misdescribed', ?, ?)`,
        m.society_id, l.id, userId, details || 'Declined at pickup after inspection', now());
    await notify(e.owner_id, 'declined_at_pickup', `${l.name} was declined at pickup`,
      `Your neighbour didn't accept the produce after inspecting it${details ? `: "${details}"` : '.'} No credits were exchanged.`, `/exchanges/${id}`);
    await notifyAdmins(m.society_id, 'report', `Quality concern: ${l.name}`, `A resident declined this at pickup. ${details}`.trim(), '/admin');
    await maybeFinishListing(l.id);
  });
  return getExchange(userId, id);
}

export async function markNoShow(ownerId: number, id: number) {
  await tx(async () => {
    await requireMember(ownerId);
    const e = await lockEx(id);
    if (e.owner_id !== ownerId) throw forbidden();
    if (e.status !== 'accepted') throw bad('Only confirmed bookings can be marked as not collected.');
    if (e.requester_confirmed) throw bad('Your neighbour has already confirmed collecting this.');
    if (e.owner_confirmed) throw bad('You already marked this as handed over.');
    const l = await loadListing(e.listing_id);
    if (now() < l.pickup_from) throw bad('The pickup window has not started yet.');
    const s = await settingsFor(e.society_id);
    await close(e, 'no_show', 'owner', 'Not collected');
    await returnQuantity(e);
    const penalty = Math.min(s.no_show_penalty, e.credits);
    await credits.refund(e.requester_id, e.credits, id, `Not collected: ${label(l, e.quantity)}`);
    if (penalty > 0) await credits.penalty(e.requester_id, penalty, id, 'Missed pickup fee');
    await addStrike(e.requester_id, id, 'no_show', s);
    await notify(e.requester_id, 'no_show', `Missed pickup: ${l.name}`,
      `The contributor marked this as not collected. ${e.credits - penalty} of ${e.credits} credits were refunded.`, `/exchanges/${id}`);
  });
  return getExchange(ownerId, id);
}

/** Used when a listing is removed or hidden. Must be called inside a transaction with the listing locked. */
export async function closeOpenRequestsForListing(l: ListingRow, why: 'owner_removed' | 'hidden' | 'admin_removed', opts: { pendingOnly?: boolean } = {}) {
  const s = await settingsFor(l.society_id);
  for (const e of await all<Exchange>(`SELECT * FROM exchange_requests WHERE listing_id = ? AND status IN ${OPEN} FOR UPDATE`, l.id)) {
    if (opts.pendingOnly && e.status !== 'pending') continue;
    const what = label(l, e.quantity);
    await close(e, 'cancelled', why === 'owner_removed' ? 'owner' : 'system', why);
    await returnQuantity(e);
    if (e.status === 'pending') await credits.release(e.requester_id, e.credits, e.id, `Listing withdrawn: ${what}`);
    else {
      await credits.refund(e.requester_id, e.credits, e.id, `Listing withdrawn: ${what}`);
      if (why === 'owner_removed') await addStrike(l.owner_id, e.id, 'contributor_cancelled_after_accepting', s);
    }
    await notify(e.requester_id, 'booking_cancelled', `${l.name} is no longer available`,
      `${why === 'owner_removed' ? 'The contributor withdrew this listing.' : 'This listing was withdrawn after a quality review.'} Your ${e.credits} credits have been returned.`,
      `/exchanges/${e.id}`);
  }
}

/**
 * Expire listings and resolve stale bookings. Idempotent and safe to run from several server
 * instances at once: rows are claimed with FOR UPDATE SKIP LOCKED and re-checked after locking.
 */
export async function sweep() {
  const t = now();
  return tx(async () => {
    let changed = 0;
    for (const l of await all<ListingRow>(`SELECT * FROM listings WHERE status IN ('active','paused') AND available_until <= ? FOR UPDATE SKIP LOCKED`, t)) {
      for (const e of await all<Exchange>(`SELECT * FROM exchange_requests WHERE listing_id = ? AND status = 'pending' FOR UPDATE SKIP LOCKED`, l.id)) {
        await close(e, 'expired', 'system', 'Contributor did not respond before the deadline');
        await credits.release(e.requester_id, e.credits, e.id, `Request expired: ${label(l, e.quantity)}`);
        await notify(e.requester_id, 'request_expired', `Request for ${l.name} expired`, `The contributor didn't respond in time. ${e.credits} credits returned.`, `/exchanges/${e.id}`);
        changed++;
      }
      await run(`UPDATE listings SET status = 'expired', updated_at = ? WHERE id = ?`, t, l.id);
      if (l.qty_available > 0) await notify(l.owner_id, 'listing_expired', `${l.name} listing expired`, 'The collection deadline passed. You can share it again if it is still fresh.', `/listing/${l.id}`);
      changed++;
    }
    for (const e of await all<Exchange>(
      `SELECT * FROM exchange_requests WHERE status = 'accepted' AND
         ((requester_confirmed = 1 AND requester_confirmed_at + ? <= ?) OR (owner_confirmed = 1 AND owner_confirmed_at + ? <= ?))
       FOR UPDATE SKIP LOCKED`, CONFIRM_WINDOW, t, CONFIRM_WINDOW, t)) {
      await complete(e, 'auto_completed');
      changed++;
    }
    for (const e of await all<Exchange>(
      `SELECT e.* FROM exchange_requests e JOIN listings l ON l.id = e.listing_id
       WHERE e.status = 'accepted' AND l.available_until + ? <= ? FOR UPDATE OF e SKIP LOCKED`, GRACE_AFTER_DEADLINE, t)) {
      if (e.owner_confirmed || e.requester_confirmed) await complete(e, 'auto_completed');
      else {
        const l = await loadListing(e.listing_id);
        await close(e, 'expired', 'system', 'Neither side confirmed the pickup');
        await credits.refund(e.requester_id, e.credits, e.id, `Pickup not confirmed: ${label(l, e.quantity)}`);
        await notify(e.requester_id, 'booking_expired', `${l.name} pickup not confirmed`, 'Credits refunded.', `/exchanges/${e.id}`);
        await notify(e.owner_id, 'booking_expired', `${l.name} pickup not confirmed`, 'Neither side confirmed this pickup, so it was closed.', `/exchanges/${e.id}`);
      }
      changed++;
    }
    return changed;
  });
}

// ───────────────────────────── Queries ─────────────────────────────

const EX_SELECT = `
  SELECT e.*, l.name AS produce_name, l.photo_url, l.unit_type, l.category, l.available_until, l.pickup_from, l.pickup_note,
    l.status AS listing_status, c.emoji,
    ru.name AS requester_name, rm.building AS r_building, rm.wing AS r_wing, rm.flat AS r_flat,
    ou.name AS owner_name, om.building AS o_building, om.wing AS o_wing, om.flat AS o_flat
  FROM exchange_requests e
  JOIN listings l ON l.id = e.listing_id
  LEFT JOIN produce_catalog c ON c.id = l.catalog_id
  JOIN users ru ON ru.id = e.requester_id LEFT JOIN memberships rm ON rm.user_id = e.requester_id
  JOIN users ou ON ou.id = e.owner_id LEFT JOIN memberships om ON om.user_id = e.owner_id`;

function shape(r: any, viewerId: number) {
  const role = r.owner_id === viewerId ? 'giver' : 'receiver';
  const reveal = ['accepted', 'completed'].includes(r.status); // flat no. only once a pickup is agreed
  const other = role === 'giver'
    ? { name: r.requester_name, building: r.r_building, wing: r.r_wing, flat: r.r_flat }
    : { name: r.owner_name, building: r.o_building, wing: r.o_wing, flat: r.o_flat };
  return {
    id: r.id, listing_id: r.listing_id, role, status: r.status, quantity: r.quantity, credits: r.credits,
    quantity_label: formatQty(r.unit_type, r.quantity), message: r.message, owner_note: r.owner_note,
    cancelled_by: r.cancelled_by, close_reason: r.close_reason,
    owner_confirmed: !!r.owner_confirmed, requester_confirmed: !!r.requester_confirmed,
    owner_confirmed_at: r.owner_confirmed_at, requester_confirmed_at: r.requester_confirmed_at,
    created_at: r.created_at, accepted_at: r.accepted_at, closed_at: r.closed_at,
    produce: { name: r.produce_name, photo_url: r.photo_url, emoji: r.emoji, category: r.category, unit_type: r.unit_type,
      pickup_from: r.pickup_from, available_until: r.available_until, pickup_note: r.pickup_note, status: r.listing_status },
    counterparty: {
      name: reveal ? other.name : firstName(other.name),
      location: [other.wing, other.building].filter(Boolean).join(', '),
      flat: reveal ? other.flat : null,
    },
  };
}

export async function getExchange(userId: number, id: number) {
  const r = await one(`${EX_SELECT} WHERE e.id = ?`, id);
  if (!r || (r.owner_id !== userId && r.requester_id !== userId)) throw notFound('Exchange');
  return shape(r, userId);
}

export async function listExchanges(userId: number) {
  await requireMember(userId);
  return (await all(`${EX_SELECT} WHERE e.owner_id = ? OR e.requester_id = ? ORDER BY COALESCE(e.closed_at, e.accepted_at, e.created_at) DESC LIMIT 200`, userId, userId))
    .map((r) => shape(r, userId));
}
