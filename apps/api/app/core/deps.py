"""FastAPI dependencies: auth context + tenant isolation."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Annotated

import jwt
from fastapi import Cookie, Depends, Header, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import get_settings
from app.core.security import decode_access_token
from app.db.postgres import get_db
from app.models import Membership, MembershipRole, Tenant, TenantStatus, User


@dataclass
class AuthContext:
    user: User
    session_id: uuid.UUID
    tenant: Tenant | None
    membership: Membership | None
    roles: list[str]
    is_platform_admin: bool
    impersonator_id: uuid.UUID | None = None

    @property
    def tenant_id(self) -> uuid.UUID | None:
        return self.tenant.id if self.tenant else None

    def require_tenant(self) -> Tenant:
        if not self.tenant:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail="Active tenant required. Send X-Tenant-Id header.",
            )
        if self.tenant.status == TenantStatus.suspended and not self.is_platform_admin:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                detail="This workspace is suspended. Contact support.",
            )
        return self.tenant

    def require_roles(self, *allowed: MembershipRole) -> None:
        if self.is_platform_admin:
            return
        if not self.membership or self.membership.role not in allowed:
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")

    def require_permission(self, permission: str) -> None:
        if self.is_platform_admin:
            return
        from app.services.permissions import has_permission

        if not has_permission(self.membership, permission, is_platform_admin=False):
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")


def _extract_access_token(
    request: Request,
    authorization: str | None,
    access_cookie: str | None,
) -> str:
    settings = get_settings()
    if authorization and authorization.lower().startswith("bearer "):
        return authorization.split(" ", 1)[1].strip()
    if access_cookie:
        return access_cookie
    # Also allow cookie from request directly
    cookie_token = request.cookies.get(settings.access_cookie_name)
    if cookie_token:
        return cookie_token
    raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")


async def get_current_auth(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    authorization: Annotated[str | None, Header()] = None,
    x_tenant_id: Annotated[str | None, Header()] = None,
    peju_access: Annotated[str | None, Cookie()] = None,
) -> AuthContext:
    settings = get_settings()
    # Cookie name is dynamic; FastAPI Cookie() param must match. Fallback below.
    token = _extract_access_token(request, authorization, peju_access)
    try:
        payload = decode_access_token(token)
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Access token expired") from exc
    except jwt.InvalidTokenError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Invalid access token") from exc

    if payload.get("type") != "access":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Invalid token type")

    user_id = uuid.UUID(payload["sub"])
    session_id = uuid.UUID(payload["sid"])
    user = await db.scalar(select(User).where(User.id == user_id, User.deleted_at.is_(None)))
    if not user or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="User inactive")

    tenant: Tenant | None = None
    membership: Membership | None = None
    tenant_header = x_tenant_id or payload.get("tenant_id")
    if tenant_header:
        tenant_uuid = uuid.UUID(str(tenant_header))
        membership = await db.scalar(
            select(Membership)
            .options(selectinload(Membership.tenant))
            .where(
                Membership.user_id == user.id,
                Membership.tenant_id == tenant_uuid,
            )
        )
        if not membership and not user.is_platform_admin:
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Not a member of this tenant")
        if membership:
            tenant = membership.tenant
        elif user.is_platform_admin:
            tenant = await db.scalar(select(Tenant).where(Tenant.id == tenant_uuid))

    roles = list(payload.get("roles") or [])
    impersonator_raw = payload.get("impersonator_id")
    return AuthContext(
        user=user,
        session_id=session_id,
        tenant=tenant,
        membership=membership,
        roles=roles,
        is_platform_admin=bool(user.is_platform_admin),
        impersonator_id=uuid.UUID(str(impersonator_raw)) if impersonator_raw else None,
    )


async def require_platform_admin(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
) -> AuthContext:
    if not auth.is_platform_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Super admin required")
    return auth


CurrentAuth = Annotated[AuthContext, Depends(get_current_auth)]
PlatformAdmin = Annotated[AuthContext, Depends(require_platform_admin)]
DbSession = Annotated[AsyncSession, Depends(get_db)]
