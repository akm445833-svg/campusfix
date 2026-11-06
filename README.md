# CampusFix

CampusFix is a college complaint-management web app. Students register, report campus problems (category, location, priority, description), and track their status. Administrators see all complaints and statistics, update statuses, and delete complaints. The app also includes authenticated student/admin chat and a small rule-based AI helper.

The frontend is plain HTML/CSS/JavaScript. The API is Node.js + Express. Data is stored in PostgreSQL (Supabase-compatible) through Drizzle ORM. There is **no file/photo upload**: the API rejects `multipart/form-data` with HTTP 415.

## Architecture

```
Browser
  │  same-origin requests to /api/*
  ▼
Vercel (static frontend + /api proxy function)
  │  BACKEND_URL (server-side only)
  ▼
Render web service (Express API, cookies, rate limits)
  │  DATABASE_URL (PostgreSQL, SSL)
  ▼
Supabase PostgreSQL
```

Keeping `/api/*` same-origin means the HttpOnly session cookie stays first-party; no JWT is stored in `localStorage`. The proxy is an explicit allowlist for `/api` paths and forwards to one fixed backend URL, so it is not an open proxy.

## Project layout

```
api/[...path].js          Vercel serverless proxy to the backend
backend/                  Express API, auth, routes, validation
  db/migrations/          PostgreSQL schema (source of truth)
  db/schema.js            Drizzle schema
  scripts/                Mongo backup, import, verification
  test/                   API and migration tests (embedded PostgreSQL)
js/                       Frontend page scripts + shared session helper
scripts/build-frontend.js Copies only allowlisted assets to dist/
render.yaml               Render blueprint (free plan)
vercel.json               Vercel build, headers, function config
```

## Local development

Requirements: Node.js 20+ and PostgreSQL 15+ (local or Supabase). The app no longer connects to MongoDB at runtime.

```bash
cd backend
npm ci
cp .env.example .env        # Windows PowerShell: Copy-Item .env.example .env
```

Fill in `.env` (names only):

- `DATABASE_URL` — PostgreSQL URL used by the API
- `DIRECT_URL` — direct/session connection used for migrations and imports (falls back to `DATABASE_URL` if empty)
- `JWT_SECRET` — random value; at least 32 bytes is required when `NODE_ENV=production`
- `CORS_ORIGINS` — comma-separated frontend origins; required in production
- Optional: SSL, pool, timeout, cookie, proxy, rate-limit and bcrypt settings (see `.env.example`)

Then:

```bash
npm run db:migrate
npm start
```

Open `http://localhost:5000`. In development the backend serves the allowlisted frontend files directly, so no second server is needed. In production the frontend is served by Vercel.

Create the first administrator (password must be at least 12 characters; it is never printed or committed):

```bash
# Set ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD in backend/.env for this command
npm run create-admin
```

Run the tests:

```bash
npm test
```

The suite starts an embedded PostgreSQL instance and covers schema constraints, backup/import verification, registration/login cookies, complaint ownership, admin authorization, chat isolation, static-file exposure, CSP, and origin checks.

## Authentication and security

- Passwords are bcrypt-hashed (cost 12 by default; legacy hashes remain valid).
- Login sets an HttpOnly, SameSite=Lax cookie (`campusfix_session`), Secure in production. The token is never returned in the JSON body and never stored in `localStorage`.
- JWT is HS256, issuer/audience checked, 7-day expiry. Changing `JWT_SECRET` invalidates all sessions.
- Role and account existence are reloaded from PostgreSQL on every request; admin routes require `role = admin` in the database.
- Students can only read their own complaints and chat threads. Admin-only routes are server-enforced, not hidden in the UI.
- Mutating requests require an `Origin`/`Referer` from `CORS_ORIGINS`; CORS is an explicit allowlist with credentials enabled.
- Zod validates every payload; Express JSON bodies are limited to 100 KB; rate limits apply to the API and, more strictly, to login/register.
- Helmet sets CSP without inline scripts, plus HSTS, frame denial, nosniff, referrer and permissions policies. All page JavaScript is external.
- The backend serves only an explicit allowlist of frontend files. Source, `.env`, `package.json`, backups and test files are not exposed.
- Errors and logs never include passwords, tokens, cookies, request bodies, or student data.

## Migrating the existing MongoDB data

**Do not delete or modify the MongoDB database.** The running app no longer uses MongoDB; it is read only during this one-time migration. Nothing in this repository has migrated real production data yet.

The schema preserves users, complaints, chats, roles, categories, priorities, statuses, timestamps, ownership and chat participants. Original Mongo `_id` values are retained in `legacy_mongo_id` columns. The original app has **no departments collection**; complaint `category` is the closest existing field and is preserved as text. Adding real departments would require a new table and mapping decision.

### 1. Access needed

One of:

- A **read-only** MongoDB connection string and database name (`MONGO_URI`, `MONGODB_DB`), or
- An existing backup directory produced by `npm run db:backup` (with its `manifest.json`).

Store credentials only in local `backend/.env`; never commit or share them in chat. You also need an empty Supabase PostgreSQL database and its pooled/direct connection strings.

### 2. Back up the source (read-only)

```bash
cd backend
# MONGO_URI and MONGODB_DB set in backend/.env
npm run db:backup
```

This exports every collection as canonical EJSON JSONL plus a manifest containing counts and SHA-256 hashes under `<repo>/backups/mongo-<timestamp>/`. It never writes to MongoDB and does not log the URI or student records. Copy the backup somewhere durable and keep it until the migration is fully accepted.

### 3. Import into an empty PostgreSQL database

```bash
npm run db:migrate
npm run db:import -- --backup=../backups/mongo-<timestamp>
npm run db:verify  -- --backup=../backups/mongo-<timestamp>
```

The importer verifies the backup hashes, validates references and enum values, refuses a non-empty target, and runs in a single transaction. Verification compares row counts and a digest of representative records, and checks legacy IDs, complaint owners, chat participants and admin count. It prints counts only, not personal data.

### 4. Verify before cutover

1. Compare users/complaints/chats counts with the source and the manifest.
2. Log in with a real migrated student and admin account (passwords/hashes are preserved).
3. Confirm a student sees only their own complaints and that statuses/priorities/dates match.
4. Confirm admin statistics and status updates persist.
5. Keep MongoDB untouched and available.

### 5. Cut over and roll back

Cut over only after the checks above. Deploy the backend with the PostgreSQL environment, then point the Vercel proxy at it and test the full flow again.

Rollback: keep the previous deployment available. Redeploy the last pre-migration backend/frontend version and restore its MongoDB configuration; the Mongo database was never changed. Data created only in PostgreSQL after cutover will not exist in MongoDB, so reconcile it before switching back if necessary. Do not drop the PostgreSQL database or delete MongoDB until the retention period you choose has passed.

## Deployment

No live URL is committed. Replace placeholders with your real domains only after deployment.

### Supabase (database)

1. Create a project in the region closest to the API (for example, Singapore if using Render Singapore).
2. Run `npm run db:migrate` against the new database, then migrate/verify data as above.
3. Use the **Session pooler** connection string for `DATABASE_URL` (IPv4, works from Render). Use the direct connection for `DIRECT_URL` if your network supports it; otherwise the session pooler is also valid. Append `?sslmode=require`.
4. Keep SSL verification enabled. Do not expose the database password to the frontend.

### Render (API)

`render.yaml` defines a free Node web service with:

- build: `npm ci --omit=dev --prefix backend && npm --prefix backend run db:migrate`
- start: `node backend/server.js`
- health check: `/api/health` (returns 503 if PostgreSQL is unreachable)

Set these environment values in Render (names only): `DATABASE_URL`, `DIRECT_URL`, `CORS_ORIGINS` (the exact Vercel production origin, e.g. `https://your-project.vercel.app`), and optionally `TRUST_PROXY_HOPS=2`, `DATABASE_POOL_MAX`, `BCRYPT_ROUNDS`. `JWT_SECRET` is generated by the blueprint; `NODE_ENV=production` and `COOKIE_SECURE=true` are preset. Never put secrets in `render.yaml`.

If creating the service manually instead of via the blueprint, use the same commands, set the health check, and supply the environment variables before the first deploy.

### Vercel (frontend + same-origin API proxy)

1. Import the repository. `vercel.json` sets the build command (`node scripts/build-frontend.js`), output (`dist/`), security headers and the `/api` function.
2. Add the environment variable `BACKEND_URL` (server-side only) with the Render URL, for example `https://campusfix-api.onrender.com` — no trailing slash and no `/api` suffix.
3. Deploy. Test `https://your-project.vercel.app/api/health`; it should report the database as connected.
4. Set Render's `CORS_ORIGINS` to the final Vercel origin and redeploy the backend if you created Vercel after Render. Custom domains and preview deployments need their origins added too.
5. Only the files listed in `backend/lib/frontend-files.js` are published. Backend source, tests, `.env` and backups are excluded from the Vercel upload.

Recommended order: Supabase → Render (with the planned Vercel origin) → Vercel (`BACKEND_URL`) → verify → migrate data → verify again.

### Production smoke test

1. `GET /api/health` directly on Render and through Vercel.
2. Register a new student, log out, log back in.
3. Submit a complaint, refresh, confirm it is visible only to that student.
4. Log in as admin, confirm stats/list, update the status, log back in as the student and confirm it persisted.
5. Try reading another student's complaint ID and confirm HTTP 403.
6. Confirm the browser has no console/CSP errors and the session cookie is HttpOnly.
7. Turn off the laptop and repeat with the cloud URLs.

## Free-tier limits and costs

Verified against provider documentation on **2026-10-24**. Prices change; confirm at checkout. No paid plan was purchased for this project.

| Service | Free limits relevant to CampusFix | Paid option |
| --- | --- | --- |
| Render Free | 750 instance hours/month, 512 MB RAM; sleeps after 15 minutes idle and takes about a minute to wake; first request after idle is slow | Starter ≈ $7/month for always-on 0.5 vCPU / 512 MB (confirm current price) |
| Supabase Free | 500 MB database, 1 GB storage, 5 GB egress, 50k monthly active users; project pauses after 7 days of low activity and can be restored from the dashboard | Pro $25/month |
| Vercel Hobby | 100 GB fast data transfer, 1M function invocations, 4 CPU-hours, 300 s max function duration; **non-commercial personal use only** | Pro $20/user/month (required for commercial use) |

The all-free setup can work with the laptop off, but the Render free service will sleep and the first request may take about a minute. The Vercel proxy waits up to 90 seconds for that wake-up. For a dependable, always-on deployment, Render Starter (~$7/month) is the first upgrade to approve. If the site is used commercially or by a paid institution, Vercel Hobby is not permitted; use Pro. Supabase Free is appropriate for a small campus dataset, but a quiet 7-day period can pause the database.

References: [Render free tier](https://render.com/docs/free), [Render pricing comparison](https://render.com/articles/render-vs-railway), [Supabase pricing](https://supabase.com/pricing), [Supabase project pausing](https://supabase.com/docs/guides/platform/free-project-pausing), [Vercel Hobby](https://vercel.com/docs/plans/hobby), [Vercel fair use](https://vercel.com/docs/limits/fair-use-guidelines).

## Known limitations

- No file/photo uploads (rejected by the API). Password reset/change and email verification are not implemented.
- Chat is persisted, but there is no admin reply screen in the UI; the student→admin thread is one-sided. The AI helper is rule-based, not a real model.
- Android/Capacitor packaging is separate and still points at a placeholder URL in `capacitor.config.json`.
- The migration and deployment above were implemented and tested locally against ephemeral PostgreSQL; real MongoDB backup/import and cloud deployment require the access listed in this document.
