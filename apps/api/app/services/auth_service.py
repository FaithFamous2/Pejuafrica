"""Authentication & tenancy domain services."""

from __future__ import annotations

import re
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import get_settings
from app.core.security import (
    create_access_token,
    generate_opaque_token,
    generate_refresh_token,
    hash_password,
    hash_token,
    needs_rehash,
    verify_password,
)
from app.db.turso import get_turso
from app.models import (
    AuthSession,
    BusinessProfile,
    EmailVerificationToken,
    Membership,
    MembershipRole,
    PasswordResetToken,
    Tenant,
    TenantStatus,
    User,
)


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug[:80] or "business"


async def unique_tenant_slug(db: AsyncSession, base_name: str) -> str:
    base = slugify(base_name)
    candidate = base
    i = 1
    while True:
        existing = await db.scalar(select(Tenant.id).where(Tenant.slug == candidate))
        if not existing:
            return candidate
        i += 1
        candidate = f"{base}-{i}"


async def register_user(
    db: AsyncSession,
    *,
    email: str,
    password: str,
    full_name: str,
    business_name: str,
    industry: str | None,
) -> tuple[User, Tenant, str]:
    email_norm = email.lower().strip()
    existing = await db.scalar(select(User.id).where(User.email == email_norm))
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Email already registered")

    settings = get_settings()
    user = User(
        email=email_norm,
        password_hash=hash_password(password),
        full_name=full_name.strip(),
    )
    tenant = Tenant(
        name=business_name.strip(),
        slug=await unique_tenant_slug(db, business_name),
        status=TenantStatus.trial,
        industry=industry,
        trial_ends_at=datetime.now(timezone.utc) + timedelta(days=14),
    )
    db.add(user)
    db.add(tenant)
    await db.flush()

    membership = Membership(
        tenant_id=tenant.id,
        user_id=user.id,
        role=MembershipRole.owner,
        is_default=True,
    )
    profile = BusinessProfile(
        tenant_id=tenant.id,
        business_name=business_name.strip(),
        industry=industry,
    )
    verify_raw = generate_opaque_token()
    verify = EmailVerificationToken(
        user_id=user.id,
        token_hash=hash_token(verify_raw),
        expires_at=datetime.now(timezone.utc) + timedelta(hours=24),
    )
    db.add_all([membership, profile, verify])
    await db.flush()

    from app.models import PlanTier, PaymentProvider, Subscription, SubscriptionStatus

    db.add(
        Subscription(
            tenant_id=tenant.id,
            plan=PlanTier.trial,
            status=SubscriptionStatus.trialing,
            provider=PaymentProvider.none,
            trial_ends_at=tenant.trial_ends_at,
            current_period_end=tenant.trial_ends_at,
        )
    )
    await db.flush()

    try:
        get_turso().insert_activity(
            event_id=str(uuid.uuid4()),
            tenant_id=str(tenant.id),
            actor_user_id=str(user.id),
            event_type="tenant.created",
            title=f"Workspace created for {tenant.name}",
            metadata={"source": "register"},
            created_at=datetime.now(timezone.utc).isoformat(),
        )
    except Exception:
        # Operational store must not block registration.
        pass

    # Welcome + verify email (Email Fabric). Never block signup if mail fails.
    try:
        from app.services.email_service import send_email, welcome_verify_email_html

        verify_url = f"{settings.frontend_url.rstrip('/')}/verify-email?token={verify_raw}"
        await send_email(
            db,
            to=user.email,
            subject="Welcome to PejuAfrica — verify your email",
            html=welcome_verify_email_html(full_name=user.full_name, verify_url=verify_url),
        )
    except Exception:
        pass

    # In development we return the verify token so local testing works without email.
    if not settings.is_production:
        return user, tenant, verify_raw
    return user, tenant, ""


async def authenticate_user(
    db: AsyncSession,
    *,
    email: str,
    password: str,
) -> User:
    email_norm = email.lower().strip()
    user = await db.scalar(select(User).where(User.email == email_norm))
    if not user or user.deleted_at is not None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")

    now = datetime.now(timezone.utc)
    if user.locked_until and user.locked_until > now:
        raise HTTPException(status.HTTP_423_LOCKED, detail="Account temporarily locked")

    if not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Account disabled")

    if not verify_password(password, user.password_hash):
        user.failed_login_attempts += 1
        if user.failed_login_attempts >= 8:
            user.locked_until = now + timedelta(minutes=15)
        await db.flush()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")

    user.failed_login_attempts = 0
    user.locked_until = None
    user.last_login_at = now
    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(password)
    await db.flush()
    return user


async def create_session(
    db: AsyncSession,
    *,
    user: User,
    tenant_id: uuid.UUID | None,
    user_agent: str | None,
    ip_address: str | None,
) -> tuple[str, str, AuthSession, Membership | None]:
    membership = await resolve_membership(db, user=user, tenant_id=tenant_id)
    roles = [membership.role.value] if membership else []
    if user.is_platform_admin:
        roles = list(set(roles + ["platform_admin"]))

    raw_refresh = generate_refresh_token()
    settings = get_settings()
    session = AuthSession(
        user_id=user.id,
        refresh_token_hash=hash_token(raw_refresh),
        user_agent=user_agent,
        ip_address=ip_address,
        expires_at=datetime.now(timezone.utc)
        + timedelta(days=settings.refresh_token_expire_days),
    )
    db.add(session)
    await db.flush()

    access = create_access_token(
        user_id=user.id,
        tenant_id=membership.tenant_id if membership else None,
        roles=roles,
        session_id=session.id,
        is_platform_admin=user.is_platform_admin,
    )
    return access, raw_refresh, session, membership


async def resolve_membership(
    db: AsyncSession,
    *,
    user: User,
    tenant_id: uuid.UUID | None,
) -> Membership | None:
    stmt = (
        select(Membership)
        .options(selectinload(Membership.tenant))
        .where(Membership.user_id == user.id)
    )
    result = await db.scalars(stmt)
    memberships = list(result)
    if not memberships:
        return None
    if tenant_id:
        for m in memberships:
            if m.tenant_id == tenant_id:
                return m
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Not a member of this tenant")
    for m in memberships:
        if m.is_default:
            return m
    return memberships[0]


async def rotate_refresh_token(
    db: AsyncSession,
    *,
    raw_refresh: str,
    user_agent: str | None,
    ip_address: str | None,
) -> tuple[str, str, User, Membership | None]:
    token_h = hash_token(raw_refresh)
    session = await db.scalar(
        select(AuthSession).where(AuthSession.refresh_token_hash == token_h)
    )
    if not session:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")

    now = datetime.now(timezone.utc)
    if session.revoked_at is not None:
        # Refresh token reuse detection — revoke all sessions for this user.
        sessions = await db.scalars(
            select(AuthSession).where(
                AuthSession.user_id == session.user_id,
                AuthSession.revoked_at.is_(None),
            )
        )
        for s in sessions:
            s.revoked_at = now
        await db.flush()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Refresh token reuse detected")

    if session.expires_at < now:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Refresh token expired")

    user = await db.scalar(select(User).where(User.id == session.user_id))
    if not user or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="User inactive")

    session.revoked_at = now
    access, new_refresh, new_session, membership = await create_session(
        db,
        user=user,
        tenant_id=None,
        user_agent=user_agent,
        ip_address=ip_address,
    )
    session.replaced_by_id = new_session.id
    await db.flush()
    return access, new_refresh, user, membership


async def revoke_session(db: AsyncSession, *, raw_refresh: str | None) -> None:
    if not raw_refresh:
        return
    session = await db.scalar(
        select(AuthSession).where(AuthSession.refresh_token_hash == hash_token(raw_refresh))
    )
    if session and session.revoked_at is None:
        session.revoked_at = datetime.now(timezone.utc)
        await db.flush()


async def revoke_all_sessions(db: AsyncSession, *, user_id: uuid.UUID) -> None:
    now = datetime.now(timezone.utc)
    sessions = await db.scalars(
        select(AuthSession).where(
            AuthSession.user_id == user_id,
            AuthSession.revoked_at.is_(None),
        )
    )
    for s in sessions:
        s.revoked_at = now
    await db.flush()


async def verify_email(db: AsyncSession, *, raw_token: str) -> User:
    token = await db.scalar(
        select(EmailVerificationToken).where(
            EmailVerificationToken.token_hash == hash_token(raw_token)
        )
    )
    if not token or token.used_at is not None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Invalid verification token")
    if token.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Verification token expired")

    user = await db.scalar(select(User).where(User.id == token.user_id))
    if not user:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Invalid verification token")

    user.is_email_verified = True
    token.used_at = datetime.now(timezone.utc)
    await db.flush()
    return user


async def request_password_reset(db: AsyncSession, *, email: str) -> str:
    """Create a 6-digit reset code and email it. Returns code only in non-prod for testing."""
    import random

    user = await db.scalar(select(User).where(User.email == email.lower().strip(), User.deleted_at.is_(None)))
    # Always succeed to avoid account enumeration
    if not user:
        return ""

    code = f"{random.randint(0, 999999):06d}"
    db.add(
        PasswordResetToken(
            user_id=user.id,
            token_hash=hash_token(code),
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=15),
        )
    )
    await db.flush()

    try:
        from app.services.email_service import password_reset_code_html, send_email

        await send_email(
            db,
            to=user.email,
            subject="Your PejuAfrica password reset code",
            html=password_reset_code_html(full_name=user.full_name, code=code),
        )
    except Exception:
        pass

    if not get_settings().is_production:
        return code
    return ""


async def reset_password_with_code(
    db: AsyncSession,
    *,
    email: str,
    code: str,
    new_password: str,
) -> None:
    user = await db.scalar(
        select(User).where(User.email == email.lower().strip(), User.deleted_at.is_(None))
    )
    if not user:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Invalid email or code")

    token = await db.scalar(
        select(PasswordResetToken)
        .where(
            PasswordResetToken.user_id == user.id,
            PasswordResetToken.token_hash == hash_token(code.strip()),
            PasswordResetToken.used_at.is_(None),
        )
        .order_by(PasswordResetToken.created_at.desc())
    )
    if not token:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Invalid or expired code")
    if token.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Reset code expired")

    user.password_hash = hash_password(new_password)
    token.used_at = datetime.now(timezone.utc)
    await revoke_all_sessions(db, user_id=user.id)
    await db.flush()

    try:
        from app.services.email_service import password_changed_html, send_email

        await send_email(
            db,
            to=user.email,
            subject="Your PejuAfrica password was changed",
            html=password_changed_html(full_name=user.full_name),
        )
    except Exception:
        pass


async def reset_password(db: AsyncSession, *, raw_token: str, new_password: str) -> None:
    """Legacy opaque-token reset (kept for old links). Prefer reset_password_with_code."""
    token = await db.scalar(
        select(PasswordResetToken).where(PasswordResetToken.token_hash == hash_token(raw_token))
    )
    if not token or token.used_at is not None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Invalid reset token")
    if token.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Reset token expired")

    user = await db.scalar(select(User).where(User.id == token.user_id))
    if not user:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Invalid reset token")

    user.password_hash = hash_password(new_password)
    token.used_at = datetime.now(timezone.utc)
    await revoke_all_sessions(db, user_id=user.id)
    await db.flush()


async def change_password(
    db: AsyncSession,
    *,
    user: User,
    current_password: str,
    new_password: str,
) -> None:
    if not verify_password(current_password, user.password_hash):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect")
    if len(new_password) < 10:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="New password must be at least 10 characters")
    user.password_hash = hash_password(new_password)
    await revoke_all_sessions(db, user_id=user.id)
    await db.flush()
    try:
        from app.services.email_service import password_changed_html, send_email

        await send_email(
            db,
            to=user.email,
            subject="Your PejuAfrica password was changed",
            html=password_changed_html(full_name=user.full_name),
        )
    except Exception:
        pass


async def ensure_bootstrap_superadmin(db: AsyncSession) -> None:
    settings = get_settings()
    existing = await db.scalar(
        select(User).where(User.is_platform_admin.is_(True), User.deleted_at.is_(None))
    )
    if existing:
        return

    email = settings.bootstrap_superadmin_email.lower().strip()
    user = await db.scalar(select(User).where(User.email == email))
    if user:
        user.is_platform_admin = True
        user.is_email_verified = True
        user.is_active = True
    else:
        user = User(
            email=email,
            password_hash=hash_password(settings.bootstrap_superadmin_password),
            full_name=settings.bootstrap_superadmin_name,
            is_email_verified=True,
            is_platform_admin=True,
        )
        db.add(user)
    await db.flush()
