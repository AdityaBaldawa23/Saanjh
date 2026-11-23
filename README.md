# Saanjha: hyperlocal produce exchange

A society-wise community app for sharing surplus household fruit and vegetables.
Residents list what they have extra, neighbours request it, and **Community Credits** keep giving and taking balanced.
Every new resident starts with **150 credits**.

Architecture, data model, credit rules and the booking state machine: **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

---

## Run it locally

Requires **Node 22.5+** (Node 24 recommended). No database or accounts needed: local development uses PGlite, an embedded Postgres.

```bash
npm install
npm run seed      # wipes the local database: 1 society, 4 users, 150 credits each
npm run dev       # API on :4000 + web on :5173 → open http://localhost:5173
```

> Stop `npm run dev` before running `npm run seed`. The local database folder can only be opened by one process
> (the seed script refuses to run while the server is up).

To test on your phone, open `http://<your-computer-ip>:5173` on the same Wi-Fi network.

### Accounts after seeding (password `password123`)

| Email | Role | Home |
|---|---|---|
| `priya@greenvalley.test` | Society admin | Tower A, East, 304 |
| `rohan@greenvalley.test` | Resident | Tower A, West, 1201 |
| `anjali@greenvalley.test` | Resident | Tower B, East, 502 |
| `vikram@greenvalley.test` | Resident | Tower C, 803 |

Society: **Green Valley Residency**, Baner, Pune. No listings or exchanges yet; create them as you test.

### Manual test script

1. Sign in as **rohan@** → **Share**: add a photo, pick *Tomato*, 2 kg, condition, deadline, tick the declaration.
2. In a private window, sign in as **vikram@** → Explore → open the tomato → *Request* 500 g. 10 credits go on hold.
3. As Rohan: Exchanges → Incoming → *Accept*. Both sides now see each other's flat number.
4. Vikram taps *I've received it*, then Rohan taps *Handed over*. Rohan's wallet shows **160**, Vikram's **140**.
5. **Register** a new account → search *Green Valley* → enter flat → *Request to join*. As **priya@**, approve it from the Home banner → the new user gets 150 credits.
6. Edge cases: decline at pickup, *Not collected*, cancel after accepting, request more than is available, report a listing,
   let a listing expire (pick a 20-minute deadline), and change credit rules as admin (Profile → Society admin → Credit rules).

### Other scripts

| Command | What it does |
|---|---|
| `npm test` | API integration tests (15) on an in-memory database |
| `npm run test:pg` | The same tests through the production Postgres driver (`DATABASE_URL` path) |
| `npm run typecheck` | TypeScript checks for server and web |
| `npm start` | Builds the web app and serves everything from one Node server on :4000 |

---

## Deploy to Vercel

What you'll set up (all have free tiers):

| Piece | Service | Why |
|---|---|---|
| Web app + API | **Vercel** | Static React build on the CDN; the Express API runs as one serverless function (`api/index.js`) |
| Database | **Neon Postgres** (added from inside Vercel) | Serverless functions have no lasting disk, so data needs a hosted database |
| Photos | **Vercel Blob** | Same reason: uploaded photos need cloud storage |

Everything else (`vercel.json`, the build script, the API bundle) is already in this repo.

### 1. Put the code on GitHub

```bash
git init
git add .
git commit -m "Saanjha MVP"
```
Create an **empty** repository on github.com (no README), then:
```bash
git remote add origin https://github.com/<you>/saanjha.git
git branch -M main
git push -u origin main
```

### 2. Create the Vercel project

1. Go to **vercel.com → Add New… → Project**, and import the GitHub repository.
2. On the configure screen:
   - **Framework Preset:** `Other`
   - **Root Directory:** leave as `./`
   - **Build & Output Settings:** leave everything on default. `vercel.json` supplies the install command, build command (`npm run vercel-build`) and output directory (`web/dist`).
3. Click **Deploy**. This first deployment builds but **won't work yet** (no database). That's expected.

### 3. Add the database (Neon Postgres)

1. In the project: **Storage** tab → **Create Database** → choose **Neon** (Serverless Postgres) → pick the free plan and a region close to your users (e.g. Singapore or Mumbai for India).
2. Connect it to the project for **all environments**. Vercel adds `DATABASE_URL` (and a few related variables) automatically.

### 4. Add photo storage (Vercel Blob)

**Storage** tab → **Create Database** → **Blob** → create → connect to the project. Vercel adds `BLOB_READ_WRITE_TOKEN` automatically.

### 5. Add the remaining environment variables

**Settings → Environment Variables**, for Production, Preview and Development:

| Name | Value |
|---|---|
| `JWT_SECRET` | A long random string. Generate one with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `NODEJS_HELPERS` | `0` |

### 6. Redeploy

**Deployments** → the latest deployment → **⋯ → Redeploy**. Environment variables only apply to new deployments.
The database tables and produce catalogue are created automatically on the first request.

### 7. Create the society and users in production

Run the seed from your computer against the production database. Copy `DATABASE_URL` from **Settings → Environment
Variables** (click the eye icon), then run this in PowerShell from the project folder:

```powershell
$env:DATABASE_URL = "postgres://...paste here..."
$env:SEED_PASSWORD = "choose-a-strong-password"   # don't use password123 on a public site
npm run seed
Remove-Item Env:DATABASE_URL; Remove-Item Env:SEED_PASSWORD
```
(macOS/Linux: `DATABASE_URL="postgres://..." SEED_PASSWORD="..." npm run seed`)

This wipes the production database and creates Green Valley Residency with the four accounts above, 150 credits each.

### 8. Open the app

Visit `https://<your-project>.vercel.app` and sign in as `priya@greenvalley.test` with your `SEED_PASSWORD`.
Every later `git push` to `main` redeploys automatically.

### Troubleshooting

| Symptom | Fix |
|---|---|
| "Server is missing the JWT_SECRET environment variable" | Add `JWT_SECRET` (step 5) and redeploy |
| Every API call fails / 500 | Check **Logs** in the Vercel project. Usually `DATABASE_URL` is missing; reconnect Neon (step 3) and redeploy |
| Photo upload fails | Connect the Blob store (step 4) and redeploy |
| The first request after a quiet period is slow | Neon's free tier sleeps when idle and wakes in about a second |
| `npm run seed` hangs | Check the `DATABASE_URL` you pasted (it must include `?sslmode=require`) |

---

## Project layout

```
api/index.js           Vercel function entry (imports the bundled API)
vercel.json            build, output directory and /api rewrites
server/src/
  db.ts                Postgres layer: PGlite locally, node-postgres when DATABASE_URL is set
  credits.ts           the only code that changes wallet balances; writes the ledger
  services/            all business rules (membership, listings, exchanges, community)
  routes.ts            HTTP layer: auth, zod validation, uploads
  storage.ts           photos: Vercel Blob or local disk
  seed.ts              reset to 1 society + 4 users
server/build-vercel.mjs  bundles the API to server/dist/vercel.mjs
server/test/           API integration tests (+ a runner for the Postgres wire path)
web/src/               React app (pages/, components/ui.tsx design system)
```

## Not included

- Push or email notifications (in-app only, refreshed every 30 s). No OTP; sign-in is email + password.
- Password reset and change-password screens.
- Phase 2/3 features: ratings, leaderboard, cross-society networks, demand-based pricing.
