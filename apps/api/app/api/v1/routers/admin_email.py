"""Super Admin Email Fabric — Resend + Brevo."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select

from app.core.deps import DbSession, PlatformAdmin
from app.core.secrets import decrypt_secret, encrypt_secret, mask_secret
from app.models import AuditLog
from app.models.entities import EmailProviderConfig, EmailProviderKind
from app.services.email_service import EmailRuntime, test_email_provider

router = APIRouter(prefix="/admin/email", tags=["admin-email"])


class EmailProviderCreate(BaseModel):
    kind: EmailProviderKind
    name: str = Field(min_length=2, max_length=120)
    api_key: str = Field(min_length=8)
    from_email: EmailStr
    from_name: str = Field(default="PejuAfrica", min_length=1, max_length=120)
    reply_to: EmailStr | None = None
    is_active: bool = True
    priority: int = Field(default=100, ge=1, le=1000)


class EmailProviderUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    api_key: str | None = Field(default=None, min_length=8)
    from_email: EmailStr | None = None
    from_name: str | None = Field(default=None, min_length=1, max_length=120)
    reply_to: EmailStr | None = None
    is_active: bool | None = None
    priority: int | None = Field(default=None, ge=1, le=1000)


class EmailProviderOut(BaseModel):
    id: uuid.UUID
    kind: str
    name: str
    api_key_masked: str
    from_email: str
    from_name: str
    reply_to: str | None
    is_active: bool
    priority: int
    last_ok_at: datetime | None
    last_error: str | None


class EmailTestBody(BaseModel):
    to: EmailStr


def _to_out(row: EmailProviderConfig) -> EmailProviderOut:
    try:
        masked = mask_secret(decrypt_secret(row.api_key_encrypted))
    except Exception:
        masked = "•••••••• (re-enter key)"
    return EmailProviderOut(
        id=row.id,
        kind=row.kind.value if hasattr(row.kind, "value") else str(row.kind),
        name=row.name,
        api_key_masked=masked,
        from_email=row.from_email,
        from_name=row.from_name,
        reply_to=row.reply_to,
        is_active=row.is_active,
        priority=row.priority,
        last_ok_at=row.last_ok_at,
        last_error=row.last_error,
    )


def _runtime(row: EmailProviderConfig) -> EmailRuntime:
    kind = row.kind.value if hasattr(row.kind, "value") else str(row.kind)
    return EmailRuntime(
        id=str(row.id),
        kind=kind,
        name=row.name,
        api_key=decrypt_secret(row.api_key_encrypted),
        from_email=row.from_email,
        from_name=row.from_name,
        reply_to=row.reply_to,
        config=row,
    )


@router.get("/catalog")
async def email_catalog(_auth: PlatformAdmin):
    return [
        {
            "kind": "resend",
            "label": "Resend",
            "hint": "resend.com → API Keys. Use a verified from domain.",
            "fields": ["api_key", "from_email", "from_name", "reply_to"],
        },
        {
            "kind": "brevo",
            "label": "Brevo (Sendinblue)",
            "hint": "app.brevo.com → SMTP & API → API keys. Verify sender first.",
            "fields": ["api_key", "from_email", "from_name", "reply_to"],
        },
    ]


@router.get("/providers", response_model=list[EmailProviderOut])
async def list_providers(_auth: PlatformAdmin, db: DbSession):
    rows = await db.scalars(
        select(EmailProviderConfig)
        .where(EmailProviderConfig.deleted_at.is_(None))
        .order_by(EmailProviderConfig.priority.asc(), EmailProviderConfig.created_at.asc())
    )
    return [_to_out(r) for r in rows]


@router.post("/providers", response_model=EmailProviderOut, status_code=201)
async def create_provider(payload: EmailProviderCreate, auth: PlatformAdmin, db: DbSession):
    row = EmailProviderConfig(
        kind=payload.kind,
        name=payload.name,
        api_key_encrypted=encrypt_secret(payload.api_key.strip()),
        from_email=str(payload.from_email).lower(),
        from_name=payload.from_name.strip(),
        reply_to=str(payload.reply_to).lower() if payload.reply_to else None,
        is_active=payload.is_active,
        priority=payload.priority,
    )
    db.add(row)
    await db.flush()
    await db.refresh(row)
    db.add(
        AuditLog(
            actor_user_id=auth.user.id,
            action="admin.email_provider_create",
            resource_type="email_provider",
            resource_id=str(row.id),
            metadata_json={"kind": payload.kind.value},
        )
    )
    return _to_out(row)


@router.patch("/providers/{provider_id}", response_model=EmailProviderOut)
async def update_provider(
    provider_id: uuid.UUID,
    payload: EmailProviderUpdate,
    auth: PlatformAdmin,
    db: DbSession,
):
    row = await db.scalar(
        select(EmailProviderConfig).where(
            EmailProviderConfig.id == provider_id,
            EmailProviderConfig.deleted_at.is_(None),
        )
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Provider not found")
    if payload.name is not None:
        row.name = payload.name
    if payload.api_key is not None:
        row.api_key_encrypted = encrypt_secret(payload.api_key.strip())
    if payload.from_email is not None:
        row.from_email = str(payload.from_email).lower()
    if payload.from_name is not None:
        row.from_name = payload.from_name.strip()
    if payload.reply_to is not None:
        row.reply_to = str(payload.reply_to).lower()
    if payload.is_active is not None:
        row.is_active = payload.is_active
    if payload.priority is not None:
        row.priority = payload.priority
    await db.flush()
    await db.refresh(row)
    db.add(
        AuditLog(
            actor_user_id=auth.user.id,
            action="admin.email_provider_update",
            resource_type="email_provider",
            resource_id=str(row.id),
        )
    )
    return _to_out(row)


@router.delete("/providers/{provider_id}", status_code=204)
async def delete_provider(provider_id: uuid.UUID, auth: PlatformAdmin, db: DbSession):
    row = await db.scalar(
        select(EmailProviderConfig).where(
            EmailProviderConfig.id == provider_id,
            EmailProviderConfig.deleted_at.is_(None),
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
            action="admin.email_provider_delete",
            resource_type="email_provider",
            resource_id=str(row.id),
        )
    )


@router.post("/providers/{provider_id}/test")
async def test_provider(
    provider_id: uuid.UUID,
    payload: EmailTestBody,
    auth: PlatformAdmin,
    db: DbSession,
):
    row = await db.scalar(
        select(EmailProviderConfig).where(
            EmailProviderConfig.id == provider_id,
            EmailProviderConfig.deleted_at.is_(None),
        )
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Provider not found")
    try:
        result = await test_email_provider(_runtime(row), to=str(payload.to))
        row.last_ok_at = datetime.now(timezone.utc)
        row.last_error = None
        await db.flush()
        return {"ok": True, **{k: v for k, v in result.items() if k != "raw"}}
    except Exception as exc:
        row.last_error = str(exc)[:2000]
        await db.flush()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
