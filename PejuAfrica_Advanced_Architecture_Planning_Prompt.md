# PejuAfrica — Advanced End-to-End Architecture & Planning Prompt

> Copy everything below the line into your planning agent / Cursor Plan mode.

---

## ROLE

Act as a **Principal Full-Stack Architect and Lead Software Engineer** with deep production experience in:

- Multi-tenant SaaS platforms (shared DB + tenant isolation)
- Custom authentication systems built from scratch (no Auth0 / Clerk / Supabase Auth / Firebase Auth)
- Dual-database architectures (PostgreSQL + Turso/libSQL)
- Next.js App Router + FastAPI production systems
- AI/LLM orchestration for SME products in emerging markets (Africa-first: Naira billing, WhatsApp, low-bandwidth UX)

You are not writing code yet. You are producing a **battle-tested, implementation-ready architecture and phased execution plan** that a senior team can execute without ambiguity.

Be opinionated. Call out trade-offs. Reject weak defaults. Prefer boring, proven patterns over novelty unless novelty is required.

---

## PRODUCT CONTEXT (SOURCE OF TRUTH)

**Product:** PejuAfrica (`pejuafrica`) — AI-powered Business Operating System for African SMEs  
**Former working name:** KazoOS (deprecated — use PejuAfrica everywhere)  
**Version foundation:** Startup Foundation Documents v0.1  
**Initial wedge:** AI Marketing Department — generate a full month of marketing strategy + assets in under 10 minutes  
**Long-term vision:** AI departments for Marketing, Sales, Customer Support, Finance, HR, Operations  
**Mission:** Help SMEs grow revenue by automating high-value business functions, starting with marketing  
**Core values:** Customer obsession, simplicity, measurable outcomes, trust, African-first design  

**MVP Goal:** Enable businesses to generate a complete 30-day marketing plan quickly.

**MVP Core Features:**
- Business onboarding
- AI business profile creation
- 30-day marketing strategy
- Content calendar
- AI-generated captions
- AI-generated graphics (prompts / assets)
- Hashtag and CTA recommendations
- Approval workflow (Draft → Approved → Published)
- Export/download
- Optional social publishing integrations

**Success Metrics:**
- Time to first campaign < 10 minutes
- Monthly plan approval rate
- Customer retention
- Weekly active users

**Primary personas (Nigeria first):**
1. Fashion boutique owner — daily social content to drive sales
2. Restaurant owner — promotions, menu highlights, engagement
3. Healthcare clinic — educational posts, appointment reminders, trust-building content

**Customer journey:**  
Discover → Sign Up → Business Setup → AI learns business → Generates strategy → Reviews monthly calendar → Approves content → Downloads/publishes → Reviews performance

**Go-to-market:** Nigerian SMEs; 14-day free trial → tiered subscriptions; first 100 paying customers via direct engagement + referrals  
**Payments:** Paystack + Flutterwave  
**Integrations (phased):** WhatsApp Business, Instagram/Facebook, LinkedIn  

---

## LOCKED TECH STACK (DO NOT SUBSTITUTE)

### Frontend
- Next.js (App Router)
- TypeScript
- Tailwind CSS
- Shadcn UI
- Server Components + Client Components where appropriate
- React Query / TanStack Query for client data fetching against FastAPI (unless you justify a better pattern)

### Backend
- FastAPI (Python)
- Async SQLAlchemy 2.x
- Pydantic v2
- Alembic migrations (PostgreSQL)
- Background jobs: ARQ or Celery (choose one with justification)
- Redis for job queue / rate limiting / session cache (if needed)

### Databases (DUAL — MANDATORY)
You **must** design a clear dual-database strategy:

1. **PostgreSQL (+ pgvector)**
   - System of record for relational multi-tenant data
   - Business profiles, campaigns, content, billing, RBAC, audit logs
   - Vector embeddings / AI memory / RAG retrieval for brand knowledge

2. **Turso (libSQL)**
   - Define its exact role with precision — do **not** vaguely say “also use Turso”
   - Propose and defend one primary pattern, e.g.:
     - Edge/read-replica style caches for low-latency tenant reads, **or**
     - Per-tenant lightweight state / feature flags / session metadata, **or**
     - High-write ephemeral event/activity streams synced from Postgres, **or**
     - A hybrid where Postgres is source of truth and Turso is tenant-scoped operational store
   - Explicitly document: what lives ONLY in Postgres, what lives ONLY in Turso, what is duplicated, sync direction, conflict rules, and failure modes

### Authentication (CUSTOM — FROM SCRATCH)
**Do NOT use Clerk, Supabase Auth, Auth0, Firebase, or NextAuth as the identity provider.**

Design and plan a **first-party auth system** including:

- Email + password registration / login
- Secure password hashing (Argon2id preferred)
- Email verification
- Password reset tokens
- Refresh token rotation + access tokens (JWT or opaque tokens — choose and justify)
- Session revocation / logout-all-devices
- Optional MFA (TOTP) roadmap
- Invitation flows for team members
- Super Admin bootstrap / break-glass access
- CSRF protection strategy for cookie-based sessions if cookies are used
- Rate limiting on auth endpoints
- Account lockout / brute-force protection
- Audit logging for auth events

### Multi-Tenancy
- Organization/tenant model (`tenant_id` / `org_id`)
- Strict tenant isolation on every read/write
- Roles: at minimum `owner`, `admin`, `member`, `viewer` (tenant-scoped) + platform `super_admin`
- Prefer shared-database, shared-schema with `tenant_id` + enforcement middleware (justify alternatives if better)
- Document whether RLS in Postgres is used, app-level enforcement, or both

### AI / LLM
- Custom async Python orchestration layer (LangChain optional — justify if used)
- OpenAI / Anthropic (provider abstraction + fallbacks)
- RAG over business memory in `pgvector`
- Prompt template versioning (global + tenant overrides)
- Token usage metering per tenant

### Storage
- Object storage for generated media (S3-compatible — AWS S3 or Cloudflare R2; justify choice)
- Signed upload/download URLs

### Deployment
- Docker
- Cloud-ready (AWS/GCP/Azure — recommend one for Africa latency + cost)
- Observability: structured logs, metrics, tracing, error tracking

---

## APPLICATION SURFACES (THREE PRODUCTS IN ONE)

Plan the system as **three distinct frontend surfaces** sharing one backend and one design system:

### A. Public User Interface (`/` — marketing + acquisition)
- Landing page (brand-led, African SME positioning)
- Pricing + 14-day free trial funnel
- Auth pages: sign up, login, verify email, reset password
- Help / legal basics
- SEO-friendly marketing routes

### B. Tenant Business Dashboard (`/app` or `/dashboard` — SME portal)
Strictly isolated by `tenant_id`.

Modules:
1. **Dashboard Overview** — campaign stats, quick actions, recent activity
2. **AI Marketing Engine** — 30-day strategy generator, content calendar (month/week), caption + graphic prompt generators
3. **Content & Asset Library** — approval workflow, media grid, hashtag/CTA manager
4. **Brand / Business Profile** — editable business memory inputs that feed RAG
5. **Settings & Billing** — team roles, integrations (WhatsApp, Instagram, Paystack/Flutterwave), subscription status
6. **Onboarding wizard** — Business Profile → Brand Voice → Audience → Competitors → Socials → AI memory initialization

### C. Super Admin Dashboard (`/admin` — platform ops)
Protected by platform `super_admin` role guards (separate from tenant roles).

Modules:
1. **Tenant & User Management** — view, suspend, manage subscriptions; controlled impersonation with audit trail
2. **AI & Prompt Ops** — global prompt templates, model routing/fallbacks, per-tenant token analytics
3. **System Health** — API metrics, job queues, integration health
4. **Billing & Revenue Ops** — MRR/revenue analytics, manual subscription overrides, gateway status

---

## WHAT YOU MUST PRODUCE

Generate a **comprehensive advanced architecture plan** with the following sections. Use concrete schemas, endpoint paths, folder trees, and sequenced tasks — not vague advice.

### 1. Executive Architecture Decisions
A decision log table:
| Decision | Choice | Why | Alternatives rejected | Risk |

Must include decisions for:
- Dual DB split (Postgres vs Turso)
- Auth token strategy (JWT vs opaque sessions)
- Cookie vs Authorization header for SPA/API
- Tenant isolation strategy
- Monorepo vs polyrepo
- Background job system
- Object storage provider
- AI orchestration approach

### 2. System Architecture
- High-level component diagram (describe in Mermaid)
- Request lifecycle for authenticated tenant API calls
- Auth lifecycle (signup → verify → login → refresh → logout)
- AI generation pipeline (onboarding → embed → strategy → calendar → captions/assets → approval)
- Dual-database data flow diagram

### 3. Multi-Tenancy & Security Deep Dive
- Tenant creation on signup / onboarding
- Middleware/dependencies in FastAPI that inject `current_user`, `current_tenant`, `roles`
- How every query is scoped
- Cross-tenant leak test plan
- Impersonation security model for super admin
- Secrets management, encryption at rest for tokens/API keys (integration credentials)
- Threat model (top 10 risks + mitigations) specific to custom auth + multi-tenant SaaS

### 4. Database Architecture
#### 4.1 PostgreSQL schema (SQLAlchemy-oriented)
Provide full table designs with columns, types, indexes, FKs, unique constraints for at least:

- `tenants`
- `users`
- `memberships` (user↔tenant + role)
- `auth_sessions` / `refresh_tokens`
- `email_verification_tokens`
- `password_reset_tokens`
- `business_profiles`
- `brand_identities`
- `products_services`
- `target_audiences`
- `competitors`
- `social_accounts`
- `campaigns`
- `content_posts`
- `content_assets`
- `hashtags` / `ctas`
- `ai_memories` / embeddings (`vector` column)
- `prompt_templates`
- `llm_usage_events`
- `subscriptions` / `billing_events`
- `integrations`
- `audit_logs`
- `admin_actions`

Include:
- Soft delete strategy
- UUID vs ULID vs bigint IDs (choose one)
- Timestamps / timezone policy
- Indexing strategy for tenant-scoped queries
- pgvector index strategy (HNSW/IVFFlat)

#### 4.2 Turso schema
- Exact tables/collections
- Why each exists in Turso instead of Postgres
- Sync/replication strategy (if any)
- Offline/edge considerations (if relevant)

### 5. Custom Auth Specification
Detail:
- Password policy
- Token payloads / claims (`sub`, `tenant_id`, `roles`, `sid`, `jti`, etc.)
- Refresh rotation + reuse detection
- Device/session listing
- Invitation + accept invite flow
- Super admin provisioning
- Frontend auth state management (Next.js middleware, protected route groups)
- API auth dependency injection patterns in FastAPI

### 6. Project Folder Structure
Provide clean monorepo (or justified polyrepo) layout for:

```
apps/web (Next.js)
apps/api (FastAPI)
packages/* (optional shared types/contracts)
infra/*
docs/*
```

Show App Router route groups for:
- `(marketing)`
- `(auth)`
- `(app)` tenant dashboard
- `(admin)` super admin

Show FastAPI module layout:
- `api/v1/routers`
- `core` (config, security)
- `domain` / `services`
- `models`
- `schemas`
- `db` (postgres + turso clients)
- `workers`
- `ai`

### 7. API Contract Design
Design versioned REST endpoints (`/api/v1/...`) grouped by:

1. Auth
2. Tenants / Memberships
3. Business Profile / Brand Memory
4. Marketing Engine (strategy, calendar, generate)
5. Content Library / Approvals
6. Assets / Uploads
7. Billing / Webhooks (Paystack, Flutterwave)
8. Integrations
9. Admin Ops
10. Health / Internal

For each group: method, path, auth required, tenant required, request/response shape summary, idempotency notes where relevant.

Also define:
- Error response envelope
- Pagination standard
- Idempotency keys for AI generation jobs
- Webhook signature verification strategy

### 8. AI Marketing Engine Design
- Business memory model (what gets embedded)
- Prompt template system (global defaults + tenant overrides + versioning)
- 30-day strategy generation job design (async)
- Content calendar data model
- Caption / hashtag / CTA generation
- Graphic prompt generation + asset pipeline
- Approval workflow state machine
- Cost controls / rate limits / quotas per plan tier
- Evaluation hooks (quality, brand-voice adherence)

### 9. Frontend UX Architecture
- Route map for all three surfaces
- Onboarding step machine
- Calendar UX (month/week)
- Approval UX
- Empty states / loading / error patterns
- Mobile-first constraints for African SME users (performance budget)
- Design tokens / brand direction constraints (avoid generic AI purple SaaS look; African-first, trustworthy, simple)

### 10. Background Jobs & Integrations
- Job catalog (email verify, embed business memory, generate strategy, generate posts, publish, billing sync)
- Retry / dead-letter strategy
- WhatsApp / Instagram integration phasing (MVP stub vs real)
- Paystack / Flutterwave subscription lifecycle

### 11. Observability, Compliance & Ops
- Logging, metrics, tracing
- Audit log requirements
- GDPR-ish / NDPR (Nigeria Data Protection Act) considerations
- Backup / restore for Postgres + Turso
- Environment matrix (local, staging, prod)

### 12. Phase Plan (Advanced — Not a Toy Roadmap)

Produce a **detailed execution roadmap** from zero → private alpha → beta, with exit criteria per phase.

#### Phase 0 — Foundations (Week 0–1)
Repo, CI, Docker, lint, env, secrets, health checks

#### Phase 1 — Identity, Tenancy, Dual DB (Week 1–3)
Custom auth + tenants + memberships + Postgres schema + Turso role + middleware isolation + Next.js auth gates

#### Phase 2 — Onboarding + Business Memory (Week 3–4)
Onboarding wizard, business profile APIs, embeddings, RAG retrieval smoke tests

#### Phase 3 — AI Marketing MVP (Week 4–7)
Strategy generation, calendar, captions, graphic prompts, approval workflow, asset library

#### Phase 4 — Billing + Admin Ops (Week 7–8)
Trial, Paystack/Flutterwave, super admin dashboards, token usage, suspend/impersonate

#### Phase 5 — Private Alpha Hardening (Week 8–10)
Security review, load testing tenant isolation, onboarding <10 min metric, bugfix, alpha with 5–10 businesses

#### Phase 6 — Beta / First Paying Customers (Week 10–12)
Refinement, referral basics, monitoring, first 100-customer acquisition support features

For each phase include:
- Concrete engineering tasks (checklist)
- Dependencies
- Definition of Done
- Test plan (unit / integration / e2e / security)
- Risks & mitigations

### 13. MVP Cut Line (Ruthless)
Explicitly list:
- **Must ship for alpha**
- **Should ship for beta**
- **Explicitly defer** (e.g. LinkedIn publishing, MFA, advanced analytics, multi-department AI)

### 14. First 14 Engineering Days (Day-by-Day)
Give a day-by-day build order a single strong full-stack engineer (or 2-person team) can follow, starting from empty repo to working auth + tenant dashboard shell + admin shell + DB foundations.

---

## PLANNING QUALITY BAR

Your plan must:

1. Be specific enough to implement without re-asking “how should tenancy work?”
2. Treat **custom auth** and **tenant isolation** as the highest-risk foundations — design them first, not last
3. Make the **Postgres vs Turso** boundary unambiguous
4. Align every MVP feature to the foundation PRD and <10 minute time-to-first-campaign metric
5. Call out Africa-first constraints (payments, WhatsApp, performance, trust, NDPR)
6. Prefer a modular monolith API first; justify microservices only if necessary (default: no)
7. Include Mermaid diagrams for architecture, auth flow, and AI pipeline
8. End with open questions / decisions that still need founder input (pricing tiers, exact model providers, brand name assets, etc.)

---

## OUTPUT FORMAT

Respond in this order:
1. Decision Log
2. Architecture Diagrams (Mermaid)
3. Dual-Database Design
4. Schema Designs
5. Auth Spec
6. Folder Structure
7. API Contract
8. AI Engine Design
9. Frontend Surface Map
10. Phased Roadmap + Day-by-Day Plan
11. MVP Cut Line
12. Open Questions for Founder

Do not write production code in this planning response unless a short illustrative snippet clarifies a critical pattern (e.g. FastAPI tenant dependency). Focus on architecture and execution clarity.
