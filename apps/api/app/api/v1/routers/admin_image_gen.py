"""Admin image generation provider management (Cloudflare Workers AI + Google AI Studio)."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.ai.image_gen import (
    DEFAULT_MODELS,
    IMAGE_MODEL_CATALOG,
    ImageGenError,
    ImageGenRuntime,
    test_image_provider,
)
from app.core.deps import DbSession, PlatformAdmin
from app.core.secrets import decrypt_secret, encrypt_secret, mask_secret
from app.models import AuditLog
from app.models.entities import ImageGenProviderConfig, ImageGenProviderKind

router = APIRouter(prefix="/admin/image-gen", tags=["admin-image-gen"])


class ImageProviderCreate(BaseModel):
    kind: ImageGenProviderKind
    name: str = Field(min_length=2, max_length=120)
    model: str | None = None
    account_id: str | None = Field(default=None, max_length=120)
    api_key: str = Field(min_length=8)
    is_active: bool = True
    priority: int = Field(default=100, ge=1, le=1000)


class ImageProviderUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    model: str | None = None
    account_id: str | None = Field(default=None, max_length=120)
    api_key: str | None = Field(default=None, min_length=8)
    is_active: bool | None = None
    priority: int | None = Field(default=None, ge=1, le=1000)


class ImageProviderOut(BaseModel):
    id: uuid.UUID
    kind: str
    name: str
    model: str
    account_id: str | None
    api_key_masked: str
    is_active: bool
    priority: int
    last_ok_at: datetime | None
    last_error: str | None

    model_config = {"from_attributes": True}


class CatalogItem(BaseModel):
    kind: str
    label: str
    needs_account_id: bool
    models: list[dict]


def _to_out(row: ImageGenProviderConfig) -> ImageProviderOut:
    try:
        masked = mask_secret(decrypt_secret(row.api_key_encrypted))
    except Exception:
        masked = "•••••••• (re-enter key)"
    return ImageProviderOut(
        id=row.id,
        kind=row.kind.value if hasattr(row.kind, "value") else str(row.kind),
        name=row.name,
        model=row.model,
        account_id=row.account_id,
        api_key_masked=masked,
        is_active=row.is_active,
        priority=row.priority,
        last_ok_at=row.last_ok_at,
        last_error=row.last_error,
    )


def _runtime(row: ImageGenProviderConfig) -> ImageGenRuntime:
    kind = row.kind if isinstance(row.kind, ImageGenProviderKind) else ImageGenProviderKind(row.kind)
    return ImageGenRuntime(
        id=str(row.id),
        kind=kind.value,
        name=row.name,
        model=row.model,
        api_key=decrypt_secret(row.api_key_encrypted),
        account_id=row.account_id,
        config=row,
    )


@router.get("/catalog", response_model=list[CatalogItem])
async def image_provider_catalog(_auth: PlatformAdmin):
    return [
        CatalogItem(
            kind="cloudflare",
            label="Cloudflare Workers AI",
            needs_account_id=True,
            models=IMAGE_MODEL_CATALOG["cloudflare"],
        ),
        CatalogItem(
            kind="google_studio",
            label="Google AI Studio",
            needs_account_id=False,
            models=IMAGE_MODEL_CATALOG["google_studio"],
        ),
    ]


@router.get("/providers", response_model=list[ImageProviderOut])
async def list_providers(_auth: PlatformAdmin, db: DbSession):
    rows = await db.scalars(
        select(ImageGenProviderConfig)
        .where(ImageGenProviderConfig.deleted_at.is_(None))
        .order_by(ImageGenProviderConfig.priority.asc(), ImageGenProviderConfig.created_at.asc())
    )
    return [_to_out(r) for r in rows]


@router.post("/providers", response_model=ImageProviderOut, status_code=201)
async def create_provider(payload: ImageProviderCreate, auth: PlatformAdmin, db: DbSession):
    kind = payload.kind
    account_id = (payload.account_id or "").strip() or None
    if kind == ImageGenProviderKind.cloudflare:
        if not account_id:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail="Cloudflare Account ID is required",
            )
        if len(account_id) != 32:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail=f"Cloudflare Account ID must be 32 characters (got {len(account_id)}). Copy the full ID from the dashboard.",
            )
    row = ImageGenProviderConfig(
        kind=kind,
        name=payload.name,
        model=payload.model or DEFAULT_MODELS.get(kind, ""),
        account_id=account_id,
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
            action="admin.image_provider_create",
            resource_type="image_gen_provider",
            resource_id=str(row.id),
            metadata_json={"kind": kind.value, "model": row.model},
        )
    )
    return _to_out(row)


@router.patch("/providers/{provider_id}", response_model=ImageProviderOut)
async def update_provider(
    provider_id: uuid.UUID,
    payload: ImageProviderUpdate,
    auth: PlatformAdmin,
    db: DbSession,
):
    row = await db.scalar(
        select(ImageGenProviderConfig).where(
            ImageGenProviderConfig.id == provider_id,
            ImageGenProviderConfig.deleted_at.is_(None),
        )
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Provider not found")

    if payload.name is not None:
        row.name = payload.name
    if payload.model is not None:
        row.model = payload.model
    if payload.account_id is not None:
        aid = payload.account_id.strip() or None
        if row.kind == ImageGenProviderKind.cloudflare and aid and len(aid) != 32:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail=f"Cloudflare Account ID must be 32 characters (got {len(aid)}).",
            )
        row.account_id = aid
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
            action="admin.image_provider_update",
            resource_type="image_gen_provider",
            resource_id=str(row.id),
            metadata_json={"is_active": row.is_active, "model": row.model},
        )
    )
    return _to_out(row)


@router.delete("/providers/{provider_id}", status_code=204)
async def delete_provider(provider_id: uuid.UUID, auth: PlatformAdmin, db: DbSession):
    row = await db.scalar(
        select(ImageGenProviderConfig).where(
            ImageGenProviderConfig.id == provider_id,
            ImageGenProviderConfig.deleted_at.is_(None),
        )
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Provider not found")
    row.deleted_at = datetime.now(timezone.utc)
    row.is_active = False
    await db.flush()
    db.add(
        AuditLog(
            actor_user_id=auth.user.id,
            action="admin.image_provider_delete",
            resource_type="image_gen_provider",
            resource_id=str(row.id),
        )
    )


@router.post("/providers/{provider_id}/test")
async def test_provider_endpoint(provider_id: uuid.UUID, auth: PlatformAdmin, db: DbSession):
    row = await db.scalar(
        select(ImageGenProviderConfig).where(
            ImageGenProviderConfig.id == provider_id,
            ImageGenProviderConfig.deleted_at.is_(None),
        )
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Provider not found")
    try:
        result = await test_image_provider(_runtime(row))
        row.last_ok_at = datetime.now(timezone.utc)
        row.last_error = None
        await db.flush()
        db.add(
            AuditLog(
                actor_user_id=auth.user.id,
                action="admin.image_provider_test_ok",
                resource_type="image_gen_provider",
                resource_id=str(row.id),
                metadata_json={"model": row.model, "bytes": result.get("bytes")},
            )
        )
        return result
    except Exception as exc:
        row.last_error = str(exc)[:2000]
        await db.flush()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
