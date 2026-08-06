"""Admin LLM provider management."""

from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from app.ai.llm import DEFAULT_BASE_URLS, DEFAULT_MODELS, ProviderRuntime, test_provider
from app.core.deps import DbSession, PlatformAdmin
from app.core.secrets import decrypt_secret, encrypt_secret, mask_secret
from app.models import (
    AuditLog,
    Campaign,
    LlmProviderConfig,
    LlmProviderKind,
    LlmUsageEvent,
    Tenant,
    User,
)

router = APIRouter(prefix="/admin/llm", tags=["admin-llm"])


class LlmProviderCreate(BaseModel):
    kind: LlmProviderKind
    name: str = Field(min_length=2, max_length=120)
    model: str | None = None
    base_url: str | None = None
    api_key: str = Field(min_length=8)
    is_active: bool = True
    priority: int = Field(default=100, ge=1, le=1000)


class LlmProviderUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    model: str | None = None
    base_url: str | None = None
    api_key: str | None = Field(default=None, min_length=8)
    is_active: bool | None = None
    priority: int | None = Field(default=None, ge=1, le=1000)


class LlmProviderOut(BaseModel):
    id: uuid.UUID
    kind: str
    name: str
    model: str
    base_url: str | None
    api_key_masked: str
    is_active: bool
    priority: int
    last_ok_at: datetime | None
    last_error: str | None

    model_config = {"from_attributes": True}


class GenerationRow(BaseModel):
    campaign_id: uuid.UUID
    title: str
    tenant_id: uuid.UUID
    tenant_name: str
    generation_provider: str | None
    generation_model: str | None
    created_at: datetime


class ProviderCatalogItem(BaseModel):
    kind: str
    label: str
    default_model: str
    default_base_url: str


def _to_out(row: LlmProviderConfig) -> LlmProviderOut:
    try:
        masked = mask_secret(decrypt_secret(row.api_key_encrypted))
    except Exception:
        masked = "•••••••• (re-enter key)"
    return LlmProviderOut(
        id=row.id,
        kind=row.kind.value if hasattr(row.kind, "value") else str(row.kind),
        name=row.name,
        model=row.model,
        base_url=row.base_url,
        api_key_masked=masked,
        is_active=row.is_active,
        priority=row.priority,
        last_ok_at=row.last_ok_at,
        last_error=row.last_error,
    )


@router.get("/catalog", response_model=list[ProviderCatalogItem])
async def provider_catalog(_auth: PlatformAdmin):
    return [
        ProviderCatalogItem(
            kind=k.value,
            label={"openai": "OpenAI", "groq": "Groq", "gemini": "Google Gemini", "custom": "Custom OpenAI-compatible"}[k.value],
            default_model=DEFAULT_MODELS.get(k, "gpt-4o-mini"),
            default_base_url=DEFAULT_BASE_URLS.get(k, DEFAULT_BASE_URLS[LlmProviderKind.openai]),
        )
        for k in LlmProviderKind
    ]


@router.get("/providers", response_model=list[LlmProviderOut])
async def list_providers(_auth: PlatformAdmin, db: DbSession):
    rows = await db.scalars(
        select(LlmProviderConfig)
        .where(LlmProviderConfig.deleted_at.is_(None))
        .order_by(LlmProviderConfig.priority.asc(), LlmProviderConfig.created_at.asc())
    )
    return [_to_out(r) for r in rows]


@router.post("/providers", response_model=LlmProviderOut, status_code=201)
async def create_provider(payload: LlmProviderCreate, auth: PlatformAdmin, db: DbSession):
    kind = payload.kind
    row = LlmProviderConfig(
        kind=kind,
        name=payload.name,
        model=payload.model or DEFAULT_MODELS.get(kind, "gpt-4o-mini"),
        base_url=payload.base_url or DEFAULT_BASE_URLS.get(kind),
        api_key_encrypted=encrypt_secret(payload.api_key.strip()),
        is_active=payload.is_active,
        priority=payload.priority,
    )
    db.add(row)
    await db.flush()
    await db.refresh(row)
    db.add(
        AuditLog(
            actor_user_id=auth.user.id,
            action="admin.llm_provider_create",
            resource_type="llm_provider",
            resource_id=str(row.id),
            metadata_json={"kind": kind.value, "model": row.model},
        )
    )
    return _to_out(row)


@router.patch("/providers/{provider_id}", response_model=LlmProviderOut)
async def update_provider(
    provider_id: uuid.UUID,
    payload: LlmProviderUpdate,
    auth: PlatformAdmin,
    db: DbSession,
):
    row = await db.scalar(
        select(LlmProviderConfig).where(
            LlmProviderConfig.id == provider_id,
            LlmProviderConfig.deleted_at.is_(None),
        )
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Provider not found")

    if payload.name is not None:
        row.name = payload.name
    if payload.model is not None:
        row.model = payload.model
    if payload.base_url is not None:
        row.base_url = payload.base_url or None
    if payload.api_key is not None:
        row.api_key_encrypted = encrypt_secret(payload.api_key.strip())
    if payload.is_active is not None:
        row.is_active = payload.is_active
    if payload.priority is not None:
        row.priority = payload.priority

    await db.flush()
    await db.refresh(row)
    db.add(
        AuditLog(
            actor_user_id=auth.user.id,
            action="admin.llm_provider_update",
            resource_type="llm_provider",
            resource_id=str(row.id),
            metadata_json={"is_active": row.is_active, "model": row.model},
        )
    )
    return _to_out(row)


@router.delete("/providers/{provider_id}", status_code=204)
async def delete_provider(provider_id: uuid.UUID, auth: PlatformAdmin, db: DbSession):
    row = await db.scalar(
        select(LlmProviderConfig).where(
            LlmProviderConfig.id == provider_id,
            LlmProviderConfig.deleted_at.is_(None),
        )
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Provider not found")
    row.soft_delete()
    row.is_active = False
    db.add(
        AuditLog(
            actor_user_id=auth.user.id,
            action="admin.llm_provider_delete",
            resource_type="llm_provider",
            resource_id=str(row.id),
        )
    )
    await db.flush()


@router.post("/providers/{provider_id}/test")
async def test_llm_provider(provider_id: uuid.UUID, auth: PlatformAdmin, db: DbSession):
    row = await db.scalar(
        select(LlmProviderConfig).where(
            LlmProviderConfig.id == provider_id,
            LlmProviderConfig.deleted_at.is_(None),
        )
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Provider not found")

    kind = row.kind if isinstance(row.kind, LlmProviderKind) else LlmProviderKind(row.kind)
    runtime = ProviderRuntime(
        id=str(row.id),
        kind=kind.value,
        name=row.name,
        model=row.model,
        base_url=(row.base_url or DEFAULT_BASE_URLS.get(kind, DEFAULT_BASE_URLS[LlmProviderKind.openai])).rstrip("/"),
        api_key=decrypt_secret(row.api_key_encrypted),
        config=row,
    )
    try:
        result = await test_provider(runtime)
        from datetime import timezone

        row.last_ok_at = datetime.now(timezone.utc)
        row.last_error = None
        await db.flush()
        return result
    except Exception as exc:
        row.last_error = str(exc)[:2000]
        await db.flush()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get("/generations", response_model=list[GenerationRow])
async def list_generations(_auth: PlatformAdmin, db: DbSession, limit: int = 50):
    rows = await db.execute(
        select(
            Campaign.id,
            Campaign.title,
            Campaign.tenant_id,
            Tenant.name,
            Campaign.generation_provider,
            Campaign.generation_model,
            Campaign.created_at,
        )
        .join(Tenant, Tenant.id == Campaign.tenant_id)
        .where(Campaign.deleted_at.is_(None))
        .order_by(Campaign.created_at.desc())
        .limit(limit)
    )
    return [
        GenerationRow(
            campaign_id=r[0],
            title=r[1],
            tenant_id=r[2],
            tenant_name=r[3],
            generation_provider=r[4],
            generation_model=r[5],
            created_at=r[6],
        )
        for r in rows.all()
    ]


@router.get("/usage-by-provider")
async def usage_by_provider(_auth: PlatformAdmin, db: DbSession):
    rows = await db.execute(
        select(
            LlmUsageEvent.provider,
            LlmUsageEvent.model,
            func.count(LlmUsageEvent.id),
            func.coalesce(func.sum(LlmUsageEvent.total_tokens), 0),
        )
        .group_by(LlmUsageEvent.provider, LlmUsageEvent.model)
        .order_by(func.coalesce(func.sum(LlmUsageEvent.total_tokens), 0).desc())
    )
    return [
        {
            "provider": r[0],
            "model": r[1],
            "events": int(r[2]),
            "total_tokens": int(r[3]),
        }
        for r in rows.all()
    ]


@router.get("/activity")
async def llm_activity(
    _auth: PlatformAdmin,
    db: DbSession,
    tenant_id: uuid.UUID | None = None,
    limit: int = 80,
):
    """Tenant AI generate/regenerate trail with brief, response excerpts, and tokens."""
    stmt = (
        select(
            LlmUsageEvent,
            Tenant.name,
            Tenant.slug,
            User.email,
            User.full_name,
        )
        .join(Tenant, Tenant.id == LlmUsageEvent.tenant_id)
        .outerjoin(User, User.id == LlmUsageEvent.user_id)
        .order_by(LlmUsageEvent.created_at.desc())
        .limit(min(limit, 200))
    )
    if tenant_id:
        stmt = stmt.where(LlmUsageEvent.tenant_id == tenant_id)
    rows = await db.execute(stmt)
    out = []
    for event, tenant_name, tenant_slug, email, full_name in rows.all():
        meta = event.metadata_json or {}
        brief = meta.get("brief") or {}
        out.append(
            {
                "id": str(event.id),
                "created_at": event.created_at,
                "tenant_id": str(event.tenant_id),
                "tenant_name": tenant_name,
                "tenant_slug": tenant_slug,
                "user_email": email,
                "user_name": full_name,
                "feature": event.feature,
                "action": meta.get("action") or event.feature,
                "provider": event.provider,
                "model": event.model,
                "prompt_tokens": event.prompt_tokens,
                "completion_tokens": event.completion_tokens,
                "total_tokens": event.total_tokens,
                "tone": brief.get("tone_label") or brief.get("tone_id"),
                "occasion": brief.get("occasion_label") or brief.get("occasion_id"),
                "focus": brief.get("focus"),
                "prompt_excerpt": meta.get("prompt_excerpt"),
                "response_excerpt": meta.get("response_excerpt") or meta.get("caption"),
                "campaign_id": meta.get("campaign_id"),
                "post_id": meta.get("post_id"),
                "day_index": meta.get("day_index"),
                "metadata": meta,
            }
        )
    return out
