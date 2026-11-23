# Saanjha — Architecture & Product Plan

> *Give what you have. Take what you need. Keep food within the community.*

Saanjha (Hindi/Punjabi: "shared") is a hyperlocal, society-wise exchange for surplus household fruits and vegetables.

---

## 1. Architecture

```
┌──────────────────────────┐   /api (JSON, cookie auth)   ┌──────────────────────────────────┐
│ web/  React + TS + Vite  │ ───────────────────────────▶ │ server/  Express (Node 22+)      │
│ Tailwind v4, mobile-1st  │ ◀─────────────────────────── │  routes.ts    HTTP + zod         │
└──────────────────────────┘                              │  services/    all business rules │
                                                           │  credits.ts   the ledger         │
                                                           │  db.ts        Postgres layer     │
                                                           │  storage.ts   photos             │
                                                           └──────────────────────────────────┘
                     local development                         production (Vercel)
 database   PGlite (embedded Postgres, server/data/pg)    Neon Postgres via DATABASE_URL
 photos     server/uploads/                               Vercel Blob (BLOB_READ_WRITE_TOKEN)
 API        node src/index.ts on :4000                    one serverless function: api/index.js
 web        Vite dev server on :5173                      static files from web/dist on Vercel's CDN
```

**Why Postgres:** the credit ledger and quantity reservation need multi-row ACID transactions and row locks.
The same SQL runs locally (PGlite, zero setup) and in production (any Postgres; Neon is one click on Vercel).

**Concurrency:** state changes lock the rows they touch (`SELECT … FOR UPDATE`): the exchange, the listing, or the
requester's wallet. The expiry sweeper claims rows with `FOR UPDATE SKIP LOCKED`, so several serverless instances can
run it at once without double-refunding. Quantity is reserved with a conditional `UPDATE … WHERE qty_available >= n`.

**Expiry without background jobs:** before an API request (at most every 5 s per instance) the server resolves
anything overdue. That works on serverless, where timers don't run between requests.

**Trust boundary.** The client never sends credit amounts, balances, owner IDs or society IDs. The server derives
everything from the session and the database. The client shows a credit *preview*, which the server recomputes.

## 2. Data model

| Table | Purpose |
|---|---|
| `societies` | Registered residential societies (name, city, area) |
| `society_settings` | Per-society configurable credit rules (starter credits, floors, caps, penalties) |
| `users` | Account: name, email/phone, scrypt password hash, avatar, strikes, `restricted_until` |
| `memberships` | user ↔ society, building/wing/flat, `pending/approved/rejected`, role `resident/admin` |
| `produce_catalog` | Known produce: category, unit type, credit rate (per kg or per piece), avg piece weight |
| `listings` | Shared produce. Quantities stored in base units (grams or pieces). `qty_available` is decremented atomically on request |
| `exchange_requests` | A booking. State machine below. Holds the credit amount fixed at request time |
| `completed_exchanges` | Immutable record of each successful exchange (drives community stats) |
| `wallets` | Cached balance, held, total earned/spent. Only `credits.ts` writes here |
| `credit_transactions` | Append-only ledger. Every wallet change has exactly one row with `balance_after` |
| `notifications` | In-app notifications (polled by the client) |
| `reports` | Quality/safety reports on listings. Admin review; auto-hide at threshold |

## 3. Credit system

**Pricing (transparent, per item).** `credits = max(min_credits, round(quantity × rate))`
- Weight items: rate per kg (vegetables ≈ 20/kg, fruits ≈ 24/kg, leafy greens and herbs ≈ 80/kg, because a 250 g bunch of coriander is more useful than 250 g of potatoes).
- Piece items: rate per piece (banana 2, lemon 2, coconut 8, …).
- The rate is fixed on the listing when it is created, so the price can't change after someone has booked.

**Lifecycle of credits in one exchange**

| Event | Receiver | Contributor |
|---|---|---|
| Request placed | `hold` −c (available ↓, held ↑) | — |
| Contributor rejects / requester cancels while pending / listing expires | `release` +c | — |
| Contributor accepts (booking confirmed) | `spend` (held ↓, spent ↑) | — |
| Contributor cancels after accepting | `refund` +c | strike recorded |
| Requester cancels after accepting | `refund` +c | — (requester gets a strike) |
| Receiver declines at pickup (quality) | `refund` +c, no strike | report filed |
| Requester no-show (contributor reports) | `refund` +(c − penalty), `penalty` | — (requester gets a strike) |
| Completed | — | `earn` +c |

**Receiving eligibility** (all must pass; the wallet screen shows each check):
1. Approved society member.
2. Not under a booking restriction (3 strikes within 30 days → 7-day restriction).
3. Fewer than `max_active_requests` open requests.
4. `balance − c ≥ min_balance` (small overdraft floor, default −20, so someone at 0 can still take part).
5. Credits received in the last 7 days ≤ `weekly_receive_cap`.
6. Fewer than `max_receives_without_sharing` completed receipts since the user's last completed share.

New members get `starter_credits` (default **150**) on approval.

## 4. Booking workflow (state machine)

```
            accept                 both confirm / receiver confirms
 pending ───────────▶ accepted ──────────────────────────────▶ completed
   │  reject/cancel      │ owner cancel / requester cancel / no-show / timeout
   ▼                     ▼
 rejected, cancelled,  cancelled, no_show, expired
 expired
```
- **Double booking:** requesting runs in one Postgres transaction:
  `UPDATE listings SET qty_available = qty_available - ? WHERE id = ? AND qty_available >= ? AND status='active'`.
  If 0 rows change, the request fails. Releasing quantity adds it back in the same transaction as the credit release.
- **Partial requests:** 2 kg of tomatoes can serve four 500 g requests; each one reserves its own slice.
- **Completion:** both parties confirm: the contributor taps "Handed over", the receiver taps "I've received it".
  If only one side confirms, the exchange completes automatically 24 h after that confirmation.
- **Declining at pickup:** the receiver inspects the produce and may decline it. They get a full refund, no strike,
  and a quality report goes to the admins. The declined quantity is not offered again.
- After either side confirms, cancellation and no-show are blocked, which prevents disputes over a completed handover.
- **Expiry sweeper** (every 60 s, and before marketplace reads): expires listings past their deadline, releases pending
  holds, and resolves stale accepted bookings.

## 5. Security
- Session: HTTP-only, SameSite=Lax JWT cookie. Passwords are hashed with scrypt.
- Every society-scoped query filters by the caller's **approved** membership. Listings from other societies return 404.
- Ownership checks on every listing/exchange mutation. Admin routes check `role='admin'` for *that* society.
- All input is validated with zod. Uploads: images only, 5 MB max, random filenames.
- Privacy: the marketplace shows first name + building/wing only. The flat number is shown only to the other party
  of an *accepted* exchange. Email/phone are never exposed to other residents.

## 6. Screens
Auth (email + password login/register) → Join or create society → Pending verification →
Bottom nav: **Home** · **Explore** · **＋ Share** · **Exchanges** · **Profile**
Secondary: Listing detail, Edit listing, Exchange detail, Wallet, Notifications, Community dashboard, Admin (members, reports, settings).

## 7. Scope
Phase 1 (built): auth, society join/verification, marketplace, listings with photo, request/accept/confirm, credits + ledger,
exchange history, notifications, reports, expiry, society dashboard, admin approvals.
Phase 2/3 (not built): ratings, leaderboard, push/SMS, OTP login, cross-society networks, demand-based pricing.
