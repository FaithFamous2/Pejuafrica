"""Auth routes: register, login, refresh, logout, verify, password reset, me."""

from __future__ import annotations

from fastapi import APIRouter, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.config import get_settings
from app.core.cookies import clear_auth_cookies, set_auth_cookies
from app.core.deps import CurrentAuth, DbSession
from app.core.rate_limit import enforce_rate_limit
from app.models import Membership
from app.schemas.auth import (
    AuthMeResponse,
    ChangePasswordRequest,
    ForgotPasswordRequest,
    LoginRequest,
    MembershipResponse,
    MessageResponse,
    RegisterRequest,
    ResetPasswordRequest,
    TenantResponse,
    UserResponse,
    VerifyEmailRequest,
)
from app.services import auth_service

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=dict)
async def register(payload: RegisterRequest, response: Response, db: DbSession, request: Request):
    settings = get_settings()
    enforce_rate_limit(
        request,
        scope="auth.register",
        limit=settings.rate_limit_auth_per_minute,
        window_seconds=60,
    )
    user, tenant, verify_token = await auth_service.register_user(
        db,
        email=payload.email,
        password=payload.password,
        full_name=payload.full_name,
        business_name=payload.business_name,
        industry=payload.industry,
    )
    access, refresh, _, _ = await auth_service.create_session(
        db,
        user=user,
        tenant_id=tenant.id,
        user_agent=request.headers.get("user-agent"),
        ip_address=request.client.host if request.client else None,
    )
    set_auth_cookies(response, access_token=access, refresh_token=refresh)
    body = {
        "user": UserResponse.model_validate(user),
        "tenant": TenantResponse.model_validate(tenant),
        "message": "Registered successfully. Check email to verify your account.",
    }
    if verify_token:
        body["dev_email_verification_token"] = verify_token
    return body


@router.post("/login", response_model=dict)
async def login(payload: LoginRequest, response: Response, db: DbSession, request: Request):
    settings = get_settings()
    enforce_rate_limit(
        request,
        scope="auth.login",
        limit=settings.rate_limit_auth_per_minute,
        window_seconds=60,
    )
    user = await auth_service.authenticate_user(db, email=payload.email, password=payload.password)
    access, refresh, _, membership = await auth_service.create_session(
        db,
        user=user,
        tenant_id=payload.tenant_id,
        user_agent=request.headers.get("user-agent"),
        ip_address=request.client.host if request.client else None,
    )
    set_auth_cookies(response, access_token=access, refresh_token=refresh)
    return {
        "user": UserResponse.model_validate(user),
        "tenant": TenantResponse.model_validate(membership.tenant) if membership else None,
        "role": membership.role.value if membership else None,
    }


@router.post("/refresh", response_model=MessageResponse)
async def refresh(request: Request, response: Response, db: DbSession):
    settings = get_settings()
    raw = request.cookies.get(settings.refresh_cookie_name)
    if not raw:
        from fastapi import HTTPException, status

        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Missing refresh token")

    access, refresh_token, _, _ = await auth_service.rotate_refresh_token(
        db,
        raw_refresh=raw,
        user_agent=request.headers.get("user-agent"),
        ip_address=request.client.host if request.client else None,
    )
    set_auth_cookies(response, access_token=access, refresh_token=refresh_token)
    return MessageResponse(message="Token refreshed")


@router.post("/logout", response_model=MessageResponse)
async def logout(request: Request, response: Response, db: DbSession):
    settings = get_settings()
    raw = request.cookies.get(settings.refresh_cookie_name)
    await auth_service.revoke_session(db, raw_refresh=raw)
    clear_auth_cookies(response)
    return MessageResponse(message="Logged out")


@router.post("/logout-all", response_model=MessageResponse)
async def logout_all(auth: CurrentAuth, response: Response, db: DbSession):
    await auth_service.revoke_all_sessions(db, user_id=auth.user.id)
    clear_auth_cookies(response)
    return MessageResponse(message="Logged out of all devices")


@router.post("/verify-email", response_model=MessageResponse)
async def verify_email(payload: VerifyEmailRequest, db: DbSession):
    await auth_service.verify_email(db, raw_token=payload.token)
    return MessageResponse(message="Email verified")


@router.post("/forgot-password", response_model=dict)
async def forgot_password(payload: ForgotPasswordRequest, db: DbSession, request: Request):
    settings = get_settings()
    enforce_rate_limit(
        request,
        scope="auth.forgot",
        limit=settings.rate_limit_auth_per_minute,
        window_seconds=60,
    )
    code = await auth_service.request_password_reset(db, email=str(payload.email))
    body: dict = {
        "message": "If that email exists, a 6-digit reset code was sent.",
    }
    if code:
        body["dev_reset_code"] = code
    return body


@router.post("/reset-password", response_model=MessageResponse)
async def reset_password(payload: ResetPasswordRequest, db: DbSession, request: Request):
    settings = get_settings()
    enforce_rate_limit(
        request,
        scope="auth.reset",
        limit=settings.rate_limit_auth_per_minute,
        window_seconds=60,
    )
    await auth_service.reset_password_with_code(
        db,
        email=str(payload.email),
        code=payload.code,
        new_password=payload.new_password,
    )
    return MessageResponse(message="Password updated. You can log in with your new password.")


@router.post("/change-password", response_model=MessageResponse)
async def change_password(payload: ChangePasswordRequest, auth: CurrentAuth, db: DbSession):
    await auth_service.change_password(
        db,
        user=auth.user,
        current_password=payload.current_password,
        new_password=payload.new_password,
    )
    return MessageResponse(message="Password changed. Please log in again.")


@router.get("/me", response_model=AuthMeResponse)
async def me(auth: CurrentAuth, db: DbSession):
    result = await db.scalars(
        select(Membership)
        .options(selectinload(Membership.tenant))
        .where(Membership.user_id == auth.user.id)
    )
    memberships = list(result)
    return AuthMeResponse(
        user=UserResponse.model_validate(auth.user),
        memberships=[
            MembershipResponse(
                tenant=TenantResponse.model_validate(m.tenant),
                role=m.role.value,
                is_default=m.is_default,
            )
            for m in memberships
        ],
        active_tenant=TenantResponse.model_validate(auth.tenant) if auth.tenant else None,
        active_role=auth.membership.role.value if auth.membership else None,
    )
