if (!process.env.DATABASE_URL) process.env.DB_PATH = ':memory:';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const { createApp } = await import('../src/app.ts');
const { run, one, closeDb } = await import('../src/db.ts');
const { sweep } = await import('../src/services/exchanges.ts');

let server: Server, base = '';
after(async () => { await new Promise<void>((r) => server.close(() => r())); await closeDb(); });

// Tiny PNG so uploads go through the real multipart path
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

class Client {
  cookie = '';
  async call(method: string, path: string, body?: unknown) {
    const isForm = body instanceof FormData;
    const res = await fetch(base + path, {
      method, headers: { ...(isForm ? {} : { 'content-type': 'application/json' }), cookie: this.cookie },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0];
    const json: any = await res.json();
    return { status: res.status, body: json };
  }
  async ok(method: string, path: string, body?: unknown) {
    const r = await this.call(method, path, body);
    assert.ok(r.status < 300, `${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  }
  get = (p: string) => this.ok('GET', p);
  post = (p: string, b: unknown = {}) => this.ok('POST', p, b);
}

let n = 0;
async function user(name: string) {
  const c = new Client();
  n++;
  await c.post('/auth/register', { name, email: `u${n}@t.test`, password: 'password123' });
  return c;
}
const wallet = async (c: Client) => (await c.get('/wallet')).wallet;

let admin: Client, societyId: number;
async function resident(name: string) {
  const c = await user(name);
  const m = await c.post(`/societies/${societyId}/join`, { building: 'A', wing: '', flat: String(100 + n) });
  await admin.post(`/admin/members/${m.membership_id}/review`, { approve: true });
  return c;
}
async function photo(c: Client) {
  const fd = new FormData();
  fd.append('photo', new Blob([PNG], { type: 'image/png' }), 'p.png');
  return (await c.post('/uploads', fd)).url as string;
}
async function listing(c: Client, extra: Record<string, unknown> = {}) {
  return c.post('/listings', {
    name: 'Tomato', category: 'vegetable', quantity: 2, unit: 'kg', photo_url: await photo(c), condition: 'fresh',
    declared: true, available_until: Date.now() + 24 * 3_600_000, ...extra,
  });
}

before(async () => {
  await new Promise<void>((r) => { server = createApp().listen(0, () => { base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`; r(); }); });
  admin = await user('Admin');
  const m = await admin.post('/societies', { name: 'Test Society', city: 'Pune', area: '', building: 'A', wing: '', flat: '1' });
  societyId = m.society_id;
});

test('full exchange: hold → spend → earn, with ledger', async () => {
  const giver = await resident('Giver');
  const taker = await user('Taker');
  const m = await taker.post(`/societies/${societyId}/join`, { building: 'B', wing: '', flat: '9' });
  assert.equal((await taker.call('GET', '/listings')).status, 403, 'unverified users cannot browse');
  await admin.post(`/admin/members/${m.membership_id}/review`, { approve: true });
  assert.equal((await wallet(taker)).balance, 150, 'starter credits');

  const l = await listing(giver);
  assert.equal(l.qty_available, 2000);
  // Client-supplied credits must be ignored
  const ex = await taker.post(`/listings/${l.id}/request`, { quantity: 500, credits: 1 });
  assert.equal(ex.credits, 10, '0.5 kg tomato @ 20/kg');
  assert.equal(ex.counterparty.flat, null, 'flat hidden until accepted');
  assert.deepEqual(await wallet(taker), { ...(await wallet(taker)), balance: 140, held: 10 });

  const acc = await giver.post(`/exchanges/${ex.id}/accept`, { note: 'come by 6' });
  assert.equal(acc.status, 'accepted');
  assert.ok(acc.counterparty.flat, 'flat revealed after acceptance');
  let w = await wallet(taker);
  assert.equal(w.held, 0); assert.equal(w.total_spent, 10); assert.equal(w.balance, 140);

  assert.equal((await wallet(giver)).total_earned, 0, 'no earning before completion');
  const half = await taker.post(`/exchanges/${ex.id}/confirm`);
  assert.equal(half.status, 'accepted', 'needs both parties');
  assert.equal(half.requester_confirmed, true);
  assert.equal((await taker.call('POST', `/exchanges/${ex.id}/confirm`)).status, 400, 'cannot confirm twice');
  assert.equal((await wallet(giver)).total_earned, 0, 'still no earning with one confirmation');
  const done = await giver.post(`/exchanges/${ex.id}/confirm`);
  assert.equal(done.status, 'completed');
  w = await wallet(giver);
  assert.equal(w.balance, 160); assert.equal(w.total_earned, 10);

  const ledger = (await taker.get('/wallet')).transactions.map((t: any) => t.type).reverse();
  assert.deepEqual(ledger, ['starter', 'hold', 'spend']);
  const stats = await taker.get('/society/stats');
  assert.ok(stats.exchanges >= 1 && stats.veg_grams >= 500);
});

test('one listing serves several partial requests; overbooking is refused', async () => {
  const giver = await resident('G2');
  const l = await listing(giver);
  const takers = await Promise.all([1, 2, 3].map((i) => resident(`T${i}`)));
  for (const t of takers) await t.post(`/listings/${l.id}/request`, { quantity: 500 });
  assert.equal((await one<any>('SELECT qty_available FROM listings WHERE id = ?', l.id))!.qty_available, 500);
  const fourth = await resident('T4');
  const r = await fourth.call('POST', `/listings/${l.id}/request`, { quantity: 1000 });
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'insufficient_quantity');
  assert.equal((await wallet(fourth)).balance, 150, 'no credits taken on failure');
});

test('simultaneous requests for the same quantity: exactly one wins', async () => {
  const giver = await resident('G3');
  const l = await listing(giver, { quantity: 1 });
  const racers = await Promise.all([1, 2, 3, 4, 5].map((i) => resident(`R${i}`)));
  const results = await Promise.all(racers.map((r) => r.call('POST', `/listings/${l.id}/request`, { quantity: 1000 })));
  assert.equal(results.filter((r) => r.status === 200).length, 1);
  assert.equal(results.filter((r) => r.status === 409).length, 4);
  const held = (await one<any>(`SELECT SUM(held) AS h FROM wallets`))!.h;
  assert.equal((await one<any>('SELECT qty_available FROM listings WHERE id = ?', l.id))!.qty_available, 0);
  assert.ok(held >= 20);
});

test('rejection and requester cancellation release credits and quantity', async () => {
  const giver = await resident('G4'); const t = await resident('T5');
  const l = await listing(giver);
  const e1 = await t.post(`/listings/${l.id}/request`, { quantity: 1000 });
  assert.equal((await t.call('POST', `/listings/${l.id}/request`, { quantity: 500 })).status, 409, 'no duplicate open request');
  await giver.post(`/exchanges/${e1.id}/reject`, { reason: 'Sorry' });
  assert.equal((await wallet(t)).balance, 150);
  const e2 = await t.post(`/listings/${l.id}/request`, { quantity: 500 });
  await t.post(`/exchanges/${e2.id}/cancel`);
  assert.equal((await wallet(t)).balance, 150);
  assert.equal((await one<any>('SELECT qty_available FROM listings WHERE id = ?', l.id))!.qty_available, 2000);
});

test('contributor cancels after accepting → full refund and contributor strike', async () => {
  const giver = await resident('G5'); const t = await resident('T6');
  const l = await listing(giver);
  const e = await t.post(`/listings/${l.id}/request`, { quantity: 1000 });
  await giver.post(`/exchanges/${e.id}/accept`);
  assert.equal((await wallet(t)).balance, 130);
  await giver.post(`/exchanges/${e.id}/cancel`, { reason: 'Used them by mistake' });
  const w = await wallet(t);
  assert.equal(w.balance, 150); assert.equal(w.total_spent, 0);
  assert.equal((await giver.get('/me')).stats.strikes, 1);
});

test('no-shows: partial refund, strikes, then a temporary restriction', async () => {
  const giver = await resident('G6'); const t = await resident('T7');
  for (let i = 0; i < 3; i++) {
    const l = await listing(giver, { quantity: 500, unit: 'g' });
    const e = await t.post(`/listings/${l.id}/request`, { quantity: 500 });
    await giver.post(`/exchanges/${e.id}/accept`);
    const r = await giver.post(`/exchanges/${e.id}/no-show`);
    assert.equal(r.status, 'no_show');
  }
  assert.equal((await wallet(t)).balance, 150 - 3 * 5, 'penalty of 5 per missed pickup');
  const l = await listing(giver, { quantity: 500, unit: 'g' });
  const r = await t.call('POST', `/listings/${l.id}/request`, { quantity: 500 });
  assert.equal(r.status, 403);
  assert.equal(r.body.error.code, 'not_eligible');
  assert.match(r.body.error.message, /paused/);
});

test('expired listing releases pending holds; stale accepted bookings are refunded', async () => {
  const giver = await resident('G7'); const a = await resident('T8'); const b = await resident('T9');
  const l = await listing(giver);
  const p = await a.post(`/listings/${l.id}/request`, { quantity: 500 });
  const acc = await b.post(`/listings/${l.id}/request`, { quantity: 500 });
  await giver.post(`/exchanges/${acc.id}/accept`);
  await run('UPDATE listings SET available_until = ? WHERE id = ?', Date.now() - 1000, l.id);
  await sweep();
  assert.equal((await a.get(`/exchanges/${p.id}`)).status, 'expired');
  assert.equal((await wallet(a)).balance, 150);
  assert.equal((await b.get(`/exchanges/${acc.id}`)).status, 'accepted', 'grace period for confirmed pickups');
  await run('UPDATE listings SET available_until = ? WHERE id = ?', Date.now() - 25 * 3_600_000, l.id);
  await sweep();
  assert.equal((await b.get(`/exchanges/${acc.id}`)).status, 'expired');
  assert.equal((await wallet(b)).balance, 150);
  assert.equal((await giver.get(`/listings/${l.id}`)).status, 'expired');
  assert.equal((await a.call('POST', `/listings/${l.id}/request`, { quantity: 500 })).status, 409);
});

test('balance floor and give-and-take limit stop endless taking', async () => {
  const giver = await resident('G8'); const t = await resident('T10');
  // 150 starter, floor -20 → can spend at most 170. Raise the weekly cap so the balance floor is what bites.
  await admin.ok('PATCH', '/admin/settings', { weekly_receive_cap: 5000 });
  const l = await listing(giver, { quantity: 10 });
  const e = await t.post(`/listings/${l.id}/request`, { quantity: 8500 }); // 8.5 kg tomato = 170 credits
  await giver.post(`/exchanges/${e.id}/accept`); await t.post(`/exchanges/${e.id}/confirm`); await giver.post(`/exchanges/${e.id}/confirm`);
  assert.equal((await wallet(t)).balance, -20);
  const r = await t.call('POST', `/listings/${l.id}/request`, { quantity: 100 });
  assert.equal(r.status, 403);
  const el = await t.get('/eligibility?credits=2');
  assert.equal(el.checks.find((c: any) => c.key === 'balance').ok, false);
  await admin.ok('PATCH', '/admin/settings', { weekly_receive_cap: 150 });
});

test('weekly receiving cap blocks large hauls even with credits to spare', async () => {
  const giver = await resident('G13'); const t = await resident('T15');
  const l = await listing(giver, { quantity: 10 });
  const r = await t.call('POST', `/listings/${l.id}/request`, { quantity: 8000 }); // 160 credits > 150 weekly cap
  assert.equal(r.status, 403);
  assert.match(r.body.error.message, /150 credits received/);
  assert.equal((await wallet(t)).balance, 150);
});

test('access control: other societies, non-owners, non-admins, anonymous', async () => {
  const outsiderAdmin = await user('Other Admin');
  await outsiderAdmin.post('/societies', { name: 'Other Society', city: 'Delhi', area: '', building: 'X', wing: '', flat: '1' });
  const giver = await resident('G9'); const t = await resident('T11');
  const l = await listing(giver);
  assert.equal((await outsiderAdmin.call('GET', `/listings/${l.id}`)).status, 404, 'cross-society listing invisible');
  assert.equal((await outsiderAdmin.call('POST', `/listings/${l.id}/request`, { quantity: 500 })).status, 404);
  assert.ok(!(await outsiderAdmin.get('/listings')).some((x: any) => x.id === l.id));
  assert.equal((await giver.call('POST', `/listings/${l.id}/request`, { quantity: 500 })).status, 400, 'cannot request own');
  const e = await t.post(`/listings/${l.id}/request`, { quantity: 500 });
  assert.equal((await t.call('POST', `/exchanges/${e.id}/accept`)).status, 403, 'requester cannot accept own request');
  assert.equal((await outsiderAdmin.call('GET', `/exchanges/${e.id}`)).status, 404);
  assert.equal((await t.call('PATCH', `/listings/${l.id}`, { notes: 'hacked' })).status, 403);
  assert.equal((await t.call('POST', `/listings/${l.id}/status`, { status: 'removed' })).status, 403);
  assert.equal((await t.call('GET', '/admin/members')).status, 403);
  assert.equal((await outsiderAdmin.call('POST', `/admin/members/1/review`, { approve: true })).status, 404, 'other-society admin');
  assert.equal((await new Client().call('GET', '/listings')).status, 401);
  assert.equal((await giver.call('POST', '/listings', { name: 'Tomato', category: 'vegetable', quantity: 1, unit: 'kg', photo_url: '', condition: 'fresh', declared: true, available_until: Date.now() + 3_600_000 })).status, 400, 'photo required');
  assert.equal((await giver.call('POST', '/listings', { name: 'Tomato', category: 'vegetable', quantity: 1, unit: 'kg', photo_url: await photo(giver), condition: 'fresh', declared: false, available_until: Date.now() + 3_600_000 })).status, 400, 'declaration required');
});

test('reports: three reports hide a listing and release pending requests', async () => {
  const giver = await resident('G10'); const t = await resident('T12');
  const l = await listing(giver);
  await t.post(`/listings/${l.id}/request`, { quantity: 500 });
  for (let i = 0; i < 3; i++) {
    const r = await resident(`Rep${i}`);
    await r.post(`/listings/${l.id}/report`, { reason: 'spoiled', details: 'mouldy' });
  }
  assert.equal((await giver.get(`/listings/${l.id}`)).status, 'hidden');
  assert.equal((await t.call('GET', `/listings/${l.id}`)).status, 404);
  assert.equal((await wallet(t)).balance, 150);
  const reports = await admin.get('/admin/reports');
  await admin.post(`/admin/reports/${reports[0].id}/resolve`, { action: 'remove_listing' });
  assert.equal((await giver.get(`/listings/${l.id}`)).status, 'removed');
});

test('one-sided confirmation completes automatically after 24 h', async () => {
  const giver = await resident('G11'); const t = await resident('T13');
  const l = await listing(giver);
  const e = await t.post(`/listings/${l.id}/request`, { quantity: 500 });
  await giver.post(`/exchanges/${e.id}/accept`);
  await giver.post(`/exchanges/${e.id}/confirm`);
  await sweep();
  assert.equal((await t.get(`/exchanges/${e.id}`)).status, 'accepted');
  await run('UPDATE exchange_requests SET owner_confirmed_at = ? WHERE id = ?', Date.now() - 25 * 3_600_000, e.id);
  await sweep();
  assert.equal((await t.get(`/exchanges/${e.id}`)).status, 'completed');
  assert.equal((await wallet(giver)).total_earned, 10);
});

test('receiver can decline bad produce at pickup: full refund, no strike, admin gets a report', async () => {
  const giver = await resident('G12'); const t = await resident('T14');
  const l = await listing(giver);
  const e = await t.post(`/listings/${l.id}/request`, { quantity: 1000 });
  await giver.post(`/exchanges/${e.id}/accept`);
  assert.equal((await giver.call('POST', `/exchanges/${e.id}/decline-at-pickup`)).status, 403, 'only the receiver');
  const r = await t.post(`/exchanges/${e.id}/decline-at-pickup`, { details: 'Mouldy' });
  assert.equal(r.status, 'cancelled');
  const w = await wallet(t);
  assert.equal(w.balance, 150); assert.equal(w.total_spent, 0);
  assert.equal((await t.get('/me')).stats.strikes, 0);
  assert.ok((await admin.get('/admin/reports')).some((x: any) => x.listing_id === l.id && x.details === 'Mouldy'));
  assert.equal((await one<any>('SELECT qty_available FROM listings WHERE id = ?', l.id))!.qty_available, 1000, 'rejected produce is not re-offered');
});

test('auth: email-only registration, validation and sessions', async () => {
  const c = new Client();
  assert.equal((await c.call('POST', '/auth/register', { name: 'X', password: 'password123' })).status, 400);
  const bad = await c.call('POST', '/auth/register', { name: 'X', email: 'nope', password: 'password123' });
  assert.equal(bad.body.error.message, 'Enter a valid email address.');
  assert.equal((await c.call('POST', '/auth/register', { name: 'X', email: 'x@y.in', password: 'short' })).status, 400);
  await c.post('/auth/register', { name: 'Case Test', email: '  Mixed@Case.IN ', password: 'password123' });
  assert.equal((await new Client().call('POST', '/auth/register', { name: 'Dup', email: 'mixed@case.in', password: 'password123' })).status, 409);
  const l = new Client();
  assert.equal((await l.call('POST', '/auth/login', { email: 'mixed@case.in', password: 'wrongpass1' })).status, 401);
  await l.post('/auth/login', { email: 'MIXED@case.in', password: 'password123' });
  assert.equal((await l.get('/me')).user.email, 'mixed@case.in');
  // A cookie for a user row that was re-created (e.g. after re-seeding) must not carry over
  await run('UPDATE users SET created_at = created_at + 1 WHERE email = ?', 'mixed@case.in');
  assert.equal((await l.call('GET', '/me')).status, 401);
  await l.post('/auth/logout');
});

test('ledger integrity: every wallet balance equals the sum of its ledger entries', async () => {
  const rows = await one<any>(`SELECT COUNT(*) AS bad FROM wallets w
    WHERE w.balance != COALESCE((SELECT SUM(amount) FROM credit_transactions t WHERE t.user_id = w.user_id), 0)`);
  assert.equal(rows.bad, 0);
  const neg = await one<any>(`SELECT COUNT(*) AS n FROM wallets WHERE held < 0 OR balance < -20`);
  assert.equal(neg.n, 0);
});
