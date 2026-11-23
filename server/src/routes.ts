import { Router, type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { clearSession, loginUser, registerUser, requireAuth, setSession } from './auth.ts';
import { AppError, bad } from './services/common.ts';
import { PHOTO_URL, saveImage } from './storage.ts';
import * as M from './services/membership.ts';
import * as L from './services/listings.ts';
import * as X from './services/exchanges.ts';
import * as C from './services/community.ts';

// Photos are compressed on the phone before upload; 4 MB stays under Vercel's 4.5 MB request limit.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpeg|png|webp|heic|heif)$/.test(file.mimetype)) cb(null, true);
    else cb(new AppError(400, 'bad_file', 'Please upload a JPG, PNG or WebP photo.'));
  },
});

type H = (req: Request, res: Response) => unknown;
const h = (fn: H) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve()
    .then(() => fn(req, res))
    .then((out) => { if (out !== undefined && !res.headersSent) res.json(out); })
    .catch(next);
};
const uid = (req: Request) => req.userId!;
const id = (req: Request) => {
  const n = Number(req.params.id);
  if (!Number.isInteger(n) || n <= 0 || n > 2_147_483_647) throw bad('Invalid id.');
  return n;
};
const parse = <T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> => {
  const r = schema.safeParse(data ?? {});
  if (!r.success) throw bad(r.error.issues[0]?.message ?? 'Invalid input.', r.error.issues);
  return r.data;
};

const str = (max: number, label: string) => z.string({ required_error: `${label} is required.` }).trim().min(1, `${label} is required.`).max(max);
const opt = (max: number) => z.string().trim().max(max).optional().default('');
const photo = z.string({ required_error: 'A photo of the produce is required.' }).regex(PHOTO_URL, 'A photo of the produce is required.');

const Register = z.object({
  name: str(60, 'Name'),
  email: z.string({ required_error: 'Email is required.' }).trim().toLowerCase().email('Enter a valid email address.').max(120),
  password: z.string({ required_error: 'Password is required.' }).min(8, 'Password must be at least 8 characters.').max(100),
});

const Address = { building: str(40, 'Building / tower'), wing: opt(20), flat: str(12, 'Flat number') };
const ListingBody = z.object({
  name: str(40, 'Produce name'),
  category: z.enum(['fruit', 'vegetable', 'leafy']),
  quantity: z.coerce.number().positive('Quantity must be more than 0.').max(100_000),
  unit: z.enum(['g', 'kg', 'pcs']),
  photo_url: photo,
  purchase_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  condition: z.enum(['fresh', 'good', 'use_soon'], { errorMap: () => ({ message: 'Choose the condition of the produce.' }) }),
  declared: z.literal(true, { errorMap: () => ({ message: 'Please confirm the produce is fresh, clean and safe to eat.' }) }),
  pickup_from: z.coerce.number().int().optional(),
  available_until: z.coerce.number().int(),
  pickup_note: opt(200),
  notes: opt(300),
});
const ListingPatch = z.object({
  quantity: z.coerce.number().positive('Quantity must be more than 0.').max(100_000).optional(),
  unit: z.enum(['g', 'kg', 'pcs']).optional(),
  photo_url: photo.optional(),
  purchase_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  condition: z.enum(['fresh', 'good', 'use_soon']).optional(),
  pickup_from: z.coerce.number().int().optional(),
  available_until: z.coerce.number().int().optional(),
  pickup_note: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(300).optional(),
});
const int = (min: number, max: number) => z.coerce.number().int().min(min).max(max);
const SettingsBody = z.object({
  starter_credits: int(0, 1000), min_balance: int(-200, 0), min_credits_per_exchange: int(1, 50), max_active_requests: int(1, 20),
  weekly_receive_cap: int(10, 5000), max_receives_without_sharing: int(1, 50), no_show_penalty: int(0, 100),
  strike_limit: int(1, 20), restriction_days: int(1, 60), report_hide_threshold: int(1, 20),
}).partial();

export const api = Router();

// ── Auth ──
api.post('/auth/register', h(async (req, res) => {
  const b = parse(Register, req.body);
  const userId = await registerUser(b.name, b.email, b.password);
  await setSession(res, userId);
  return C.profile(userId);
}));
api.post('/auth/login', h(async (req, res) => {
  const b = parse(z.object({ email: str(120, 'Email'), password: str(100, 'Password') }), req.body);
  const userId = await loginUser(b.email, b.password);
  await setSession(res, userId);
  return C.profile(userId);
}));
api.post('/auth/logout', h((_req, res) => { clearSession(res); return { ok: true }; }));
api.get('/health', h(() => ({ ok: true })));

// ── Signed in (verification not yet required) ──
api.use(requireAuth);
api.get('/me', h((req) => C.profile(uid(req))));
api.patch('/me', h((req) => C.updateProfile(uid(req), parse(z.object({
  name: str(60, 'Name').optional(), avatar_url: z.string().regex(PHOTO_URL).optional() }), req.body))));
api.post('/uploads', upload.single('photo'), h(async (req) => {
  if (!req.file) throw bad('No photo received.');
  return { url: await saveImage(req.file.buffer, req.file.mimetype) };
}));
api.get('/societies', h((req) => M.listSocieties(String(req.query.q ?? ''))));
api.post('/societies', h((req) => M.createSociety(uid(req), parse(z.object({
  name: str(80, 'Society name'), city: str(40, 'City'), area: opt(60), ...Address }), req.body))));
api.post('/societies/:id/join', h((req) => M.joinSociety(uid(req), id(req), parse(z.object(Address), req.body))));
api.get('/catalog', h(() => C.catalog()));
api.get('/notifications', h((req) => C.notifications(uid(req))));
api.post('/notifications/read', h(async (req) => { await C.markRead(uid(req), req.body?.id ? Number(req.body.id) : undefined); return { ok: true }; }));
api.get('/wallet', h((req) => C.wallet(uid(req))));

// ── Marketplace ──
api.get('/listings', h((req) => L.marketplace(uid(req), {
  q: String(req.query.q ?? ''), category: String(req.query.category ?? ''), sort: String(req.query.sort ?? '') })));
api.get('/listings/mine', h((req) => L.myListings(uid(req))));
api.post('/listings', h((req) => L.createListing(uid(req), parse(ListingBody, req.body))));
api.get('/listings/:id', h((req) => L.getListing(uid(req), id(req))));
api.patch('/listings/:id', h((req) => L.updateListing(uid(req), id(req), parse(ListingPatch, req.body))));
api.post('/listings/:id/status', h((req) => L.setListingStatus(uid(req), id(req), parse(z.object({ status: z.enum(['active', 'paused', 'removed']) }), req.body).status)));
api.post('/listings/:id/report', h((req) => {
  const b = parse(z.object({ reason: z.enum(['spoiled', 'misdescribed', 'unsafe', 'inappropriate', 'other']), details: opt(300) }), req.body);
  return L.reportListing(uid(req), id(req), b.reason, b.details);
}));
api.post('/listings/:id/request', h((req) => {
  const b = parse(z.object({ quantity: z.coerce.number().int('Choose a valid quantity.').positive().max(100_000), message: opt(200) }), req.body);
  return X.requestListing(uid(req), id(req), b.quantity, b.message);
}));
api.get('/eligibility', h((req) => X.eligibility(uid(req), Math.max(0, Math.min(100_000, Number(req.query.credits) || 0)))));

// ── Exchanges ──
api.get('/exchanges', h((req) => X.listExchanges(uid(req))));
api.get('/exchanges/:id', h((req) => X.getExchange(uid(req), id(req))));
api.post('/exchanges/:id/accept', h((req) => X.acceptRequest(uid(req), id(req), parse(z.object({ note: opt(200) }), req.body).note)));
api.post('/exchanges/:id/reject', h((req) => X.rejectRequest(uid(req), id(req), parse(z.object({ reason: opt(200) }), req.body).reason)));
api.post('/exchanges/:id/cancel', h((req) => X.cancelRequest(uid(req), id(req), parse(z.object({ reason: opt(200) }), req.body).reason)));
api.post('/exchanges/:id/confirm', h((req) => X.confirmExchange(uid(req), id(req))));
api.post('/exchanges/:id/no-show', h((req) => X.markNoShow(uid(req), id(req))));
api.post('/exchanges/:id/decline-at-pickup', h((req) => X.declineAtPickup(uid(req), id(req), parse(z.object({ details: opt(300) }), req.body).details)));

// ── Community ──
api.get('/society/stats', h((req) => C.societyStats(uid(req))));

// ── Admin ──
api.get('/admin/members', h((req) => M.listMembers(uid(req))));
api.post('/admin/members/:id/review', h((req) => {
  const b = parse(z.object({ approve: z.boolean(), reason: opt(200) }), req.body);
  return M.reviewMembership(uid(req), id(req), b.approve, b.reason);
}));
api.post('/admin/members/:id/role', h((req) => M.setRole(uid(req), id(req), parse(z.object({ role: z.enum(['resident', 'admin']) }), req.body).role)));
api.get('/admin/reports', h((req) => C.listReports(uid(req))));
api.post('/admin/reports/:id/resolve', h((req) => C.resolveReport(uid(req), id(req), parse(z.object({ action: z.enum(['dismiss', 'remove_listing']) }), req.body).action)));
api.get('/admin/settings', h((req) => C.getSettings(uid(req))));
api.patch('/admin/settings', h((req) => C.updateSettings(uid(req), parse(SettingsBody, req.body))));

api.use((_req, _res, next) => next(new AppError(404, 'not_found', 'Unknown API route.')));
