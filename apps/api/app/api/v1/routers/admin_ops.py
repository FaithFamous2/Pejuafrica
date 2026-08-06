"""Admin media attribution, cost rates, and unified activity."""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field
from sqlalchemy import desc, select

from app.core.deps import DbSession, PlatformAdmin
from app.db.turso import get_turso
from app.models import AuditLog, ImageCostRate, ImageUsageEvent, LlmUsageEvent, MediaAsset, Tenant, User
from app.services.image_usage import DEFAULT_RATES

router = APIRouter(prefix="/admin", tags=["admin-media-activity"])


class ImageUsageOut(BaseModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    tenant_name: str | None = None
    user_email: str | None = None
    post_id: uuid.UUID | None
    media_asset_id: uuid.UUID | None
    media_url: str | None = None
    engine: str
    image_provider: str | None
    image_model: str | None
    llm_provider: str | None
    llm_model: str | None
    prompt_tokens: int
    completion_tokens: int
    estimated_cost_usd: str
    created_at: datetime


class CostRateIn(BaseModel):
    provider: str = Field(min_length=2, max_length=40)
    model: str = Field(min_length=1, max_length=180)
    usd_per_image: str = Field(min_length=1, max_length=24)
    notes: str | None = None
    is_active: bool = True


class CostRateOut(BaseModel):
    id: uuid.UUID
    provider: str
    model: str
    usd_per_image: str
    notes: str | None
    is_active: bool


@router.get("/media-usage", response_model=list[ImageUsageOut])
async def list_media_usage(
    _auth: PlatformAdmin,
    db: DbSession,
    tenant_id: uuid.UUID | None = None,
    limit: int = Query(default=50, ge=1, le=200),
):
    q = (
        select(ImageUsageEvent, Tenant.name, User.email, MediaAsset.url)
        .outerjoin(Tenant, Tenant.id == ImageUsageEvent.tenant_id)
        .outerjoin(User, User.id == ImageUsageEvent.user_id)
        .outerjoin(MediaAsset, MediaAsset.id == ImageUsageEvent.media_asset_id)
        .order_by(desc(ImageUsageEvent.created_at))
        .limit(limit)
    )
    if tenant_id:
        q = q.where(ImageUsageEvent.tenant_id == tenant_id)
    rows = await db.execute(q)
    out: list[ImageUsageOut] = []
    for event, tenant_name, email, url in rows.all():
        out.append(
            ImageUsageOut(
                id=event.id,
                tenant_id=event.tenant_id,
                tenant_name=tenant_name,
                user_email=email,
                post_id=event.post_id,
                media_asset_id=event.media_asset_id,
                media_url=url,
                engine=event.engine,
                image_provider=event.image_provider,
                image_model=event.image_model,
                llm_provider=event.llm_provider,
                llm_model=event.llm_model,
                prompt_tokens=event.prompt_tokens,
                completion_tokens=event.completion_tokens,
                estimated_cost_usd=event.estimated_cost_usd,
                created_at=event.created_at,
            )
        )
    return out


@router.get("/media-usage/summary")
async def media_usage_summary(_auth: PlatformAdmin, db: DbSession):
    raw = await db.scalars(select(ImageUsageEvent).order_by(desc(ImageUsageEvent.created_at)).limit(2000))
    by_key: dict[tuple, dict] = {}
    total = Decimal("0")
    count = 0
    for e in raw:
        count += 1
        try:
            total += Decimal(e.estimated_cost_usd or "0")
        except Exception:
            pass
        key = (e.image_provider or "—", e.image_model or "—")
        slot = by_key.setdefault(
            key, {"provider": key[0], "model": key[1], "events": 0, "cost_usd": Decimal("0")}
        )
        slot["events"] += 1
        try:
            slot["cost_usd"] += Decimal(e.estimated_cost_usd or "0")
        except Exception:
            pass
    return {
        "total_events": count,
        "total_estimated_cost_usd": str(total.quantize(Decimal("0.000001"))),
        "by_model": [
            {
                "provider": v["provider"],
                "model": v["model"],
                "events": v["events"],
                "estimated_cost_usd": str(v["cost_usd"].quantize(Decimal("0.000001"))),
            }
            for v in sorted(by_key.values(), key=lambda x: -x["events"])
        ],
    }


@router.get("/image-cost-rates")
async def list_cost_rates(_auth: PlatformAdmin, db: DbSession):
    rows = await db.scalars(select(ImageCostRate).order_by(ImageCostRate.provider, ImageCostRate.model))
    persisted = [
        {
            "id": str(r.id),
            "provider": r.provider,
            "model": r.model,
            "usd_per_image": r.usd_per_image,
            "notes": r.notes,
            "is_active": r.is_active,
            "source": "db",
        }
        for r in rows
    ]
    defaults = [
        {
            "id": None,
            "provider": p,
            "model": m,
            "usd_per_image": usd,
            "notes": "built-in default",
            "is_active": True,
            "source": "default",
        }
        for (p, m), usd in DEFAULT_RATES.items()
    ]
    return {"rates": persisted, "defaults": defaults}


@router.put("/image-cost-rates", response_model=CostRateOut)
async def upsert_cost_rate(payload: CostRateIn, _auth: PlatformAdmin, db: DbSession):
    row = await db.scalar(
        select(ImageCostRate).where(
            ImageCostRate.provider == payload.provider.strip().lower(),
            ImageCostRate.model == payload.model.strip(),
        )
    )
    if not row:
        row = ImageCostRate(
            provider=payload.provider.strip().lower(),
            model=payload.model.strip(),
            usd_per_image=payload.usd_per_image,
            notes=payload.notes,
            is_active=payload.is_active,
        )
        db.add(row)
    else:
        row.usd_per_image = payload.usd_per_image
        row.notes = payload.notes
        row.is_active = payload.is_active
    await db.flush()
    await db.refresh(row)
    return CostRateOut(
        id=row.id,
        provider=row.provider,
        model=row.model,
        usd_per_image=row.usd_per_image,
        notes=row.notes,
        is_active=row.is_active,
    )


@router.get("/activity")
async def platform_activity(
    _auth: PlatformAdmin,
    db: DbSession,
    tenant_id: uuid.UUID | None = None,
    limit: int = Query(default=80, ge=1, le=200),
):
    """Unified feed: audit logs + LLM usage + image usage (+ optional Turso sample)."""
    items: list[dict] = []

    audit_q = select(AuditLog).order_by(desc(AuditLog.created_at)).limit(limit)
    if tenant_id:
        audit_q = audit_q.where(AuditLog.tenant_id == tenant_id)
    for a in await db.scalars(audit_q):
        items.append(
            {
                "id": str(a.id),
                "source": "audit",
                "event_type": a.action,
                "title": a.action,
                "tenant_id": str(a.tenant_id) if a.tenant_id else None,
                "actor_user_id": str(a.actor_user_id) if a.actor_user_id else None,
                "metadata": a.metadata_json,
                "created_at": a.created_at.isoformat() if a.created_at else None,
            }
        )

    llm_q = select(LlmUsageEvent).order_by(desc(LlmUsageEvent.created_at)).limit(limit)
    if tenant_id:
        llm_q = llm_q.where(LlmUsageEvent.tenant_id == tenant_id)
    for e in await db.scalars(llm_q):
        items.append(
            {
                "id": str(e.id),
                "source": "llm",
                "event_type": e.feature,
                "title": f"LLM {e.feature} · {e.provider}/{e.model}",
                "tenant_id": str(e.tenant_id),
                "actor_user_id": str(e.user_id) if e.user_id else None,
                "metadata": {
                    "tokens": e.total_tokens,
                    "provider": e.provider,
                    "model": e.model,
                },
                "created_at": e.created_at.isoformat() if e.created_at else None,
            }
        )

    img_q = select(ImageUsageEvent).order_by(desc(ImageUsageEvent.created_at)).limit(limit)
    if tenant_id:
        img_q = img_q.where(ImageUsageEvent.tenant_id == tenant_id)
    for e in await db.scalars(img_q):
        items.append(
            {
                "id": str(e.id),
                "source": "image",
                "event_type": "graphics.generated",
                "title": f"Graphic {e.engine} · {e.image_provider}/{e.image_model}",
                "tenant_id": str(e.tenant_id),
                "actor_user_id": str(e.user_id) if e.user_id else None,
                "metadata": {
                    "cost_usd": e.estimated_cost_usd,
                    "media_asset_id": str(e.media_asset_id) if e.media_asset_id else None,
                },
                "created_at": e.created_at.isoformat() if e.created_at else None,
            }
        )

    if tenant_id:
        try:
            for ev in get_turso().list_activity(str(tenant_id), limit=min(40, limit)):
                items.append(
                    {
                        "id": ev.get("event_id") or ev.get("id"),
                        "source": "turso",
                        "event_type": ev.get("event_type"),
                        "title": ev.get("title"),
                        "tenant_id": str(tenant_id),
                        "actor_user_id": ev.get("actor_user_id"),
                        "metadata": ev.get("metadata"),
                        "created_at": ev.get("created_at"),
                    }
                )
        except Exception:
            pass

    items.sort(key=lambda x: x.get("created_at") or "", reverse=True)
    return items[:limit]
