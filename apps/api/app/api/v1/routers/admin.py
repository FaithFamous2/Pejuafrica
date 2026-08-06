"""Super admin platform operations — Phase 4/5."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Query, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from app.core.cookies import set_auth_cookies
from app.core.deps import DbSession, PlatformAdmin
from app.core.security import create_access_token, generate_refresh_token, hash_token
from app.db.turso import get_turso
from app.models import (
    AuditLog,
    AuthSession,
    BusinessProfile,
    Campaign,
    ContentPost,
    ContentStatus,
    LlmUsageEvent,
    Membership,
    MembershipRole,
    PromptTemplate,
    Subscription,
    SubscriptionStatus,
    Tenant,
    TenantStatus,
    User,
)
from app.schemas.auth import TenantAdminResponse

router = APIRouter(prefix="/admin", tags=["admin"])


class TenantStatusUpdate(BaseModel):
    status: TenantStatus


class AdminStatsResponse(BaseModel):
    tenants: int
    users: int
    campaigns: int
    content_posts: int
    active_subscriptions: int
    trial_tenants: int
    total_tokens: int = 0


class UsageByTenant(BaseModel):
    tenant_id: uuid.UUID
    tenant_name: str
    events: int
    total_tokens: int


class PromptTemplateIn(BaseModel):
    key: str = Field(min_length=2, max_length=120)
    name: str = Field(min_length=2, max_length=255)
    description: str | None = None
    body: str = Field(min_length=10)
    is_active: bool = True


class PromptTemplateOut(BaseModel):
    id: uuid.UUID
    key: str
    name: str
    description: str | None
    body: str
    version: int
    is_active: bool

    model_config = {"from_attributes": True}


@router.get("/tenants", response_model=list[TenantAdminResponse])
async def list_tenants(
    _auth: PlatformAdmin,
    db: DbSession,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
):
    result = await db.scalars(
        select(Tenant)
        .where(Tenant.deleted_at.is_(None))
        .order_by(Tenant.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    return [TenantAdminResponse.model_validate(t) for t in result]


@router.get("/stats", response_model=AdminStatsResponse)
async def platform_stats(_auth: PlatformAdmin, db: DbSession):
    tenants = await db.scalar(
        select(func.count()).select_from(Tenant).where(Tenant.deleted_at.is_(None))
    )
    users = await db.scalar(
        select(func.count()).select_from(User).where(User.deleted_at.is_(None))
    )
    campaigns = await db.scalar(
        select(func.count()).select_from(Campaign).where(Campaign.deleted_at.is_(None))
    )
    posts = await db.scalar(
        select(func.count()).select_from(ContentPost).where(ContentPost.deleted_at.is_(None))
    )
    active_subs = await db.scalar(
        select(func.count())
        .select_from(Subscription)
        .where(
            Subscription.deleted_at.is_(None),
            Subscription.status.in_([SubscriptionStatus.trialing, SubscriptionStatus.active]),
        )
    )
    trial_tenants = await db.scalar(
        select(func.count())
        .select_from(Tenant)
        .where(Tenant.deleted_at.is_(None), Tenant.status == TenantStatus.trial)
    )
    total_tokens = await db.scalar(select(func.coalesce(func.sum(LlmUsageEvent.total_tokens), 0)))
    return AdminStatsResponse(
        tenants=tenants or 0,
        users=users or 0,
        campaigns=campaigns or 0,
        content_posts=posts or 0,
        active_subscriptions=active_subs or 0,
        trial_tenants=trial_tenants or 0,
        total_tokens=int(total_tokens or 0),
    )


@router.get("/usage", response_model=list[UsageByTenant])
async def usage_by_tenant(_auth: PlatformAdmin, db: DbSession):
    rows = await db.execute(
        select(
            LlmUsageEvent.tenant_id,
            Tenant.name,
            func.count(LlmUsageEvent.id),
            func.coalesce(func.sum(LlmUsageEvent.total_tokens), 0),
        )
        .join(Tenant, Tenant.id == LlmUsageEvent.tenant_id)
        .group_by(LlmUsageEvent.tenant_id, Tenant.name)
        .order_by(func.coalesce(func.sum(LlmUsageEvent.total_tokens), 0).desc())
    )
    return [
        UsageByTenant(
            tenant_id=r[0],
            tenant_name=r[1],
            events=int(r[2]),
            total_tokens=int(r[3]),
        )
        for r in rows.all()
    ]


@router.patch("/tenants/{tenant_id}/status", response_model=TenantAdminResponse)
async def update_tenant_status(
    tenant_id: uuid.UUID,
    payload: TenantStatusUpdate,
    auth: PlatformAdmin,
    db: DbSession,
):
    tenant = await db.scalar(
        select(Tenant).where(Tenant.id == tenant_id, Tenant.deleted_at.is_(None))
    )
    if not tenant:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Tenant not found")

    tenant.status = payload.status
    await db.flush()
    await db.refresh(tenant)

    db.add(
        AuditLog(
            tenant_id=tenant.id,
            actor_user_id=auth.user.id,
            action="admin.tenant_status",
            resource_type="tenant",
            resource_id=str(tenant.id),
            metadata_json={"status": payload.status.value},
        )
    )
    try:
        get_turso().insert_activity(
            event_id=str(uuid.uuid4()),
            tenant_id=str(tenant.id),
            actor_user_id=str(auth.user.id),
            event_type="admin.tenant_status",
            title=f"Tenant status set to {payload.status.value}",
            metadata={"by": auth.user.email},
            created_at=datetime.now(timezone.utc).isoformat(),
        )
    except Exception:
        pass

    return TenantAdminResponse.model_validate(tenant)


@router.post("/tenants/{tenant_id}/impersonate")
async def impersonate_tenant(
    tenant_id: uuid.UUID,
    auth: PlatformAdmin,
    db: DbSession,
    response: Response,
):
    """Start a short-lived session as the tenant owner for support debugging."""
    tenant = await db.scalar(
        select(Tenant).where(Tenant.id == tenant_id, Tenant.deleted_at.is_(None))
    )
    if not tenant:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Tenant not found")

    membership = await db.scalar(
        select(Membership)
        .where(
            Membership.tenant_id == tenant.id,
            Membership.role == MembershipRole.owner,
        )
        .limit(1)
    )
    if not membership:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Tenant has no owner")

    owner = await db.scalar(select(User).where(User.id == membership.user_id))
    if not owner or not owner.is_active:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Owner inactive")

    raw_refresh = generate_refresh_token()
    session = AuthSession(
        user_id=owner.id,
        refresh_token_hash=hash_token(raw_refresh),
        user_agent="peju-admin-impersonation",
        ip_address=None,
        expires_at=datetime.now(timezone.utc) + timedelta(hours=2),
    )
    db.add(session)
    await db.flush()

    access = create_access_token(
        user_id=owner.id,
        tenant_id=tenant.id,
        roles=[membership.role.value],
        session_id=session.id,
        is_platform_admin=False,
        impersonator_id=auth.user.id,
    )
    set_auth_cookies(response, access_token=access, refresh_token=raw_refresh)

    db.add(
        AuditLog(
            tenant_id=tenant.id,
            actor_user_id=auth.user.id,
            action="admin.impersonate",
            resource_type="tenant",
            resource_id=str(tenant.id),
            metadata_json={"as_user": str(owner.id), "session_id": str(session.id)},
        )
    )
    await db.flush()

    return {
        "message": "Impersonation session started",
        "tenant_id": str(tenant.id),
        "as_user": {"id": str(owner.id), "email": owner.email, "full_name": owner.full_name},
        "expires_minutes": 120,
        "note": "Cookies set for the impersonated owner. Use X-Tenant-Id with this tenant.",
    }


@router.get("/prompts", response_model=list[PromptTemplateOut])
async def list_prompts(_auth: PlatformAdmin, db: DbSession):
    rows = await db.scalars(
        select(PromptTemplate)
        .where(PromptTemplate.deleted_at.is_(None))
        .order_by(PromptTemplate.key.asc())
    )
    return [PromptTemplateOut.model_validate(r) for r in rows]


@router.post("/prompts", response_model=PromptTemplateOut, status_code=201)
async def upsert_prompt(payload: PromptTemplateIn, auth: PlatformAdmin, db: DbSession):
    existing = await db.scalar(
        select(PromptTemplate).where(
            PromptTemplate.key == payload.key,
            PromptTemplate.deleted_at.is_(None),
        )
    )
    if existing:
        existing.name = payload.name
        existing.description = payload.description
        existing.body = payload.body
        existing.is_active = payload.is_active
        existing.version += 1
        await db.flush()
        await db.refresh(existing)
        return PromptTemplateOut.model_validate(existing)

    row = PromptTemplate(
        key=payload.key,
        name=payload.name,
        description=payload.description,
        body=payload.body,
        is_active=payload.is_active,
    )
    db.add(row)
    await db.flush()
    await db.refresh(row)
    db.add(
        AuditLog(
            actor_user_id=auth.user.id,
            action="admin.prompt_upsert",
            resource_type="prompt_template",
            resource_id=str(row.id),
            metadata_json={"key": row.key},
        )
    )
    return PromptTemplateOut.model_validate(row)


class AdminPostOut(BaseModel):
    id: uuid.UUID
    campaign_id: uuid.UUID
    day_index: int
    scheduled_date: datetime
    platform: str
    theme: str
    caption: str
    hashtags: list | None
    cta: str | None
    graphic_prompt: str | None
    graphic_url: str | None = None
    status: str

    model_config = {"from_attributes": True}


class AdminCampaignOut(BaseModel):
    id: uuid.UUID
    title: str
    month: int
    year: int
    status: str
    strategy_summary: str | None
    pillars: list | None
    objectives: list | None
    generation_provider: str | None = None
    generation_model: str | None = None
    posts: list[AdminPostOut] = []
    created_at: datetime
    post_count: int = 0

    model_config = {"from_attributes": True}


class AdminTenantMarketingOut(BaseModel):
    tenant_id: uuid.UUID
    tenant_name: str
    tenant_slug: str
    business_name: str | None = None
    industry: str | None = None
    campaigns: list[AdminCampaignOut]


@router.get("/tenants/{tenant_id}/marketing", response_model=AdminTenantMarketingOut)
async def tenant_marketing_detail(tenant_id: uuid.UUID, _auth: PlatformAdmin, db: DbSession):
    """Inspect AI marketing campaigns + posts generated for a tenant."""
    tenant = await db.scalar(
        select(Tenant).where(Tenant.id == tenant_id, Tenant.deleted_at.is_(None))
    )
    if not tenant:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Tenant not found")

    profile = await db.scalar(
        select(BusinessProfile).where(
            BusinessProfile.tenant_id == tenant.id,
            BusinessProfile.deleted_at.is_(None),
        )
    )

    campaigns = (
        await db.scalars(
            select(Campaign)
            .options(selectinload(Campaign.posts))
            .where(Campaign.tenant_id == tenant.id, Campaign.deleted_at.is_(None))
            .order_by(Campaign.created_at.desc())
            .limit(20)
        )
    ).all()

    out_campaigns: list[AdminCampaignOut] = []
    for c in campaigns:
        posts = sorted(
            [p for p in (c.posts or []) if p.deleted_at is None],
            key=lambda p: p.day_index,
        )
        item = AdminCampaignOut.model_validate(c)
        item.posts = [AdminPostOut.model_validate(p) for p in posts]
        item.post_count = len(posts)
        out_campaigns.append(item)

    return AdminTenantMarketingOut(
        tenant_id=tenant.id,
        tenant_name=tenant.name,
        tenant_slug=tenant.slug,
        business_name=profile.business_name if profile else None,
        industry=profile.industry if profile else None,
        campaigns=out_campaigns,
    )


@router.get("/success-metrics")
async def success_metrics(_auth: PlatformAdmin, db: DbSession):
    """Platform success metrics for the marketing wedge."""
    now = datetime.now(timezone.utc)
    week_ago = now - timedelta(days=7)

    tenants = await db.scalar(
        select(func.count()).select_from(Tenant).where(Tenant.deleted_at.is_(None))
    ) or 0
    campaigns = await db.scalar(
        select(func.count()).select_from(Campaign).where(Campaign.deleted_at.is_(None))
    ) or 0
    drafts = await db.scalar(
        select(func.count())
        .select_from(ContentPost)
        .where(ContentPost.deleted_at.is_(None), ContentPost.status == ContentStatus.draft)
    ) or 0
    approved = await db.scalar(
        select(func.count())
        .select_from(ContentPost)
        .where(ContentPost.deleted_at.is_(None), ContentPost.status == ContentStatus.approved)
    ) or 0
    published = await db.scalar(
        select(func.count())
        .select_from(ContentPost)
        .where(ContentPost.deleted_at.is_(None), ContentPost.status == ContentStatus.published)
    ) or 0

    # Weekly active workspaces = tenants with any content/campaign activity in 7 days
    weekly_active = await db.scalar(
        select(func.count(func.distinct(ContentPost.tenant_id))).where(
            ContentPost.deleted_at.is_(None),
            ContentPost.updated_at >= week_ago,
        )
    ) or 0

    # Approx time-to-first-campaign: average hours from tenant.created_at to first campaign
    first_campaigns = await db.execute(
        select(Tenant.created_at, func.min(Campaign.created_at))
        .join(Campaign, Campaign.tenant_id == Tenant.id)
        .where(Tenant.deleted_at.is_(None), Campaign.deleted_at.is_(None))
        .group_by(Tenant.id, Tenant.created_at)
    )
    deltas_minutes: list[float] = []
    for tenant_created, first_campaign in first_campaigns.all():
        if tenant_created and first_campaign:
            deltas_minutes.append((first_campaign - tenant_created).total_seconds() / 60.0)

    avg_ttf_minutes = round(sum(deltas_minutes) / len(deltas_minutes), 1) if deltas_minutes else None
    approval_denom = drafts + approved + published
    approval_rate = round((approved + published) / approval_denom * 100, 1) if approval_denom else 0.0

    # Retention proxy: tenants with activity in last 7 days among tenants older than 14 days
    older = await db.scalar(
        select(func.count()).select_from(Tenant).where(
            Tenant.deleted_at.is_(None),
            Tenant.created_at <= now - timedelta(days=14),
        )
    ) or 0
    retained = await db.scalar(
        select(func.count(func.distinct(ContentPost.tenant_id)))
        .join(Tenant, Tenant.id == ContentPost.tenant_id)
        .where(
            ContentPost.deleted_at.is_(None),
            ContentPost.updated_at >= week_ago,
            Tenant.deleted_at.is_(None),
            Tenant.created_at <= now - timedelta(days=14),
        )
    ) or 0
    retention_rate = round(retained / older * 100, 1) if older else None

    return {
        "tenants": int(tenants),
        "campaigns": int(campaigns),
        "draft_posts": int(drafts),
        "approved_posts": int(approved),
        "published_posts": int(published),
        "approval_rate_pct": approval_rate,
        "avg_time_to_first_campaign_minutes": avg_ttf_minutes,
        "time_to_first_campaign_under_10_min": (
            avg_ttf_minutes is not None and avg_ttf_minutes < 10
        ),
        "weekly_active_users": int(weekly_active),
        "customer_retention_pct": retention_rate,
        "target": {
            "time_to_first_campaign_minutes": 10,
            "approval_rate_pct": 60,
            "weekly_active_users": "growing",
        },
    }
