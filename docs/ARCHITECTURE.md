# PejuAfrica — Architecture Decisions (Phase 0–1)

## Dual database

| Store | Owns | Does not own |
|---|---|---|
| **PostgreSQL** | Users, tenants, memberships, sessions, tokens, business profiles, campaigns/content (upcoming), billing, audit logs, pgvector memories | Ephemeral activity UI feed |
| **Turso / libSQL** | `activity_events`, `feature_flags` | Auth, billing, canonical business data |

- **Sync:** one-way writes from API → Turso for activity. Postgres is always source of truth.
- **Local fallback:** if `TURSO_DATABASE_URL` is empty, API uses `apps/api/data/turso_local.db`.
- **Failure mode:** Turso write failures should not block auth (harden in Phase 1.1 with try/except + log).

## Auth

- Passwords: Argon2id
- Access token: JWT (15m) in httpOnly cookie `peju_access`
- Refresh token: opaque, hashed in `auth_sessions`, httpOnly cookie `peju_refresh`, rotation + reuse detection
- Tenant context: JWT claim + `X-Tenant-Id` header
- Platform role: `users.is_platform_admin` (bootstrap on startup)

## Frontend surfaces

| Route | Audience |
|---|---|
| `/` | Public marketing |
| `/login`, `/register` | Auth |
| `/app/*` | Tenant business dashboard |
| `/admin/*` | Super admin |

Next.js rewrites `/api/*` → FastAPI so cookies are same-origin in local dev.
