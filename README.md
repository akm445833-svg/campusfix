# CampusFix

A campus complaint-tracking app: students submit and track complaints (broken fan, leaking pipe, etc.), admins review, update status, and delete them.

## Stack
- **Backend:** Node.js, Express 5, MongoDB (Mongoose), JWT auth, bcrypt password hashing
- **Frontend:** Plain HTML/CSS/JS (no build step) — `index.html`, `login.html`, `register.html`, `dashboard.html` (student), `admin.html` (admin)

## Setup

1. **Install backend dependencies**
   ```bash
   cd backend
   npm install
   ```

2. **Configure environment** — `backend/.env` already contains:
   ```
   MONGO_URI=...
   PORT=5000
   JWT_SECRET=...
   ```
   ⚠️ **Rotate your MongoDB password before deploying/sharing this project anywhere public.** This `.env` has a live Atlas connection string with a real password in it — treat it as compromised since it's been shared, and change the password in MongoDB Atlas. `.env` is now git-ignored so it won't get committed going forward.

3. **Run the backend**
   ```bash
   npm start
   ```
   Server runs on `http://localhost:5000`. You should see `MongoDB Connected ✅` in the console.

4. **Create an admin account** (one-time)
   ```bash
   npm run create-admin
   ```
   Creates `admin@campusfix.com` / `Admin@123` with role `admin`. **Log in and change this password** (or edit `createAdmin.js` before running it) since it's a hardcoded default.

5. **Open the frontend** — just open `index.html` in a browser (or serve the folder with any static server). Register a student account, or log in as the admin created above.

## How it's wired together
- `index.html` → landing page → links to `login.html` / `register.html`
- `register.html` → `POST /api/register` → new user with role `student`
- `login.html` → `POST /api/login` → stores JWT + user in `localStorage`, redirects students to `dashboard.html` and admins to `admin.html`
- `dashboard.html` → `POST /api/complaints` (submit), `GET /api/complaints/:userId` (view own complaints)
- `admin.html` → `GET /api/admin/stats`, `GET /api/admin/complaints`, `PUT /api/admin/complaints/:id/status`, `DELETE /api/admin/complaints/:id`

All admin routes require a valid JWT **and** `role: "admin"` (enforced server-side in `server.js`), so students can't hit admin endpoints even if they call the API directly.

## Notes
- Removed an unused, stale `backend/routes/auth.js` that duplicated the register logic already handled directly in `server.js` — it wasn't imported anywhere and was dead code.
- `server.js` now also serves the frontend folder (`app.use(express.static(...))`), and every HTML file's `API_URL` is now a **relative** path instead of `http://localhost:5000`. This means one deployment (one server, one URL) serves both the site and the API — no separate frontend host, no CORS headaches.

## Going live (one free option: Render)

1. Push this folder to a GitHub repo (root of repo = this `campusFix` folder).
2. On [render.com](https://render.com) → New → Web Service → connect the repo.
3. Settings:
   - **Root directory:** `backend`
   - **Build command:** `npm install`
   - **Start command:** `node server.js`
4. Add environment variables (from your `.env` — don't commit `.env` itself, it's git-ignored):
   - `MONGO_URI` — your Atlas connection string (rotate the password first, see above)
   - `JWT_SECRET` — any long random string
   - `PORT` — Render sets this automatically, but 5000 as fallback is fine
5. Deploy. Render gives you a URL like `https://campusfix.onrender.com` — that single URL now serves the site (`/`, `/login.html`, etc.) **and** the API (`/api/...`).
6. In MongoDB Atlas → Network Access, allow access from anywhere (`0.0.0.0/0`) or Render's IPs, otherwise the deployed server can't reach your database.
7. Run `npm run create-admin` once — either locally (pointed at the same `MONGO_URI`) or via Render's shell — to create the admin account in the live database.

(Railway, Cyclic, or Fly.io work the same way if you prefer those instead of Render.)

## Turning it into an Android app (APK) — once it's live

The site is already installable as-is (no extra work) via **Capacitor**, which wraps your live URL in a WebView:

```bash
npm install -g @capacitor/cli
mkdir campusfix-app && cd campusfix-app
npm init -y
npm install @capacitor/core @capacitor/android
npx cap init CampusFix com.yourname.campusfix --web-dir=www
```
In `capacitor.config.json`, set:
```json
{ "server": { "url": "https://campusfix.onrender.com", "cleartext": false } }
```
Then:
```bash
npx cap add android
npx cap open android
```
This opens Android Studio — hit **Build → Build Bundle/APK → Build APK**. That APK opens your live CampusFix site full-screen like a native app, installable on any Android phone (or publishable to the Play Store later).

This step needs your own machine (Android Studio + network) — I can't run it in this sandboxed environment, but the steps above are copy-paste ready once your site is live.
