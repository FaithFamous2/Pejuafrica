"""Super Admin — Cloudinary / media integrations."""

from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.core.config import get_settings
from app.core.deps import DbSession, PlatformAdmin
from app.core.secrets import decrypt_secret, encrypt_secret, mask_secret
from app.models import AuditLog, CloudinaryConfig
from app.services.cloudinary_service import CloudinaryError, load_cloudinary_runtime, upload_image_bytes

router = APIRouter(prefix="/admin/integrations", tags=["admin-integrations"])


class CloudinaryUpdate(BaseModel):
    cloud_name: str = Field(min_length=2, max_length=120)
    api_key: str | None = Field(default=None, min_length=4, max_length=120)
    api_secret: str | None = Field(default=None, min_length=8, max_length=120)
    folder_prefix: str = Field(default="pejuafrica", min_length=1, max_length=120)
    is_active: bool = True


class CloudinaryOut(BaseModel):
    id: uuid.UUID | None = None
    cloud_name: str
    api_key_masked: str
    api_secret_masked: str
    folder_prefix: str
    is_active: bool
    source: str
    configured: bool
    updated_at: datetime | None = None


async def _active_row(db: DbSession) -> CloudinaryConfig | None:
    return await db.scalar(
        select(CloudinaryConfig).order_by(CloudinaryConfig.updated_at.desc()).limit(1)
    )


@router.get("/cloudinary", response_model=CloudinaryOut)
async def get_cloudinary(_auth: PlatformAdmin, db: DbSession):
    row = await _active_row(db)
    if row:
        try:
            key = decrypt_secret(row.api_key_encrypted)
            secret = decrypt_secret(row.api_secret_encrypted)
        except Exception:
            key, secret = "", ""
        return CloudinaryOut(
            id=row.id,
            cloud_name=row.cloud_name,
            api_key_masked=mask_secret(key) if key else "••••••••",
            api_secret_masked=mask_secret(secret) if secret else "••••••••",
            folder_prefix=row.folder_prefix,
            is_active=row.is_active,
            source="db",
            configured=bool(key and secret and row.cloud_name and row.is_active),
            updated_at=row.updated_at,
        )

    settings = get_settings()
    configured = bool(
        settings.cloudinary_cloud_name
        and settings.cloudinary_api_key
        and settings.cloudinary_api_secret
    )
    return CloudinaryOut(
        id=None,
        cloud_name=settings.cloudinary_cloud_name or "",
        api_key_masked=mask_secret(settings.cloudinary_api_key) if settings.cloudinary_api_key else "not set",
        api_secret_masked=mask_secret(settings.cloudinary_api_secret)
        if settings.cloudinary_api_secret
        else "not set",
        folder_prefix=settings.cloudinary_folder_prefix or "pejuafrica",
        is_active=configured,
        source="env" if configured else "none",
        configured=configured,
        updated_at=None,
    )


@router.put("/cloudinary", response_model=CloudinaryOut)
async def upsert_cloudinary(payload: CloudinaryUpdate, auth: PlatformAdmin, db: DbSession):
    row = await _active_row(db)
    if not row:
        if not payload.api_key or not payload.api_secret:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail="API key and API secret are required for the first save",
            )
        row = CloudinaryConfig(
            cloud_name=payload.cloud_name.strip(),
            api_key_encrypted=encrypt_secret(payload.api_key.strip()),
            api_secret_encrypted=encrypt_secret(payload.api_secret.strip()),
            folder_prefix=payload.folder_prefix.strip() or "pejuafrica",
            is_active=payload.is_active,
        )
        db.add(row)
    else:
        row.cloud_name = payload.cloud_name.strip()
        row.folder_prefix = payload.folder_prefix.strip() or "pejuafrica"
        row.is_active = payload.is_active
        if payload.api_key and payload.api_key.strip() and "•" not in payload.api_key:
            row.api_key_encrypted = encrypt_secret(payload.api_key.strip())
        if payload.api_secret and payload.api_secret.strip() and "•" not in payload.api_secret:
            row.api_secret_encrypted = encrypt_secret(payload.api_secret.strip())

    await db.flush()
    await db.refresh(row)
    db.add(
        AuditLog(
            actor_user_id=auth.user.id,
            action="admin.cloudinary_upsert",
            resource_type="cloudinary_config",
            resource_id=str(row.id),
            metadata_json={"cloud_name": row.cloud_name, "is_active": row.is_active},
        )
    )
    await db.flush()

    key = decrypt_secret(row.api_key_encrypted)
    secret = decrypt_secret(row.api_secret_encrypted)
    return CloudinaryOut(
        id=row.id,
        cloud_name=row.cloud_name,
        api_key_masked=mask_secret(key),
        api_secret_masked=mask_secret(secret),
        folder_prefix=row.folder_prefix,
        is_active=row.is_active,
        source="db",
        configured=bool(row.is_active),
        updated_at=row.updated_at,
    )


@router.post("/cloudinary/test")
async def test_cloudinary(_auth: PlatformAdmin, db: DbSession):
    """Upload a tiny 1x1 PNG to verify credentials."""
    runtime = await load_cloudinary_runtime(db)
    if not runtime:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Cloudinary is not configured")

    # Minimal valid PNG
    png = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
        b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00"
        b"\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    try:
        result = await upload_image_bytes(
            db,
            data=png,
            filename="peju-cloudinary-test.png",
            folder="system/healthchecks",
        )
    except CloudinaryError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    return {"ok": True, "url": result["url"], "source": result["source"]}
