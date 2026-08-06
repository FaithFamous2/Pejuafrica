"""Tenant team — members, invites, permissions."""

from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.config import get_settings
from app.core.deps import CurrentAuth, DbSession
from app.core.security import hash_password
from app.db.turso import get_turso
from app.models import AuditLog, Membership, MembershipRole, TenantInvite, User
from app.services.email_service import EmailError, invite_email_html, send_email
from app.services.permissions import PERMISSIONS, effective_permissions, has_permission, role_permissions

router = APIRouter(prefix="/team", tags=["team"])


class MemberOut(BaseModel):
    membership_id: uuid.UUID
    user_id: uuid.UUID
    email: str
    full_name: str
    role: str
    permissions: list[str]
    permissions_overrides: dict | None
    is_default: bool
    joined_at: datetime


class InviteCreate(BaseModel):
    email: EmailStr
    role: MembershipRole = MembershipRole.viewer
    permissions: dict[str, bool] | None = None
    full_name_hint: str | None = Field(default=None, max_length=255)


class InviteOut(BaseModel):
    id: uuid.UUID
    email: str
    role: str
    permissions: dict | None
    invite_url: str | None = None
    expires_at: datetime
    accepted_at: datetime | None
    revoked_at: datetime | None
    created_at: datetime


class MemberUpdate(BaseModel):
    role: MembershipRole | None = None
    permissions: dict[str, bool] | None = None


class InvitePreview(BaseModel):
    org_name: str
    email: str
    role: str
    permissions: list[str]
    inviter_name: str | None
    expires_at: datetime
    already_member: bool
    user_exists: bool


class InviteAccept(BaseModel):
    token: str = Field(min_length=16)
    full_name: str = Field(min_length=2, max_length=255)
    password: str | None = Field(default=None, min_length=8, max_length=128)


def _invite_url(raw_token: str) -> str:
    settings = get_settings()
    base = settings.frontend_url.rstrip("/")
    return f"{base}/invite/{raw_token}"


def _hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


@router.get("/permissions-catalog")
async def permissions_catalog(_auth: CurrentAuth):
    return {
        "permissions": list(PERMISSIONS),
        "roles": {
            r.value: sorted(role_permissions(r))
            for r in MembershipRole
            if r != MembershipRole.member  # show member as legacy note
        },
        "legacy_member_note": "member behaves like editor for backward compatibility",
    }


@router.get("/members", response_model=list[MemberOut])
async def list_members(auth: CurrentAuth, db: DbSession):
    tenant = auth.require_tenant()
    if not has_permission(auth.membership, "plan.view", is_platform_admin=auth.is_platform_admin):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
    rows = await db.scalars(
        select(Membership)
        .options(selectinload(Membership.user))
        .where(Membership.tenant_id == tenant.id)
        .order_by(Membership.created_at.asc())
    )
    out: list[MemberOut] = []
    for m in rows:
        out.append(
            MemberOut(
                membership_id=m.id,
                user_id=m.user_id,
                email=m.user.email,
                full_name=m.user.full_name,
                role=m.role.value if hasattr(m.role, "value") else str(m.role),
                permissions=sorted(effective_permissions(m)),
                permissions_overrides=m.permissions_json,
                is_default=m.is_default,
                joined_at=m.created_at,
            )
        )
    return out


@router.patch("/members/{membership_id}", response_model=MemberOut)
async def update_member(
    membership_id: uuid.UUID,
    payload: MemberUpdate,
    auth: CurrentAuth,
    db: DbSession,
):
    tenant = auth.require_tenant()
    if not has_permission(auth.membership, "members.manage", is_platform_admin=auth.is_platform_admin):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Cannot manage members")
    row = await db.scalar(
        select(Membership)
        .options(selectinload(Membership.user))
        .where(Membership.id == membership_id, Membership.tenant_id == tenant.id)
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Member not found")
    if row.role == MembershipRole.owner and payload.role and payload.role != MembershipRole.owner:
        # prevent demoting last owner casually
        owners = await db.scalars(
            select(Membership).where(
                Membership.tenant_id == tenant.id,
                Membership.role == MembershipRole.owner,
            )
        )
        if len(list(owners)) <= 1:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Cannot demote the only owner")
    if payload.role is not None:
        row.role = payload.role
    if payload.permissions is not None:
        row.permissions_json = payload.permissions
    await db.flush()
    await db.refresh(row)
    return MemberOut(
        membership_id=row.id,
        user_id=row.user_id,
        email=row.user.email,
        full_name=row.user.full_name,
        role=row.role.value,
        permissions=sorted(effective_permissions(row)),
        permissions_overrides=row.permissions_json,
        is_default=row.is_default,
        joined_at=row.created_at,
    )


@router.delete("/members/{membership_id}", status_code=204)
async def remove_member(membership_id: uuid.UUID, auth: CurrentAuth, db: DbSession):
    tenant = auth.require_tenant()
    if not has_permission(auth.membership, "members.manage", is_platform_admin=auth.is_platform_admin):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Cannot manage members")
    row = await db.scalar(
        select(Membership).where(Membership.id == membership_id, Membership.tenant_id == tenant.id)
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Member not found")
    if row.user_id == auth.user.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Cannot remove yourself")
    if row.role == MembershipRole.owner:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Cannot remove an owner")
    await db.delete(row)
    await db.flush()


@router.get("/invites", response_model=list[InviteOut])
async def list_invites(auth: CurrentAuth, db: DbSession):
    tenant = auth.require_tenant()
    if not has_permission(auth.membership, "members.invite", is_platform_admin=auth.is_platform_admin):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Cannot view invites")
    rows = await db.scalars(
        select(TenantInvite)
        .where(TenantInvite.tenant_id == tenant.id)
        .order_by(TenantInvite.created_at.desc())
    )
    return [
        InviteOut(
            id=r.id,
            email=r.email,
            role=r.role.value if hasattr(r.role, "value") else str(r.role),
            permissions=r.permissions_json,
            expires_at=r.expires_at,
            accepted_at=r.accepted_at,
            revoked_at=r.revoked_at,
            created_at=r.created_at,
        )
        for r in rows
        if r.revoked_at is None
    ]


@router.post("/invites", response_model=InviteOut, status_code=201)
async def create_invite(payload: InviteCreate, auth: CurrentAuth, db: DbSession):
    tenant = auth.require_tenant()
    if not has_permission(auth.membership, "members.invite", is_platform_admin=auth.is_platform_admin):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Cannot invite members")

    email = str(payload.email).lower().strip()
    if payload.role == MembershipRole.owner:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Cannot invite as owner")

    existing_user = await db.scalar(select(User).where(User.email == email, User.deleted_at.is_(None)))
    if existing_user:
        existing_m = await db.scalar(
            select(Membership).where(
                Membership.tenant_id == tenant.id,
                Membership.user_id == existing_user.id,
            )
        )
        if existing_m:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="User is already a member")

    raw = secrets.token_urlsafe(32)
    invite = TenantInvite(
        tenant_id=tenant.id,
        email=email,
        role=payload.role,
        permissions_json=payload.permissions,
        token_hash=_hash_token(raw),
        invited_by_user_id=auth.user.id,
        expires_at=datetime.now(timezone.utc) + timedelta(days=7),
        full_name_hint=payload.full_name_hint,
    )
    db.add(invite)
    await db.flush()
    await db.refresh(invite)

    url = _invite_url(raw)
    email_sent = False
    email_error = None
    try:
        await send_email(
            db,
            to=email,
            subject=f"Join {tenant.name} on PejuAfrica",
            html=invite_email_html(
                org_name=tenant.name,
                inviter_name=auth.user.full_name,
                role=payload.role.value,
                invite_url=url,
                invitee_name=payload.full_name_hint,
            ),
        )
        email_sent = True
    except EmailError as exc:
        email_error = str(exc)

    db.add(
        AuditLog(
            tenant_id=tenant.id,
            actor_user_id=auth.user.id,
            action="team.invite_create",
            resource_type="tenant_invite",
            resource_id=str(invite.id),
            metadata_json={"email": email, "role": payload.role.value, "email_sent": email_sent},
        )
    )
    try:
        get_turso().insert_activity(
            event_id=str(uuid.uuid4()),
            tenant_id=str(tenant.id),
            actor_user_id=str(auth.user.id),
            event_type="team.invite_sent",
            title=f"Invited {email} as {payload.role.value}",
            metadata={"invite_id": str(invite.id), "email_sent": email_sent},
            created_at=datetime.now(timezone.utc).isoformat(),
        )
    except Exception:
        pass

    out = InviteOut(
        id=invite.id,
        email=invite.email,
        role=invite.role.value,
        permissions=invite.permissions_json,
        invite_url=url,  # return so UI can copy if email failed
        expires_at=invite.expires_at,
        accepted_at=None,
        revoked_at=None,
        created_at=invite.created_at,
    )
    if email_error:
        # Still return invite; client can show copy link
        out.invite_url = url
    return out


@router.delete("/invites/{invite_id}", status_code=204)
async def revoke_invite(invite_id: uuid.UUID, auth: CurrentAuth, db: DbSession):
    tenant = auth.require_tenant()
    if not has_permission(auth.membership, "members.invite", is_platform_admin=auth.is_platform_admin):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Cannot revoke invites")
    row = await db.scalar(
        select(TenantInvite).where(TenantInvite.id == invite_id, TenantInvite.tenant_id == tenant.id)
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Invite not found")
    row.revoked_at = datetime.now(timezone.utc)
    await db.flush()


@router.get("/invites/preview/{token}", response_model=InvitePreview)
async def preview_invite(token: str, db: DbSession):
    from app.models import Tenant

    row = await db.scalar(select(TenantInvite).where(TenantInvite.token_hash == _hash_token(token)))
    if not row or row.revoked_at or row.accepted_at:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Invite not found or already used")
    if row.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Invite expired")
    tenant = await db.scalar(select(Tenant).where(Tenant.id == row.tenant_id))
    inviter = None
    if row.invited_by_user_id:
        inviter = await db.scalar(select(User).where(User.id == row.invited_by_user_id))
    user = await db.scalar(select(User).where(User.email == row.email, User.deleted_at.is_(None)))
    already = False
    if user:
        m = await db.scalar(
            select(Membership).where(Membership.tenant_id == row.tenant_id, Membership.user_id == user.id)
        )
        already = bool(m)
    perms = role_permissions(row.role)
    if row.permissions_json:
        for k, v in row.permissions_json.items():
            if v:
                perms.add(k)
            else:
                perms.discard(k)
    return InvitePreview(
        org_name=tenant.name if tenant else "Workspace",
        email=row.email,
        role=row.role.value if hasattr(row.role, "value") else str(row.role),
        permissions=sorted(perms),
        inviter_name=inviter.full_name if inviter else None,
        expires_at=row.expires_at,
        already_member=already,
        user_exists=bool(user),
    )


@router.post("/invites/accept")
async def accept_invite(payload: InviteAccept, db: DbSession):
    row = await db.scalar(
        select(TenantInvite).where(TenantInvite.token_hash == _hash_token(payload.token))
    )
    if not row or row.revoked_at or row.accepted_at:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Invite not found or already used")
    if row.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Invite expired")

    user = await db.scalar(select(User).where(User.email == row.email, User.deleted_at.is_(None)))
    if user:
        existing = await db.scalar(
            select(Membership).where(
                Membership.tenant_id == row.tenant_id,
                Membership.user_id == user.id,
            )
        )
        if existing:
            row.accepted_at = datetime.now(timezone.utc)
            await db.flush()
            return {"ok": True, "tenant_id": str(row.tenant_id), "user_id": str(user.id), "new_user": False}
        # update name if provided
        if payload.full_name.strip():
            user.full_name = payload.full_name.strip()
    else:
        if not payload.password:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail="Password required to create your account",
            )
        user = User(
            email=row.email,
            password_hash=hash_password(payload.password),
            full_name=payload.full_name.strip(),
            is_email_verified=True,
        )
        db.add(user)
        await db.flush()

    membership = Membership(
        tenant_id=row.tenant_id,
        user_id=user.id,
        role=row.role,
        permissions_json=row.permissions_json,
        is_default=True,
    )
    db.add(membership)
    row.accepted_at = datetime.now(timezone.utc)
    await db.flush()

    try:
        get_turso().insert_activity(
            event_id=str(uuid.uuid4()),
            tenant_id=str(row.tenant_id),
            actor_user_id=str(user.id),
            event_type="team.invite_accepted",
            title=f"{user.full_name} joined the workspace",
            metadata={"role": row.role.value},
            created_at=datetime.now(timezone.utc).isoformat(),
        )
    except Exception:
        pass

    return {
        "ok": True,
        "tenant_id": str(row.tenant_id),
        "user_id": str(user.id),
        "new_user": True,
        "email": user.email,
    }
