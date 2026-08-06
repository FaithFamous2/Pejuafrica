# PejuAfrica

AI-powered Business Operating System for African SMEs — starting with an AI Marketing Department.

## Architecture decisions (locked for Phase 0–1)

| Decision | Choice | Why |
|---|---|---|
| Repo layout | Monorepo `apps/web` + `apps/api` | Shared delivery, one PR surface |
| Auth | Custom (Argon2id + JWT access + opaque refresh cookies) | Product requirement; no Clerk/Supabase Auth |
| Tenant model | Shared Postgres schema + `tenant_id` + `X-Tenant-Id` | Simple, auditable isolation for MVP |
| PostgreSQL + pgvector | System of record + AI memory | Business data, billing, RAG |
| Turso / libSQL | Activity feed + feature flags | High-churn operational reads; local SQLite fallback |
| Jobs | ARQ + Redis (wired next) | Lightweight async Python jobs |
| Frontend surfaces | `/` marketing, `/app` tenant, `/admin` super admin | Clear product boundaries |

## Prerequisites

- Node 20+
- Python 3.11+ (3.14 works if packages install)
- Docker Desktop (Postgres + Redis)

## Quick start

```bash
# 1. Infrastructure
docker compose up -d

# 2. API
cp apps/api/.env.example apps/api/.env
cd apps/api
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# 3. Web (new terminal)
cd apps/web
cp .env.example .env.local
npm install
npm run dev
```

- Marketing: http://localhost:3000  
- API docs: http://localhost:8000/docs  
- Super admin (bootstrap): `admin@pejuafrica.com` / `ChangeMeNow!123`

## Current status

**Through Phase 5 (private alpha hardening):**

- Custom auth, multi-tenant isolation, Turso activity feed
- Onboarding + AI memory init
- AI Marketing Engine with **OpenAI provider when `OPENAI_API_KEY` is set**, else templates
- Billing trial + Paystack/Flutterwave webhooks
- Admin: suspend, impersonate, usage, prompts
- Rate limits on auth + generate, security headers, `/ready` checks
- Tenant isolation + rate-limit unit tests

**Next (Phase 6):** live payment keys in prod, private alpha with 5–10 SMEs, referral basics.
