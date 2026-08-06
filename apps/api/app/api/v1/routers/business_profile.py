"""Business profile routes (tenant-scoped) + logo upload + AI memory."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, File, HTTPException, UploadFile, status
from sqlalchemy import select

from app.ai.onboarding_assist import assist_onboarding_step
from app.core.deps import CurrentAuth, DbSession
from app.db.turso import get_turso
from app.models import BusinessProfile, LlmUsageEvent, MembershipRole, Tenant
from app.schemas.auth import BusinessProfileResponse, BusinessProfileUpsert
from pydantic import BaseModel, Field

router = APIRouter(prefix="/business-profile", tags=["business-profile"])

ALLOWED_LOGO_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}
MAX_LOGO_BYTES = 2 * 1024 * 1024


class OnboardingAssistRequest(BaseModel):
    step: str = Field(pattern="^(basics|voice|audience|presence|init)$")
    business_name: str | None = None
    industry: str | None = None
    brand_voice: str | None = None
    target_audience: str | None = None
    competitors: str | None = None
    socials: str | None = None
    goals: str | None = None


def _memory_document(profile: BusinessProfile) -> str:
    competitors = ", ".join(profile.competitors or [])
    socials = ", ".join(f"{k}={v}" for k, v in (profile.socials or {}).items())
    return "\n".join(
        [
            f"Business: {profile.business_name}",
            f"Industry: {profile.industry or ''}",
            f"Brand voice: {profile.brand_voice or ''}",
            f"Target audience: {profile.target_audience or ''}",
            f"Competitors: {competitors}",
            f"Socials: {socials}",
            f"Goals: {profile.goals or ''}",
        ]
    ).strip()


@router.get("", response_model=BusinessProfileResponse)
async def get_profile(auth: CurrentAuth, db: DbSession):
    tenant = auth.require_tenant()
    profile = await db.scalar(
        select(BusinessProfile).where(
            BusinessProfile.tenant_id == tenant.id,
            BusinessProfile.deleted_at.is_(None),
        )
    )
    if not profile:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Business profile not found")
    return BusinessProfileResponse.model_validate(profile)


@router.put("", response_model=BusinessProfileResponse)
async def upsert_profile(payload: BusinessProfileUpsert, auth: CurrentAuth, db: DbSession):
    tenant = auth.require_tenant()
    auth.require_roles(MembershipRole.owner, MembershipRole.admin, MembershipRole.member)

    profile = await db.scalar(
        select(BusinessProfile).where(
            BusinessProfile.tenant_id == tenant.id,
            BusinessProfile.deleted_at.is_(None),
        )
    )
    if not profile:
        profile = BusinessProfile(tenant_id=tenant.id, business_name=payload.business_name)
        db.add(profile)

    profile.business_name = payload.business_name
    profile.industry = payload.industry
    profile.brand_voice = payload.brand_voice
    profile.target_audience = payload.target_audience
    profile.competitors = payload.competitors
    profile.socials = payload.socials
    profile.goals = payload.goals
    if payload.logo_url is not None:
        profile.logo_url = payload.logo_url or None
    profile.onboarding_completed = bool(
        payload.brand_voice and payload.target_audience and payload.industry
    )

    # Keep tenant display name/industry in sync for admin + shell
    tenant_row = await db.scalar(select(Tenant).where(Tenant.id == tenant.id))
    if tenant_row:
        tenant_row.name = payload.business_name
        if payload.industry is not None:
            tenant_row.industry = payload.industry

    if payload.initialize_memory:
        profile.memory_initialized = True
        try:
            get_turso().insert_activity(
                event_id=str(uuid.uuid4()),
                tenant_id=str(tenant.id),
                actor_user_id=str(auth.user.id),
                event_type="ai.memory_initialized",
                title="AI business memory initialized",
                metadata={"chars": len(_memory_document(profile))},
                created_at=datetime.now(timezone.utc).isoformat(),
            )
        except Exception:
            pass

    await db.flush()
    await db.refresh(profile)

    try:
        get_turso().insert_activity(
            event_id=str(uuid.uuid4()),
            tenant_id=str(tenant.id),
            actor_user_id=str(auth.user.id),
            event_type="business_profile.updated",
            title="Business profile updated",
            metadata={"onboarding_completed": profile.onboarding_completed},
            created_at=datetime.now(timezone.utc).isoformat(),
        )
    except Exception:
        pass
    return BusinessProfileResponse.model_validate(profile)


@router.post("/assist-step")
async def assist_step(payload: OnboardingAssistRequest, auth: CurrentAuth, db: DbSession):
    """AI/template help for each onboarding step — safe for clueless users."""
    tenant = auth.require_tenant()
    auth.require_roles(MembershipRole.owner, MembershipRole.admin, MembershipRole.member)
    result = await assist_onboarding_step(
        payload.step,
        {
            "business_name": payload.business_name,
            "industry": payload.industry,
            "brand_voice": payload.brand_voice,
            "target_audience": payload.target_audience,
            "competitors": payload.competitors,
            "socials": payload.socials,
            "goals": payload.goals,
        },
        db=db,
    )
    usage = result.get("usage")
    if usage:
        db.add(
            LlmUsageEvent(
                tenant_id=tenant.id,
                user_id=auth.user.id,
                feature="onboarding.assist_step",
                provider=usage.get("provider", "openai"),
                model=usage.get("model", "unknown"),
                prompt_tokens=int(usage.get("prompt_tokens") or 0),
                completion_tokens=int(usage.get("completion_tokens") or 0),
                total_tokens=int(usage.get("total_tokens") or 0),
                metadata_json={
                    "action": "onboarding_assist",
                    "step": payload.step,
                    "response_excerpt": str(result.get("helper_text") or "")[:800],
                },
            )
        )
        await db.flush()
    return {
        "step": payload.step,
        "suggestions": result.get("suggestions") or {},
        "helper_text": result.get("helper_text"),
        "source": result.get("source"),
    }


@router.post("/logo", response_model=BusinessProfileResponse)
async def upload_logo(
    auth: CurrentAuth,
    db: DbSession,
    file: UploadFile = File(...),
):
    """Upload a business logo to Cloudinary (JPEG/PNG/WebP/GIF, max 2MB)."""
    from app.services.cloudinary_service import CloudinaryError, upload_image_bytes

    tenant = auth.require_tenant()
    auth.require_roles(MembershipRole.owner, MembershipRole.admin, MembershipRole.member)

    content_type = (file.content_type or "").lower()
    if content_type not in ALLOWED_LOGO_TYPES:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Logo must be JPEG, PNG, WebP, or GIF",
        )

    data = await file.read()
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Empty file")
    if len(data) > MAX_LOGO_BYTES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Logo must be under 2MB")

    profile = await db.scalar(
        select(BusinessProfile).where(
            BusinessProfile.tenant_id == tenant.id,
            BusinessProfile.deleted_at.is_(None),
        )
    )
    if not profile:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Business profile not found")

    ext = ALLOWED_LOGO_TYPES[content_type]
    filename = f"logo{ext}"
    try:
        uploaded = await upload_image_bytes(
            db,
            data=data,
            filename=filename,
            folder=f"tenants/{tenant.id}/logos",
        )
    except CloudinaryError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    logo_url = uploaded["url"]
    profile.logo_url = logo_url
    await db.flush()
    await db.refresh(profile)

    try:
        get_turso().insert_activity(
            event_id=str(uuid.uuid4()),
            tenant_id=str(tenant.id),
            actor_user_id=str(auth.user.id),
            event_type="business_profile.logo_uploaded",
            title="Business logo updated",
            metadata={
                "logo_url": logo_url,
                "public_id": uploaded.get("public_id"),
                "storage": "cloudinary",
            },
            created_at=datetime.now(timezone.utc).isoformat(),
        )
    except Exception:
        pass

    return BusinessProfileResponse.model_validate(profile)
