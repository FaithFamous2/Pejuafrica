# PejuAfrica — free testing deploy (this week)

**Stack:** Neon (Postgres) → Upstash (Redis) → Render (API) → Vercel (web)

Auth cookies work because the browser talks only to **Vercel**. Next.js rewrites `/api/*` to Render (`PEJU_API_ORIGIN`). Keep `NEXT_PUBLIC_API_URL` empty.

---

## 1. Neon (Postgres)

1. Create a free project at [neon.tech](https://neon.tech).
2. Copy the connection string (prefer **pooled** for Render).
3. Build two URLs:

| Env var | Format |
|---|---|
| `DATABASE_URL` | `postgresql+asyncpg://USER:PASS@HOST/DB?ssl=require` |
| `DATABASE_URL_SYNC` | `postgresql://USER:PASS@HOST/DB?sslmode=require` |

Replace `postgresql://` → `postgresql+asyncpg://` for the async URL, and use `ssl=require` (asyncpg) / `sslmode=require` (psycopg).

Tables are created on API startup (`create_all`) for this MVP.

---

## 2. Upstash (Redis)

1. Create a free database at [upstash.com](https://upstash.com).
2. Copy **Redis URL** (`rediss://…`).
3. Set `REDIS_URL` on Render.

> Rate limits are still in-memory today; Redis is wired for upcoming jobs. Safe to set now.

---

## 3. Render (FastAPI)

### Option A — Blueprint
1. Push this repo to GitHub.
2. Render → **New → Blueprint** → select repo (`render.yaml`).
3. Fill secrets when prompted.

### Option B — Manual Web Service
1. **New → Web Service** → connect repo.
2. Settings:
   - **Root directory:** leave blank (repo root)
   - **Runtime:** Docker
   - **Dockerfile path:** `apps/api/Dockerfile`
   - **Docker context:** `apps/api`
   - **Health check path:** `/health`
   - **Plan:** Free
3. Environment — use `apps/api/.env.production.example` as checklist.

Minimum required:

```text
APP_ENV=production
DEBUG=false
SECRET_KEY=<long random>
COOKIE_SECURE=true
COOKIE_DOMAIN=
DATABASE_URL=postgresql+asyncpg://...
DATABASE_URL_SYNC=postgresql://...
REDIS_URL=rediss://...
FRONTEND_URL=https://YOUR-APP.vercel.app
CORS_ORIGINS=["https://YOUR-APP.vercel.app"]
BOOTSTRAP_SUPERADMIN_PASSWORD=<strong>
```

4. Deploy → note the URL: `https://pejuafrica-api.onrender.com`
5. Smoke: `https://….onrender.com/health` and `/ready`

**Free tier sleeps after idle** — first request can take ~30–60s.

---

## 4. Vercel (Next.js)

1. [vercel.com](https://vercel.com) → Import repo.
2. **Root Directory:** `apps/web` ← required (repo root has no Next.js app; wrong root = Ready + 404)
3. Framework: Next.js (auto).
4. Environment variables:

| Name | Value |
|---|---|
| `NEXT_PUBLIC_API_URL` | *(leave empty / unset)* |
| `PEJU_API_ORIGIN` | `https://YOUR-SERVICE.onrender.com` |

5. Deploy.
6. Copy the Vercel URL → update Render `FRONTEND_URL` + `CORS_ORIGINS` → redeploy API (or save env and restart).

### If the site shows Vercel `404: NOT_FOUND` while deploy is Ready

1. Project → **Settings → General → Root Directory** → set to **`apps/web`** → Save.
2. **Deployments → … → Redeploy** (clear build cache if available).
3. Build log should show `Next.js 16` and routes like `/`, `/login`, `/app`.
4. If Root Directory was empty/wrong, that is why you got a green deploy with no pages.

---

## 5. Smoke test

1. Open Vercel URL → register a business.
2. Login → `/app` marketing.
3. Super admin: `/admin` with bootstrap email/password.
4. In Super Admin, add Cloudflare / Cloudinary credentials (same as local).
5. Hit `https://YOUR-VERCEL-APP/health` (proxied) and `/ready`.

---

## Local still works

```bash
# API
cd apps/api && uvicorn app.main:app --reload --port 8000

# Web — rewrites to localhost:8000 by default
cd apps/web && npm run dev
```

`apps/web/.env.local` can keep `NEXT_PUBLIC_API_URL=` empty.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Login works then immediately logged out | `NEXT_PUBLIC_API_URL` must be empty; `PEJU_API_ORIGIN` must be the Render URL; `COOKIE_SECURE=true` |
| CORS errors in browser Network tab hitting Render directly | Prefer same-origin `/api`; or add Vercel origin to `CORS_ORIGINS` |
| `/ready` postgres false | Neon SSL params / wrong async URL |
| Render 502 on first hit | Cold start — wait and retry |
| Tables missing | Hit any API route once so lifespan `create_all` runs |

---

## Files added for this path

- `apps/api/Dockerfile`
- `render.yaml`
- `apps/api/.env.production.example`
- `apps/web/.env.production.example`
- `apps/web/next.config.ts` (uses `PEJU_API_ORIGIN`)
