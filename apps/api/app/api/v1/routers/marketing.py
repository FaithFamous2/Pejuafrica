"""Marketing engine API — campaigns & content calendar."""

from __future__ import annotations

import uuid
from datetime import date as date_cls, datetime, timezone

from fastapi import APIRouter, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from app.ai.generation_brief import GenerationBrief, GenerationBriefIn, OCCASIONS, TONES
from app.ai.marketing_generator import (
    generate_campaign_plan,
    redraft_creative_brief,
    regenerate_day_content,
    stream_regenerate_day_content,
)
from app.core.config import get_settings
from app.core.deps import CurrentAuth, DbSession
from app.core.rate_limit import enforce_rate_limit
from app.db.turso import get_turso
from app.models import (
    BusinessProfile,
    Campaign,
    CampaignStatus,
    ContentPost,
    ContentPostMedia,
    ContentStatus,
    LlmUsageEvent,
    MediaAsset,
    MediaSource,
    MembershipRole,
)
from app.services.media_service import (
    attach_asset_to_post,
    create_media_asset,
    load_post_with_media,
    post_response_dict,
    sync_post_primary_url,
)

router = APIRouter(prefix="/marketing", tags=["marketing"])

# Campaign → posts → media must be eager-loaded; lazy media_links causes MissingGreenlet
_CAMPAIGN_WITH_MEDIA = selectinload(Campaign.posts).selectinload(ContentPost.media_links).selectinload(
    ContentPostMedia.asset
)


def _post_resp(post: ContentPost) -> ContentPostResponse:
    return ContentPostResponse(**post_response_dict(post))


def _campaign_resp(campaign: Campaign) -> CampaignResponse:
    posts = sorted(campaign.posts or [], key=lambda p: p.day_index)
    return CampaignResponse(
        id=campaign.id,
        title=campaign.title,
        month=campaign.month,
        year=campaign.year,
        status=campaign.status.value if hasattr(campaign.status, "value") else str(campaign.status),
        strategy_summary=campaign.strategy_summary,
        pillars=campaign.pillars,
        objectives=campaign.objectives,
        generation_provider=campaign.generation_provider,
        generation_model=campaign.generation_model,
        posts=[_post_resp(p) for p in posts],
        created_at=campaign.created_at,
    )


class GenerateCampaignRequest(BaseModel):
    month: int | None = Field(default=None, ge=1, le=12)
    year: int | None = Field(default=None, ge=2024, le=2100)
    brief: GenerationBriefIn | None = None


class RegeneratePostRequest(BaseModel):
    brief: GenerationBriefIn | None = None


class AssistBriefRequest(BaseModel):
    rough_notes: str = Field(default="", max_length=2000)
    scope: str = Field(default="month", pattern="^(month|day)$")


class ContentPostMediaItem(BaseModel):
    id: uuid.UUID
    url: str
    title: str | None = None
    source: str
    role: str | None = None
    attachment_role: str | None = None
    sort_order: int = 0
    filename: str | None = None
    mime_type: str | None = None
    meta_json: dict | None = None


class ContentPostResponse(BaseModel):
    id: uuid.UUID
    campaign_id: uuid.UUID
    scheduled_date: datetime
    day_index: int
    platform: str
    theme: str
    caption: str
    hashtags: list | None
    cta: str | None
    graphic_prompt: str | None
    graphic_url: str | None = None
    status: str
    media: list[ContentPostMediaItem] = []
    media_count: int = 0

    model_config = {"from_attributes": True}


class AttachMediaRequest(BaseModel):
    media_ids: list[uuid.UUID] = Field(min_length=1, max_length=10)


class GenerateGraphicsRequest(BaseModel):
    count: int | None = Field(default=None, ge=1, le=5)
    replace: bool = False
    template_id: str | None = None
    template_ids: list[str] | None = Field(default=None, max_length=5)
    image_url: str | None = Field(default=None, max_length=1024)
    media_asset_id: uuid.UUID | None = None
    use_logo: bool = False
    # auto = prefer configured image AI, else SVG templates
    engine: str = Field(default="auto", pattern="^(auto|ai|template)$")
    style_hint: str | None = Field(default=None, max_length=500)
    # Optional user direction — text on the graphic + visual prompt for image AI
    on_image_text: str | None = Field(default=None, max_length=500)
    image_prompt: str | None = Field(default=None, max_length=1000)


class SuggestGraphicDirectionRequest(BaseModel):
    notes: str | None = Field(default=None, max_length=800)
    mode: str = Field(default="both", pattern="^(text|image|both)$")


class SuggestGraphicDirectionResponse(BaseModel):
    on_image_text: str | None = None
    image_prompt: str | None = None
    source: str = "heuristic"


class CampaignResponse(BaseModel):
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
    posts: list[ContentPostResponse] = []
    created_at: datetime

    model_config = {"from_attributes": True}


class MarketingOverviewResponse(BaseModel):
    campaigns: int
    draft_posts: int
    approved_posts: int
    published_posts: int = 0
    latest_campaign: CampaignResponse | None = None
    upcoming_posts: list[ContentPostResponse] = []
    approval_queue: list[ContentPostResponse] = []


class UpdatePostRequest(BaseModel):
    status: ContentStatus | None = None
    caption: str | None = Field(default=None, max_length=8000)
    hashtags: list[str] | None = None
    cta: str | None = Field(default=None, max_length=255)
    theme: str | None = Field(default=None, max_length=120)
    graphic_prompt: str | None = Field(default=None, max_length=4000)
    platform: str | None = Field(default=None, max_length=40)


def _usage_meta(
    *,
    action: str,
    brief: GenerationBrief,
    plan_or_post: dict,
    extra: dict | None = None,
) -> dict:
    meta = {
        "action": action,
        "brief": brief.to_metadata(),
        "prompt_excerpt": (plan_or_post.get("prompt_excerpt") or "")[:2500],
        "response_excerpt": (plan_or_post.get("response_excerpt") or "")[:1500],
    }
    if extra:
        meta.update(extra)
    return meta


@router.get("/graphic-templates")
async def graphic_templates(auth: CurrentAuth):
    """Catalog of selectable graphic design templates."""
    auth.require_tenant()
    from app.services.graphic_service import list_graphic_templates

    return {"templates": list_graphic_templates()}


@router.get("/generation-options")
async def generation_options(auth: CurrentAuth):
    auth.require_tenant()
    return {"tones": TONES, "occasions": OCCASIONS}


@router.post("/assist/brief")
async def assist_brief(payload: AssistBriefRequest, auth: CurrentAuth, db: DbSession, request: Request):
    enforce_rate_limit(request, scope=f"assist:{auth.user.id}", limit=40, window_seconds=3600)
    tenant = auth.require_tenant()
    auth.require_roles(MembershipRole.owner, MembershipRole.admin, MembershipRole.member)
    profile = await db.scalar(
        select(BusinessProfile).where(
            BusinessProfile.tenant_id == tenant.id,
            BusinessProfile.deleted_at.is_(None),
        )
    )
    if not profile or not profile.memory_initialized:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Complete onboarding first")

    result = await redraft_creative_brief(
        profile,
        rough_notes=payload.rough_notes,
        scope=payload.scope,
        db=db,
    )
    usage = result.get("usage")
    db.add(
        LlmUsageEvent(
            tenant_id=tenant.id,
            user_id=auth.user.id,
            feature="marketing.assist_brief",
            provider=(usage or {}).get("provider", "peju_local"),
            model=(usage or {}).get("model", "template-v1"),
            prompt_tokens=int((usage or {}).get("prompt_tokens") or 0),
            completion_tokens=int((usage or {}).get("completion_tokens") or 0),
            total_tokens=int((usage or {}).get("total_tokens") or 0),
            metadata_json={
                "action": "assist_brief",
                "scope": payload.scope,
                "prompt_excerpt": (result.get("prompt_excerpt") or payload.rough_notes)[:2500],
                "response_excerpt": (result.get("response_excerpt") or result.get("polished_brief") or "")[
                    :1500
                ],
                "result": {
                    "focus": result.get("focus"),
                    "tone_suggestion": result.get("tone_suggestion"),
                    "occasion_suggestion": result.get("occasion_suggestion"),
                },
            },
        )
    )
    await db.flush()
    return {
        "focus": result.get("focus"),
        "tone_suggestion": result.get("tone_suggestion"),
        "occasion_suggestion": result.get("occasion_suggestion"),
        "polished_brief": result.get("polished_brief"),
        "extra_notes": result.get("extra_notes"),
    }


@router.get("/overview", response_model=MarketingOverviewResponse)
async def overview(auth: CurrentAuth, db: DbSession):
    tenant = auth.require_tenant()
    campaigns = await db.scalar(
        select(func.count())
        .select_from(Campaign)
        .where(Campaign.tenant_id == tenant.id, Campaign.deleted_at.is_(None))
    )
    drafts = await db.scalar(
        select(func.count())
        .select_from(ContentPost)
        .where(
            ContentPost.tenant_id == tenant.id,
            ContentPost.deleted_at.is_(None),
            ContentPost.status == ContentStatus.draft,
        )
    )
    approved = await db.scalar(
        select(func.count())
        .select_from(ContentPost)
        .where(
            ContentPost.tenant_id == tenant.id,
            ContentPost.deleted_at.is_(None),
            ContentPost.status == ContentStatus.approved,
        )
    )
    published = await db.scalar(
        select(func.count())
        .select_from(ContentPost)
        .where(
            ContentPost.tenant_id == tenant.id,
            ContentPost.deleted_at.is_(None),
            ContentPost.status == ContentStatus.published,
        )
    )
    latest = await db.scalar(
        select(Campaign)
        .options(_CAMPAIGN_WITH_MEDIA)
        .where(Campaign.tenant_id == tenant.id, Campaign.deleted_at.is_(None))
        .order_by(Campaign.created_at.desc())
        .limit(1)
    )
    now = datetime.now(timezone.utc)
    upcoming_rows = await db.scalars(
        select(ContentPost)
        .where(
            ContentPost.tenant_id == tenant.id,
            ContentPost.deleted_at.is_(None),
            ContentPost.scheduled_date >= now,
        )
        .order_by(ContentPost.scheduled_date.asc())
        .limit(5)
    )
    queue_rows = await db.scalars(
        select(ContentPost)
        .where(
            ContentPost.tenant_id == tenant.id,
            ContentPost.deleted_at.is_(None),
            ContentPost.status == ContentStatus.draft,
        )
        .order_by(ContentPost.scheduled_date.asc())
        .limit(5)
    )
    return MarketingOverviewResponse(
        campaigns=campaigns or 0,
        draft_posts=drafts or 0,
        approved_posts=approved or 0,
        published_posts=published or 0,
        latest_campaign=_campaign_resp(latest) if latest else None,
        upcoming_posts=[_post_resp(p) for p in upcoming_rows],
        approval_queue=[_post_resp(p) for p in queue_rows],
    )


@router.get("/campaigns", response_model=list[CampaignResponse])
async def list_campaigns(auth: CurrentAuth, db: DbSession):
    tenant = auth.require_tenant()
    rows = await db.scalars(
        select(Campaign)
        .options(_CAMPAIGN_WITH_MEDIA)
        .where(Campaign.tenant_id == tenant.id, Campaign.deleted_at.is_(None))
        .order_by(Campaign.created_at.desc())
    )
    return [_campaign_resp(c) for c in rows]


@router.get("/campaigns/{campaign_id}", response_model=CampaignResponse)
async def get_campaign(campaign_id: uuid.UUID, auth: CurrentAuth, db: DbSession):
    tenant = auth.require_tenant()
    campaign = await db.scalar(
        select(Campaign)
        .options(_CAMPAIGN_WITH_MEDIA)
        .where(
            Campaign.id == campaign_id,
            Campaign.tenant_id == tenant.id,
            Campaign.deleted_at.is_(None),
        )
    )
    if not campaign:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Campaign not found")
    return _campaign_resp(campaign)


@router.post("/campaigns/generate", response_model=CampaignResponse, status_code=201)
async def generate_campaign(
    payload: GenerateCampaignRequest,
    auth: CurrentAuth,
    db: DbSession,
    request: Request,
):
    settings = get_settings()
    enforce_rate_limit(
        request,
        scope="marketing.generate",
        limit=settings.rate_limit_generate_per_hour,
        window_seconds=3600,
    )

    tenant = auth.require_tenant()
    auth.require_roles(MembershipRole.owner, MembershipRole.admin, MembershipRole.member)

    profile = await db.scalar(
        select(BusinessProfile).where(
            BusinessProfile.tenant_id == tenant.id,
            BusinessProfile.deleted_at.is_(None),
        )
    )
    if not profile or not profile.memory_initialized:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Complete onboarding and initialize AI memory first",
        )

    now = datetime.now(timezone.utc)
    month = payload.month or now.month
    year = payload.year or now.year
    brief = GenerationBrief.from_payload(payload.brief)
    plan = await generate_campaign_plan(profile, month, year, db=db, brief=brief)
    strategy = plan["strategy"]
    composed_posts = plan["posts"]
    usage_meta = plan.get("usage") or {}
    gen_provider = (usage_meta.get("provider") if usage_meta else None) or (
        "template"
        if str(plan.get("provider", "")).startswith("template")
        else str(plan.get("provider", "template")).split(":")[0]
    )
    gen_model = usage_meta.get("model") if usage_meta else str(plan.get("provider") or "template-v1")

    title_bits = [f"{profile.business_name} — {month:02d}/{year} Plan"]
    if brief.focus:
        title_bits = [f"{profile.business_name} — {brief.focus[:48]}"]
    campaign = Campaign(
        tenant_id=tenant.id,
        title=title_bits[0][:200],
        month=month,
        year=year,
        status=CampaignStatus.ready,
        strategy_summary=strategy["summary"],
        pillars=strategy["pillars"],
        objectives=strategy["objectives"],
        generation_provider=gen_provider,
        generation_model=gen_model,
    )
    db.add(campaign)
    await db.flush()

    posts: list[ContentPost] = []
    for composed in composed_posts:
        posts.append(
            ContentPost(
                tenant_id=tenant.id,
                campaign_id=campaign.id,
                scheduled_date=composed["scheduled_date"],
                day_index=composed["day_index"],
                platform=composed["platform"],
                theme=composed["theme"],
                caption=composed["caption"],
                hashtags=composed["hashtags"],
                cta=composed["cta"],
                graphic_prompt=composed["graphic_prompt"],
                status=ContentStatus.draft,
            )
        )
    db.add_all(posts)
    await db.flush()

    sample_caption = posts[0].caption if posts else ""
    usage = plan.get("usage")
    meta = _usage_meta(
        action="campaign_generate",
        brief=brief,
        plan_or_post={
            **plan,
            "response_excerpt": plan.get("response_excerpt")
            or f"{strategy['summary']}\n\n{sample_caption}"[:1500],
        },
        extra={"campaign_id": str(campaign.id), "posts": len(posts), "month": month, "year": year},
    )
    db.add(
        LlmUsageEvent(
            tenant_id=tenant.id,
            user_id=auth.user.id,
            feature="marketing.campaign_generate",
            provider=(usage or {}).get("provider", "peju_local"),
            model=(usage or {}).get("model", str(plan.get("provider") or "template-v1")),
            prompt_tokens=int((usage or {}).get("prompt_tokens") or 0),
            completion_tokens=int((usage or {}).get("completion_tokens") or 0),
            total_tokens=int((usage or {}).get("total_tokens") or 0),
            metadata_json=meta,
        )
    )
    await db.flush()

    await db.refresh(campaign)
    campaign = await db.scalar(
        select(Campaign)
        .options(_CAMPAIGN_WITH_MEDIA)
        .where(Campaign.id == campaign.id)
    )
    assert campaign is not None
    campaign.posts.sort(key=lambda p: p.day_index)

    try:
        get_turso().insert_activity(
            event_id=str(uuid.uuid4()),
            tenant_id=str(tenant.id),
            actor_user_id=str(auth.user.id),
            event_type="marketing.campaign_generated",
            title=f"Generated 30-day plan for {month:02d}/{year}",
            metadata={
                "campaign_id": str(campaign.id),
                "posts": len(posts),
                "provider": plan.get("provider"),
                "generation_provider": gen_provider,
                "generation_model": gen_model,
                "brief": brief.to_metadata(),
            },
            created_at=datetime.now(timezone.utc).isoformat(),
        )
    except Exception:
        pass

    return _campaign_resp(campaign)


@router.get("/campaigns/{campaign_id}/export")
async def export_campaign(
    campaign_id: uuid.UUID,
    auth: CurrentAuth,
    db: DbSession,
    format: str = Query(default="markdown", pattern="^(markdown|json)$"),
):
    tenant = auth.require_tenant()
    campaign = await db.scalar(
        select(Campaign)
        .options(_CAMPAIGN_WITH_MEDIA)
        .where(
            Campaign.id == campaign_id,
            Campaign.tenant_id == tenant.id,
            Campaign.deleted_at.is_(None),
        )
    )
    if not campaign:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Campaign not found")
    campaign.posts.sort(key=lambda p: p.day_index)

    if format == "json":
        return _campaign_resp(campaign)

    lines = [
        f"# {campaign.title}",
        "",
        campaign.strategy_summary or "",
        "",
        "## Objectives",
        "",
    ]
    for obj in campaign.objectives or []:
        lines.append(f"- {obj}")
    lines.extend(["", "## Content calendar", ""])
    for post in campaign.posts:
        tags = " ".join(post.hashtags or [])
        lines.extend(
            [
                f"### Day {post.day_index} — {post.theme} ({post.platform})",
                f"Date: {post.scheduled_date.date().isoformat()}",
                f"Status: {post.status.value if hasattr(post.status, 'value') else post.status}",
                "",
                post.caption,
                "",
                f"CTA: {post.cta or '—'}",
                f"Hashtags: {tags}",
                f"Graphic prompt: {post.graphic_prompt or '—'}",
                "",
            ]
        )
    from fastapi.responses import PlainTextResponse

    return PlainTextResponse(
        "\n".join(lines),
        media_type="text/markdown; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="peju-campaign-{campaign.month}-{campaign.year}.md"'
        },
    )


@router.get("/posts", response_model=list[ContentPostResponse])
async def list_posts(
    auth: CurrentAuth,
    db: DbSession,
    status_filter: ContentStatus | None = Query(default=None, alias="status"),
    limit: int = Query(default=60, ge=1, le=200),
):
    tenant = auth.require_tenant()
    stmt = (
        select(ContentPost)
        .options(selectinload(ContentPost.media_links).selectinload(ContentPostMedia.asset))
        .where(ContentPost.tenant_id == tenant.id, ContentPost.deleted_at.is_(None))
        .order_by(ContentPost.scheduled_date.asc())
        .limit(limit)
    )
    if status_filter:
        stmt = stmt.where(ContentPost.status == status_filter)
    rows = await db.scalars(stmt)
    return [_post_resp(p) for p in rows]


@router.patch("/posts/{post_id}", response_model=ContentPostResponse)
async def update_post(
    post_id: uuid.UUID,
    payload: UpdatePostRequest,
    auth: CurrentAuth,
    db: DbSession,
):
    """Update status and/or editable copy (caption, hashtags, CTA)."""
    tenant = auth.require_tenant()
    auth.require_roles(MembershipRole.owner, MembershipRole.admin, MembershipRole.member)
    post = await load_post_with_media(db, post_id=post_id, tenant_id=tenant.id)
    if not post:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Post not found")

    if payload.status is not None:
        post.status = payload.status
    if payload.caption is not None:
        caption = payload.caption.strip()
        if not caption:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Caption cannot be empty")
        post.caption = caption
    if payload.hashtags is not None:
        cleaned = []
        for tag in payload.hashtags:
            t = str(tag).strip()
            if not t:
                continue
            if not t.startswith("#"):
                t = f"#{t}"
            cleaned.append(t[:60])
        post.hashtags = cleaned[:30]
    if payload.cta is not None:
        post.cta = payload.cta.strip() or None
    if payload.theme is not None:
        theme = payload.theme.strip()
        if theme:
            post.theme = theme[:120]
    if payload.graphic_prompt is not None:
        post.graphic_prompt = payload.graphic_prompt.strip() or None
    if payload.platform is not None:
        platform = payload.platform.strip().lower()
        allowed = {"instagram", "whatsapp", "facebook", "tiktok", "linkedin", "twitter", "x"}
        if platform not in allowed:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail="Platform must be instagram, whatsapp, facebook, tiktok, linkedin, or twitter",
            )
        post.platform = "twitter" if platform == "x" else platform

    await db.flush()
    post = await load_post_with_media(db, post_id=post.id, tenant_id=tenant.id)
    assert post is not None
    return _post_resp(post)


@router.post("/posts/{post_id}/regenerate", response_model=ContentPostResponse)
async def regenerate_post(
    post_id: uuid.UUID,
    request: Request,
    auth: CurrentAuth,
    db: DbSession,
    payload: RegeneratePostRequest | None = None,
):
    """Rewrite content for a single calendar day. Brief is optional — brand defaults apply."""
    enforce_rate_limit(
        request,
        scope=f"regen:{auth.user.id}",
        limit=30,
        window_seconds=3600,
    )
    tenant = auth.require_tenant()
    auth.require_roles(MembershipRole.owner, MembershipRole.admin, MembershipRole.member)

    post = await db.scalar(
        select(ContentPost).where(
            ContentPost.id == post_id,
            ContentPost.tenant_id == tenant.id,
            ContentPost.deleted_at.is_(None),
        )
    )
    if not post:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Post not found")

    profile = await db.scalar(
        select(BusinessProfile).where(
            BusinessProfile.tenant_id == tenant.id,
            BusinessProfile.deleted_at.is_(None),
        )
    )
    if not profile or not profile.memory_initialized:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Complete onboarding before regenerating posts",
        )

    scheduled = post.scheduled_date.date() if hasattr(post.scheduled_date, "date") else post.scheduled_date
    if not isinstance(scheduled, date_cls):
        scheduled = date_cls.fromisoformat(str(scheduled)[:10])

    brief = GenerationBrief.from_payload(payload.brief if payload else None)
    variation = (len(post.caption or "") + post.day_index + 3) % 11 + 1
    rewritten = await regenerate_day_content(
        profile,
        day_index=post.day_index,
        scheduled=scheduled,
        current_platform=post.platform,
        current_theme=post.theme,
        variation=variation,
        db=db,
        brief=brief,
    )

    post.platform = brief.platform_override or post.platform or rewritten["platform"]
    post.theme = rewritten["theme"]
    post.caption = rewritten["caption"]
    post.hashtags = rewritten["hashtags"]
    post.cta = rewritten["cta"]
    post.graphic_prompt = rewritten["graphic_prompt"]
    post.status = ContentStatus.draft

    usage = rewritten.get("usage")
    meta = _usage_meta(
        action="post_regenerate",
        brief=brief,
        plan_or_post=rewritten,
        extra={
            "post_id": str(post.id),
            "campaign_id": str(post.campaign_id),
            "day_index": post.day_index,
            "theme": post.theme,
            "platform": post.platform,
            "caption": post.caption[:800],
        },
    )
    db.add(
        LlmUsageEvent(
            tenant_id=tenant.id,
            user_id=auth.user.id,
            feature="marketing.post_regenerate",
            provider=(usage or {}).get("provider", "peju_local"),
            model=(usage or {}).get("model", str(rewritten.get("provider") or "template-v1")),
            prompt_tokens=int((usage or {}).get("prompt_tokens") or 0),
            completion_tokens=int((usage or {}).get("completion_tokens") or 0),
            total_tokens=int((usage or {}).get("total_tokens") or 0),
            metadata_json=meta,
        )
    )

    await db.flush()
    await db.refresh(post)

    try:
        get_turso().insert_activity(
            event_id=str(uuid.uuid4()),
            tenant_id=str(tenant.id),
            actor_user_id=str(auth.user.id),
            event_type="marketing.post_regenerated",
            title=f"Regenerated day {post.day_index} ({post.theme})",
            metadata={
                "post_id": str(post.id),
                "provider": rewritten.get("provider"),
                "brief": brief.to_metadata(),
            },
            created_at=datetime.now(timezone.utc).isoformat(),
        )
    except Exception:
        pass

    return _post_resp(await load_post_with_media(db, post_id=post.id, tenant_id=tenant.id) or post)


@router.post("/posts/{post_id}/regenerate/stream")
async def regenerate_post_stream(
    post_id: uuid.UUID,
    request: Request,
    auth: CurrentAuth,
    db: DbSession,
    payload: RegeneratePostRequest | None = None,
):
    """Stream caption typing events while regenerating a day, then emit the saved post."""
    import json as json_lib

    enforce_rate_limit(
        request,
        scope=f"regen:{auth.user.id}",
        limit=30,
        window_seconds=3600,
    )
    tenant = auth.require_tenant()
    auth.require_roles(MembershipRole.owner, MembershipRole.admin, MembershipRole.member)

    post = await load_post_with_media(db, post_id=post_id, tenant_id=tenant.id)
    if not post:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Post not found")

    profile = await db.scalar(
        select(BusinessProfile).where(
            BusinessProfile.tenant_id == tenant.id,
            BusinessProfile.deleted_at.is_(None),
        )
    )
    if not profile or not profile.memory_initialized:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Complete onboarding before regenerating posts",
        )

    scheduled = post.scheduled_date.date() if hasattr(post.scheduled_date, "date") else post.scheduled_date
    if not isinstance(scheduled, date_cls):
        scheduled = date_cls.fromisoformat(str(scheduled)[:10])

    brief = GenerationBrief.from_payload(payload.brief if payload else None)
    variation = (len(post.caption or "") + post.day_index + 3) % 11 + 1

    async def event_gen():
        try:
            async for event in stream_regenerate_day_content(
                profile,
                day_index=post.day_index,
                scheduled=scheduled,
                current_platform=post.platform,
                current_theme=post.theme,
                variation=variation,
                db=db,
                brief=brief,
            ):
                if await request.is_disconnected():
                    break
                if event["type"] == "result":
                    rewritten = event["data"]
                    post.platform = brief.platform_override or post.platform or rewritten["platform"]
                    post.theme = rewritten["theme"]
                    post.caption = rewritten["caption"]
                    post.hashtags = rewritten["hashtags"]
                    post.cta = rewritten["cta"]
                    post.graphic_prompt = rewritten["graphic_prompt"]
                    post.status = ContentStatus.draft

                    usage = rewritten.get("usage")
                    meta = _usage_meta(
                        action="post_regenerate_stream",
                        brief=brief,
                        plan_or_post=rewritten,
                        extra={
                            "post_id": str(post.id),
                            "campaign_id": str(post.campaign_id),
                            "day_index": post.day_index,
                        },
                    )
                    db.add(
                        LlmUsageEvent(
                            tenant_id=tenant.id,
                            user_id=auth.user.id,
                            feature="marketing.post_regenerate",
                            provider=(usage or {}).get("provider", "peju_local"),
                            model=(usage or {}).get(
                                "model", str(rewritten.get("provider") or "template-v1")
                            ),
                            prompt_tokens=int((usage or {}).get("prompt_tokens") or 0),
                            completion_tokens=int((usage or {}).get("completion_tokens") or 0),
                            total_tokens=int((usage or {}).get("total_tokens") or 0),
                            metadata_json=meta,
                        )
                    )
                    await db.flush()
                    fresh = await load_post_with_media(db, post_id=post.id, tenant_id=tenant.id)
                    assert fresh is not None
                    body = _post_resp(fresh).model_dump(mode="json")
                    yield f"data: {json_lib.dumps({'type': 'done', 'post': body})}\n\n"
                else:
                    yield f"data: {json_lib.dumps(event)}\n\n"
        except Exception as exc:
            yield f"data: {json_lib.dumps({'type': 'error', 'message': str(exc)})}\n\n"

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post(
    "/posts/{post_id}/suggest-graphic-direction",
    response_model=SuggestGraphicDirectionResponse,
)
async def suggest_graphic_direction_endpoint(
    post_id: uuid.UUID,
    auth: CurrentAuth,
    db: DbSession,
    request: Request,
    payload: SuggestGraphicDirectionRequest | None = None,
):
    """AI suggests optional on-image text and/or an image prompt from the post + user notes."""
    from app.ai.media_plan import suggest_graphic_direction

    body = payload or SuggestGraphicDirectionRequest()
    enforce_rate_limit(request, scope=f"graphic-suggest:{auth.user.id}", limit=60, window_seconds=3600)
    tenant = auth.require_tenant()
    auth.require_permission("graphics.generate")

    post = await load_post_with_media(db, post_id=post_id, tenant_id=tenant.id)
    if not post:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Post not found")

    profile = await db.scalar(
        select(BusinessProfile).where(
            BusinessProfile.tenant_id == tenant.id,
            BusinessProfile.deleted_at.is_(None),
        )
    )
    business = profile.business_name if profile else tenant.name

    result = await suggest_graphic_direction(
        theme=post.theme,
        caption=post.caption,
        cta=post.cta,
        platform=post.platform,
        graphic_prompt=post.graphic_prompt,
        business_name=business,
        notes=body.notes,
        mode=body.mode,
        db=db,
    )

    usage = result.get("usage")
    if usage:
        db.add(
            LlmUsageEvent(
                tenant_id=tenant.id,
                user_id=auth.user.id,
                feature="marketing.suggest_graphic_direction",
                provider=(usage or {}).get("provider", "peju_local"),
                model=(usage or {}).get("model", "unknown"),
                prompt_tokens=int((usage or {}).get("prompt_tokens") or 0),
                completion_tokens=int((usage or {}).get("completion_tokens") or 0),
                total_tokens=int((usage or {}).get("total_tokens") or 0),
                metadata_json={
                    "post_id": str(post.id),
                    "mode": body.mode,
                    "source": result.get("source"),
                },
            )
        )
        await db.flush()

    return SuggestGraphicDirectionResponse(
        on_image_text=result.get("on_image_text"),
        image_prompt=result.get("image_prompt"),
        source=str(result.get("source") or "heuristic"),
    )


@router.post("/posts/{post_id}/generate-graphics", response_model=ContentPostResponse)
async def generate_post_graphics(
    post_id: uuid.UUID,
    auth: CurrentAuth,
    db: DbSession,
    request: Request,
    payload: GenerateGraphicsRequest | None = None,
):
    """AI decides 1–5 graphics; Neural Fabric writes copy, image AI paints scene, we compose both."""
    from app.ai.image_gen import ImageGenError, generate_with_failover, load_active_image_providers
    from app.ai.media_plan import plan_post_graphics
    from app.services.cloudinary_service import CloudinaryError, upload_image_bytes
    from app.services.graphic_compose import compose_marketing_graphic, visual_only_prompt
    from app.services.graphic_service import (
        TEMPLATE_BY_ID,
        build_post_graphic_svg,
        resolve_template_id,
    )

    body = payload or GenerateGraphicsRequest()
    enforce_rate_limit(request, scope=f"graphic:{auth.user.id}", limit=40, window_seconds=3600)
    tenant = auth.require_tenant()
    auth.require_permission("graphics.generate")

    post = await load_post_with_media(db, post_id=post_id, tenant_id=tenant.id)
    if not post:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Post not found")

    profile = await db.scalar(
        select(BusinessProfile).where(
            BusinessProfile.tenant_id == tenant.id,
            BusinessProfile.deleted_at.is_(None),
        )
    )
    business = profile.business_name if profile else tenant.name

    # Resolve optional image to embed in SVG templates that support it
    image_url = body.image_url
    if body.media_asset_id:
        asset_row = await db.scalar(
            select(MediaAsset).where(
                MediaAsset.id == body.media_asset_id,
                MediaAsset.tenant_id == tenant.id,
                MediaAsset.deleted_at.is_(None),
            )
        )
        if not asset_row:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Media asset not found")
        image_url = asset_row.url
    elif body.use_logo and profile and profile.logo_url:
        image_url = profile.logo_url

    template_pool: list[str] = []
    if body.template_ids:
        template_pool = [resolve_template_id(t) for t in body.template_ids if t]
    elif body.template_id:
        template_pool = [resolve_template_id(body.template_id)]
    if not template_pool:
        template_pool = [
            "forest_gradient",
            "bold_split",
            "marketplace",
            "story_frame",
            "poster_stack",
        ]

    image_providers = await load_active_image_providers(db)
    use_ai = body.engine == "ai" or (body.engine == "auto" and bool(image_providers))
    if body.engine == "ai" and not image_providers:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="No active image AI providers. Add Cloudflare or Google AI Studio in Super Admin.",
        )

    # When user picks an explicit slide count, that count wins; also replace by default
    # so all newly generated slides become the post's selected media.
    preferred = body.count or (len(template_pool) if body.template_ids else None)
    replace = body.replace if body.count is None else True
    if body.replace:
        replace = True

    plan = await plan_post_graphics(
        theme=post.theme,
        caption=post.caption,
        cta=post.cta,
        platform=post.platform,
        graphic_prompt=post.graphic_prompt,
        business_name=business,
        preferred_count=preferred,
        user_overlay_text=body.on_image_text,
        user_image_direction=body.image_prompt or body.style_hint,
        db=db,
    )

    if replace:
        # Clear via relationship so delete-orphan removes old links cleanly
        # without leaving an empty collection that orphans newly attached rows.
        post.media_links.clear()
        post.graphic_url = None
        await db.flush()

    created_ids: list[str] = []
    for idx, slide in enumerate(plan.get("slides") or []):
        role = str(slide.get("role") or "cover")
        tid = template_pool[idx % len(template_pool)]
        tpl = TEMPLATE_BY_ID.get(tid) or {}
        embed = image_url if tpl.get("supports_image") else None

        engine_used = "template"
        provider_meta: dict = {"template_id": tid}
        filename = f"day-{post.day_index}-{tid}-{idx + 1}.svg"
        mime = "image/svg+xml"
        data: bytes

        headline = str(slide.get("title") or post.theme or business)[:48]
        subline = str(slide.get("subline") or slide.get("focus") or "")[:120]
        slide_cta = slide.get("cta") or post.cta

        if use_ai:
            prompt = visual_only_prompt(
                business_name=business,
                theme=post.theme,
                visual_focus=str(slide.get("focus") or post.caption or post.theme),
                platform=post.platform,
                role=role,
                style_hint=body.image_prompt
                or body.style_hint
                or (post.graphic_prompt or None),
            )
            try:
                generated = await generate_with_failover(db, prompt=prompt)
                # Neural Fabric copy (from plan) + image model background
                data = compose_marketing_graphic(
                    background=generated["bytes"],
                    business_name=business,
                    headline=headline,
                    subline=subline,
                    cta=slide_cta,
                    role=role,
                )
                mime = "image/png"
                filename = f"day-{post.day_index}-{role}-{idx + 1}.png"
                engine_used = "hybrid"
                provider_meta = {
                    "image_provider": generated.get("provider"),
                    "image_model": generated.get("model"),
                    "provider_name": generated.get("provider_name"),
                    "agent_attempts": generated.get("agent_attempts"),
                    "cost_tier": generated.get("cost_tier"),
                    "copy_source": plan.get("source"),
                    "headline": headline,
                    "subline": subline,
                    "cta_text": slide_cta,
                    "prompt_excerpt": prompt[:500],
                }
            except ImageGenError as exc:
                if body.engine == "ai":
                    raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
                data = build_post_graphic_svg(
                    business_name=business,
                    theme=post.theme,
                    caption=post.caption,
                    cta=slide_cta,
                    platform=post.platform,
                    role=role,
                    title_override=headline,
                    focus_override=subline,
                    template_id=tid,
                    image_url=embed,
                )
                provider_meta["fallback_reason"] = str(exc)[:300]
        else:
            data = build_post_graphic_svg(
                business_name=business,
                theme=post.theme,
                caption=post.caption,
                cta=slide_cta,
                platform=post.platform,
                role=role,
                title_override=headline,
                focus_override=subline,
                template_id=tid,
                image_url=embed,
            )

        try:
            uploaded = await upload_image_bytes(
                db,
                data=data,
                filename=filename,
                folder=f"tenants/{tenant.id}/graphics",
            )
        except CloudinaryError as exc:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

        asset = await create_media_asset(
            db,
            tenant_id=tenant.id,
            url=uploaded["url"],
            source=MediaSource.ai_generated,
            public_id=uploaded.get("public_id"),
            filename=filename,
            title=headline[:255],
            mime_type=mime,
            width=uploaded.get("width") or 1080,
            height=uploaded.get("height") or 1080,
            bytes_count=uploaded.get("bytes") or len(data),
            role=role,
            origin_post_id=post.id,
            meta_json={
                "plan_reason": plan.get("reason"),
                "plan_source": plan.get("source"),
                "focus": slide.get("focus"),
                "engine": engine_used,
                "slide_index": idx,
                "image_embedded": bool(embed) and engine_used == "template",
                **provider_meta,
            },
        )
        await attach_asset_to_post(
            db,
            tenant_id=tenant.id,
            post=post,
            asset=asset,
            role=role,
            sort_order=idx,
        )
        created_ids.append(str(asset.id))

        try:
            from app.services.image_usage import record_image_usage

            plan_usage = plan.get("usage") or {}
            await record_image_usage(
                db,
                tenant_id=tenant.id,
                user_id=auth.user.id,
                post_id=post.id,
                media_asset_id=asset.id,
                engine=engine_used,
                image_provider=provider_meta.get("image_provider"),
                image_model=provider_meta.get("image_model"),
                llm_provider=plan_usage.get("provider") if engine_used != "template" else None,
                llm_model=plan_usage.get("model") if engine_used != "template" else None,
                prompt_tokens=int(plan_usage.get("prompt_tokens") or 0) if idx == 0 else 0,
                completion_tokens=int(plan_usage.get("completion_tokens") or 0) if idx == 0 else 0,
                metadata={
                    "slide_index": idx,
                    "agent_attempts": provider_meta.get("agent_attempts"),
                    "headline": headline,
                },
            )
        except Exception:
            pass

    usage = plan.get("usage")
    if usage:
        db.add(
            LlmUsageEvent(
                tenant_id=tenant.id,
                user_id=auth.user.id,
                feature="marketing.media_plan",
                provider=usage.get("provider", "openai"),
                model=usage.get("model", "unknown"),
                prompt_tokens=int(usage.get("prompt_tokens") or 0),
                completion_tokens=int(usage.get("completion_tokens") or 0),
                total_tokens=int(usage.get("total_tokens") or 0),
                metadata_json={
                    "action": "media_plan",
                    "post_id": str(post.id),
                    "count": plan.get("count"),
                    "reason": plan.get("reason"),
                },
            )
        )
        await db.flush()

    await sync_post_primary_url(db, post)
    # Expire so selectinload reloads every attached slide (avoid stale identity map)
    await db.refresh(post, attribute_names=["media_links"])
    post = await load_post_with_media(db, post_id=post.id, tenant_id=tenant.id)
    assert post is not None

    try:
        get_turso().insert_activity(
            event_id=str(uuid.uuid4()),
            tenant_id=str(tenant.id),
            actor_user_id=str(auth.user.id),
            event_type="marketing.graphics_generated",
            title=f"Generated {len(created_ids)} graphic(s) for day {post.day_index}",
            metadata={
                "post_id": str(post.id),
                "media_ids": created_ids,
                "reason": plan.get("reason"),
                "source": plan.get("source"),
            },
            created_at=datetime.now(timezone.utc).isoformat(),
        )
    except Exception:
        pass

    return _post_resp(post)


@router.post("/posts/{post_id}/generate-graphic", response_model=ContentPostResponse)
async def generate_post_graphic(
    post_id: uuid.UUID,
    auth: CurrentAuth,
    db: DbSession,
    request: Request,
):
    """Legacy single-graphic shortcut — AI plans and generates (usually 1+) into the library."""
    return await generate_post_graphics(
        post_id=post_id,
        auth=auth,
        db=db,
        request=request,
        payload=GenerateGraphicsRequest(count=None, replace=False),
    )


@router.post("/posts/{post_id}/media", response_model=ContentPostResponse)
async def attach_post_media(
    post_id: uuid.UUID,
    payload: AttachMediaRequest,
    auth: CurrentAuth,
    db: DbSession,
):
    """Attach existing library assets to a post (upload or AI — reuse from Media Manager)."""
    tenant = auth.require_tenant()
    auth.require_roles(MembershipRole.owner, MembershipRole.admin, MembershipRole.member)

    post = await load_post_with_media(db, post_id=post_id, tenant_id=tenant.id)
    if not post:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Post not found")

    assets = (
        await db.scalars(
            select(MediaAsset).where(
                MediaAsset.tenant_id == tenant.id,
                MediaAsset.deleted_at.is_(None),
                MediaAsset.id.in_(payload.media_ids),
            )
        )
    ).all()
    found = {a.id: a for a in assets}
    missing = [str(mid) for mid in payload.media_ids if mid not in found]
    if missing:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"Media not found: {', '.join(missing)}")

    for mid in payload.media_ids:
        await attach_asset_to_post(
            db,
            tenant_id=tenant.id,
            post=post,
            asset=found[mid],
        )

    await sync_post_primary_url(db, post)
    post = await load_post_with_media(db, post_id=post.id, tenant_id=tenant.id)
    assert post is not None
    return _post_resp(post)


@router.delete("/posts/{post_id}/media/{media_id}", response_model=ContentPostResponse)
async def detach_post_media(
    post_id: uuid.UUID,
    media_id: uuid.UUID,
    auth: CurrentAuth,
    db: DbSession,
):
    tenant = auth.require_tenant()
    auth.require_roles(MembershipRole.owner, MembershipRole.admin, MembershipRole.member)

    post = await load_post_with_media(db, post_id=post_id, tenant_id=tenant.id)
    if not post:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Post not found")

    link = await db.scalar(
        select(ContentPostMedia).where(
            ContentPostMedia.post_id == post.id,
            ContentPostMedia.media_asset_id == media_id,
            ContentPostMedia.tenant_id == tenant.id,
        )
    )
    if not link:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Attachment not found")

    # Remove via relationship so delete-orphan + in-memory collection stay aligned
    if link in (post.media_links or []):
        post.media_links.remove(link)
    else:
        await db.delete(link)
    await db.flush()
    await sync_post_primary_url(db, post)
    await db.refresh(post, attribute_names=["media_links"])
    post = await load_post_with_media(db, post_id=post.id, tenant_id=tenant.id)
    assert post is not None
    return _post_resp(post)
