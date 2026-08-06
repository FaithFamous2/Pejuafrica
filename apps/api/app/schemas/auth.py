"""Pydantic request/response schemas."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=10, max_length=128)
    full_name: str = Field(min_length=2, max_length=255)
    business_name: str = Field(min_length=2, max_length=255)
    industry: str | None = Field(default=None, max_length=120)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str
    tenant_id: UUID | None = None


class MessageResponse(BaseModel):
    message: str


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    email: EmailStr
    code: str = Field(min_length=4, max_length=12)
    new_password: str = Field(min_length=10, max_length=128)


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=10, max_length=128)


class VerifyEmailRequest(BaseModel):
    token: str = Field(min_length=8)


class UserResponse(BaseModel):
    id: UUID
    email: EmailStr
    full_name: str
    is_email_verified: bool
    is_platform_admin: bool

    model_config = {"from_attributes": True}


class TenantResponse(BaseModel):
    id: UUID
    name: str
    slug: str
    status: str
    industry: str | None
    country: str
    timezone: str

    model_config = {"from_attributes": True}


class MembershipResponse(BaseModel):
    tenant: TenantResponse
    role: str
    is_default: bool


class AuthMeResponse(BaseModel):
    user: UserResponse
    memberships: list[MembershipResponse]
    active_tenant: TenantResponse | None = None
    active_role: str | None = None


class BusinessProfileUpsert(BaseModel):
    business_name: str = Field(min_length=2, max_length=255)
    industry: str | None = None
    brand_voice: str | None = None
    target_audience: str | None = None
    competitors: list[str] | None = None
    socials: dict | None = None
    goals: str | None = None
    logo_url: str | None = None
    initialize_memory: bool = False


class BusinessProfileResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    business_name: str
    industry: str | None
    brand_voice: str | None
    target_audience: str | None
    competitors: list | None
    socials: dict | None
    goals: str | None
    logo_url: str | None = None
    onboarding_completed: bool
    memory_initialized: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ActivityEventResponse(BaseModel):
    id: str
    event_type: str
    title: str
    metadata: dict
    created_at: str


class TenantAdminResponse(BaseModel):
    id: UUID
    name: str
    slug: str
    status: str
    industry: str | None
    trial_ends_at: datetime | None = None
    created_at: datetime

    model_config = {"from_attributes": True}
