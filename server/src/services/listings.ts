import { all, one, run, tx, now } from '../db.ts';
import { DEFAULT_RATES } from '../catalog.ts';
import { priceFor } from '../credits.ts';
import { AppError, bad, DAY, firstName, forbidden, notFound, notify, notifyAdmins, requireMember, settingsFor } from './common.ts';
import { closeOpenRequestsForListing } from './exchanges.ts';

export type Category = 'fruit' | 'vegetable' | 'leafy';
export interface ListingRow {
  id: number; society_id: number; owner_id: number; catalog_id: number | null; name: string; category: Category;
  unit_type: 'weight' | 'piece'; display_unit: 'g' | 'kg' | 'pcs'; qty_total: number; qty_available: number;
  rate: number; avg_piece_grams: number | null; photo_url: string; purchase_date: string | null;
  condition: 'fresh' | 'good' | 'use_soon'; pickup_from: number; available_until: number; pickup_note: string;
  notes: string; status: string; created_at: number; updated_at: number;
}

export interface ListingInput {
  name: string;
  category: Category;
  quantity: number;          // in display unit
  unit: 'g' | 'kg' | 'pcs';
  photo_url: string;
  purchase_date?: string | null;
  condition: 'fresh' | 'good' | 'use_soon';
  declared: boolean;
  pickup_from?: number;
  available_until: number;
  pickup_note?: string;
  notes?: string;
}

const MAX_WINDOW = 7 * DAY;
const toBase = (q: number, unit: string) => (unit === 'kg' ? Math.round(q * 1000) : Math.round(q));

function validateWindow(from: number, until: number) {
  if (until <= now() + 15 * 60_000) throw bad('The collection deadline must be at least 15 minutes from now.');
  if (until > now() + MAX_WINDOW) throw bad('Fresh produce should be collected within 7 days. Choose an earlier deadline.');
  if (from >= until) throw bad('Pickup must start before the collection deadline.');
}

export function minRequest(l: Pick<ListingRow, 'unit_type' | 'qty_available'>) {
  if (l.unit_type === 'piece') return 1;
  return Math.min(l.qty_available, 100);
}

export function serialize(l: ListingRow & Record<string, any>, viewerId: number, minCredits: number) {
  return {
    id: l.id,
    name: l.name,
    category: l.category,
    emoji: l.emoji ?? null,
    unit_type: l.unit_type,
    display_unit: l.display_unit,
    qty_total: l.qty_total,
    qty_available: l.qty_available,
    min_request: minRequest(l),
    rate: l.rate,
    credits_per_unit: l.rate, // per kg or per piece
    credits_for_all: l.qty_available > 0 ? priceFor(l.unit_type, l.rate, l.qty_available, minCredits) : 0,
    credits_example: priceFor(l.unit_type, l.rate, l.unit_type === 'weight' ? Math.min(500, l.qty_available || 500) : 1, minCredits),
    min_credits: minCredits,
    unit_base: l.unit_type === 'weight' ? 1000 : 1,
    photo_url: l.photo_url,
    purchase_date: l.purchase_date,
    condition: l.condition,
    pickup_from: l.pickup_from,
    available_until: l.available_until,
    pickup_note: l.pickup_note,
    notes: l.notes,
    status: l.status,
    created_at: l.created_at,
    is_mine: l.owner_id === viewerId,
    open_requests: l.open_requests ?? undefined,
    contributor: {
      first_name: firstName(l.owner_name ?? ''),
      avatar_url: l.owner_avatar ?? null,
      location: [l.owner_wing, l.owner_building].filter(Boolean).join(', '),
      shares: l.owner_shares ?? 0,
    },
  };
}

const BASE_SELECT = `
  SELECT l.*, c.emoji, u.name AS owner_name, u.avatar_url AS owner_avatar, m.building AS owner_building, m.wing AS owner_wing,
    (SELECT COUNT(*) FROM completed_exchanges ce WHERE ce.giver_id = l.owner_id) AS owner_shares,
    (SELECT COUNT(*) FROM exchange_requests e WHERE e.listing_id = l.id AND e.status IN ('pending','accepted')) AS open_requests
  FROM listings l
  JOIN users u ON u.id = l.owner_id
  LEFT JOIN memberships m ON m.user_id = l.owner_id
  LEFT JOIN produce_catalog c ON c.id = l.catalog_id`;

export async function createListing(userId: number, input: ListingInput) {
  const m = await requireMember(userId);
  if (!input.declared) throw bad('Please confirm that the produce is fresh, clean and safe to eat.');
  if (!input.photo_url) throw bad('A photo of the produce is required.');
  const pickupFrom = input.pickup_from ?? now();
  validateWindow(pickupFrom, input.available_until);

  const catalog = await one<{ id: number; category: Category; unit_type: 'weight' | 'piece'; rate: number; avg_piece_grams: number | null }>(
    'SELECT * FROM produce_catalog WHERE lower(name) = lower(?)', input.name.trim());
  const unitType = input.unit === 'pcs' ? 'piece' : 'weight';
  const category = catalog?.category ?? input.category;
  const rate = catalog && catalog.unit_type === unitType ? catalog.rate : unitType === 'weight' ? DEFAULT_RATES[category] : 3;
  const qty = toBase(input.quantity, input.unit);
  if (unitType === 'weight' && qty < 100) throw bad('Please share at least 100 g.');
  if (unitType === 'weight' && qty > 25_000) throw bad('That is more than a household surplus (max 25 kg).');
  if (unitType === 'piece' && (qty < 1 || qty > 200)) throw bad('Pieces must be between 1 and 200.');

  const t = now();
  const name = catalog ? input.name.trim().replace(/^\w/, (c) => c.toUpperCase()) : input.name.trim();
  const { id } = (await one<{ id: number }>(
    `INSERT INTO listings (society_id, owner_id, catalog_id, name, category, unit_type, display_unit, qty_total, qty_available, rate,
       avg_piece_grams, photo_url, purchase_date, condition, pickup_from, available_until, pickup_note, notes, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'active', ?, ?) RETURNING id`,
    m.society_id, userId, catalog?.id ?? null, name, category, unitType, input.unit, qty, qty, rate,
    catalog?.avg_piece_grams ?? (unitType === 'piece' ? 200 : null),
    input.photo_url, input.purchase_date ?? null, input.condition, pickupFrom, input.available_until,
    input.pickup_note ?? '', input.notes ?? '', t, t))!;
  return getListing(userId, id);
}

/** Locks the listing row for the rest of the transaction and checks ownership. */
async function ownListingForUpdate(userId: number, id: number) {
  const l = await one<ListingRow>('SELECT * FROM listings WHERE id = ? FOR UPDATE', id);
  if (!l) throw notFound('Listing');
  if (l.owner_id !== userId) throw forbidden('Only the person who shared this can change it.');
  return l;
}

export async function updateListing(userId: number, id: number, patch: Partial<ListingInput>) {
  await tx(async () => {
    await requireMember(userId);
    const l = await ownListingForUpdate(userId, id);
    if (!['active', 'paused'].includes(l.status)) throw bad('This listing can no longer be edited.');
    const from = patch.pickup_from ?? l.pickup_from;
    const until = patch.available_until ?? l.available_until;
    if (patch.pickup_from !== undefined || patch.available_until !== undefined) validateWindow(from, until);

    let total = l.qty_total, avail = l.qty_available;
    if (patch.quantity !== undefined) {
      if (patch.unit && (patch.unit === 'pcs') !== (l.unit_type === 'piece')) throw bad('The unit type cannot be changed after listing.');
      const newTotal = toBase(patch.quantity, patch.unit ?? l.display_unit);
      const committed = l.qty_total - l.qty_available; // reserved or already handed over
      if (newTotal < committed) throw bad('You have already promised more than that to neighbours.');
      if (newTotal <= 0) throw bad('Quantity must be more than 0.');
      total = newTotal;
      avail = newTotal - committed;
    }
    await run(`UPDATE listings SET qty_total=?, qty_available=?, display_unit=?, photo_url=?, condition=?, pickup_from=?, available_until=?,
         pickup_note=?, notes=?, purchase_date=?, updated_at=? WHERE id=?`,
      total, avail, patch.unit ?? l.display_unit, patch.photo_url ?? l.photo_url, patch.condition ?? l.condition, from, until,
      patch.pickup_note ?? l.pickup_note, patch.notes ?? l.notes, patch.purchase_date === undefined ? l.purchase_date : patch.purchase_date, now(), id);
  });
  return getListing(userId, id);
}

export async function setListingStatus(userId: number, id: number, status: 'active' | 'paused' | 'removed') {
  await tx(async () => {
    await requireMember(userId);
    const l = await ownListingForUpdate(userId, id);
    if (!['active', 'paused'].includes(l.status)) throw bad('This listing is already closed.');
    if (status === 'active' && l.available_until <= now()) throw bad('The collection deadline has passed. Edit the deadline first.');
    if (status === 'removed') await closeOpenRequestsForListing(l, 'owner_removed');
    await run('UPDATE listings SET status = ?, updated_at = ? WHERE id = ?', status, now(), id);
  });
  return getListing(userId, id);
}

export async function getListing(viewerId: number, id: number) {
  const m = await requireMember(viewerId);
  const l = await one<ListingRow & Record<string, any>>(`${BASE_SELECT} WHERE l.id = ?`, id);
  if (!l || l.society_id !== m.society_id) throw notFound('Listing');
  const mine = l.owner_id === viewerId;
  if (!mine && ['removed', 'hidden'].includes(l.status)) throw notFound('Listing');
  const s = await settingsFor(l.society_id);
  const out: any = serialize(l, viewerId, s.min_credits_per_exchange);
  out.my_request = (await one(
    `SELECT id, status, quantity, credits FROM exchange_requests WHERE listing_id = ? AND requester_id = ? AND status IN ('pending','accepted')`,
    id, viewerId)) ?? null;
  out.reported_by_me = !!(await one('SELECT 1 FROM reports WHERE listing_id = ? AND reporter_id = ?', id, viewerId));
  if (mine) {
    out.requests = (await all(
      `SELECT e.id, e.quantity, e.credits, e.status, e.message, e.created_at, u.name AS requester_name, m.building, m.wing, m.flat
       FROM exchange_requests e JOIN users u ON u.id = e.requester_id LEFT JOIN memberships m ON m.user_id = e.requester_id
       WHERE e.listing_id = ? ORDER BY e.status = 'pending' DESC, e.created_at DESC`, id,
    )).map((r: any) => ({
      ...r,
      requester_name: ['accepted', 'completed'].includes(r.status) ? r.requester_name : firstName(r.requester_name),
      location: [r.wing, r.building].filter(Boolean).join(', '),
      flat: ['accepted', 'completed'].includes(r.status) ? r.flat : undefined,
      building: undefined, wing: undefined,
    }));
  }
  return out;
}

export async function marketplace(viewerId: number, opts: { q?: string; category?: string; sort?: string }) {
  const m = await requireMember(viewerId);
  const where = [`l.society_id = ?`, `l.status = 'active'`, `l.qty_available > 0`, `l.available_until > ?`];
  const params: unknown[] = [m.society_id, now()];
  if (opts.q?.trim()) { where.push('l.name ILIKE ?'); params.push(`%${opts.q.trim()}%`); }
  if (opts.category && ['fruit', 'vegetable', 'leafy'].includes(opts.category)) { where.push('l.category = ?'); params.push(opts.category); }
  const order = opts.sort === 'expiring' ? 'l.available_until ASC' : opts.sort === 'quantity' ? 'l.qty_available DESC' : 'l.created_at DESC';
  const s = await settingsFor(m.society_id);
  return (await all<ListingRow>(`${BASE_SELECT} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT 100`, ...params))
    .map((l) => serialize(l as any, viewerId, s.min_credits_per_exchange));
}

export async function myListings(userId: number) {
  const m = await requireMember(userId);
  const s = await settingsFor(m.society_id);
  return (await all<ListingRow>(`${BASE_SELECT} WHERE l.owner_id = ? AND l.status != 'removed' ORDER BY l.status = 'active' DESC, l.created_at DESC LIMIT 100`, userId))
    .map((l) => serialize(l as any, userId, s.min_credits_per_exchange));
}

export function reportListing(userId: number, listingId: number, reason: string, details: string) {
  return tx(async () => {
    const m = await requireMember(userId);
    const l = await one<ListingRow>('SELECT * FROM listings WHERE id = ? FOR UPDATE', listingId);
    if (!l || l.society_id !== m.society_id || ['removed', 'hidden'].includes(l.status)) throw notFound('Listing');
    if (l.owner_id === userId) throw bad("You can't report your own listing.");
    if (await one('SELECT 1 FROM reports WHERE listing_id = ? AND reporter_id = ?', listingId, userId))
      throw new AppError(409, 'conflict', 'You have already reported this listing. Thank you.');
    await run('INSERT INTO reports (society_id, listing_id, reporter_id, reason, details, created_at) VALUES (?,?,?,?,?,?)',
      m.society_id, listingId, userId, reason, details, now());
    await notifyAdmins(m.society_id, 'report', `Listing reported: ${l.name}`, `Reason: ${reason.replace('_', ' ')}. ${details}`.trim(), '/admin');
    const s = await settingsFor(m.society_id);
    const { n } = (await one<{ n: number }>(`SELECT COUNT(*) AS n FROM reports WHERE listing_id = ? AND status = 'open'`, listingId))!;
    if (n >= s.report_hide_threshold && ['active', 'paused'].includes(l.status)) {
      await closeOpenRequestsForListing(l, 'hidden', { pendingOnly: true });
      await run(`UPDATE listings SET status = 'hidden', updated_at = ? WHERE id = ?`, now(), listingId);
      await notify(l.owner_id, 'listing_hidden', `${l.name} is hidden for review`,
        'Several neighbours reported a quality concern. A society admin will review it.', `/listing/${l.id}`);
    }
    return { ok: true };
  });
}
