"""ORM models for identity, tenancy, and business profile foundations."""

from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, SoftDeleteMixin, TenantScopedMixin, TimestampMixin, new_uuid


class TenantStatus(str, enum.Enum):
    trial = "trial"
    active = "active"
    suspended = "suspended"
    cancelled = "cancelled"


class MembershipRole(str, enum.Enum):
    owner = "owner"
    admin = "admin"
    editor = "editor"
    generator = "generator"
    member = "member"  # legacy ≈ editor
    viewer = "viewer"


class Tenant(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "tenants"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=new_uuid)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    status: Mapped[TenantStatus] = mapped_column(
        Enum(TenantStatus, name="tenant_status"),
        default=TenantStatus.trial,
        nullable=False,
    )
    trial_ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    industry: Mapped[str | None] = mapped_column(String(120), nullable=True)
    country: Mapped[str] = mapped_column(String(2), default="NG", nullable=False)
    timezone: Mapped[str] = mapped_column(String(64), default="Africa/Lagos", nullable=False)

    memberships: Mapped[list[Membership]] = relationship(back_populates="tenant")
    business_profile: Mapped[BusinessProfile | None] = relationship(
        back_populates="tenant",
        uselist=False,
    )


class User(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=new_uuid)
    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    is_email_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_platform_admin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    failed_login_attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    memberships: Mapped[list[Membership]] = relationship(back_populates="user")
    sessions: Mapped[list[AuthSession]] = relationship(back_populates="user")


class Membership(Base, TimestampMixin):
    __tablename__ = "memberships"
    __table_args__ = (
        UniqueConstraint("tenant_id", "user_id", name="uq_membership_tenant_user"),
        Index("ix_memberships_user_id", "user_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=new_uuid)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    role: Mapped[MembershipRole] = mapped_column(
        Enum(MembershipRole, name="membership_role"),
        default=MembershipRole.member,
        nullable=False,
    )
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # Optional overrides on top of role defaults
    permissions_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    tenant: Mapped[Tenant] = relationship(back_populates="memberships")
    user: Mapped[User] = relationship(back_populates="memberships")


class AuthSession(Base, TimestampMixin):
    __tablename__ = "auth_sessions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=new_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    refresh_token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    user_agent: Mapped[str | None] = mapped_column(String(512), nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    replaced_by_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True)

    user: Mapped[User] = relationship(back_populates="sessions")


class EmailVerificationToken(Base, TimestampMixin):
    __tablename__ = "email_verification_tokens"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=new_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class PasswordResetToken(Base, TimestampMixin):
    __tablename__ = "password_reset_tokens"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=new_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class BusinessProfile(Base, TimestampMixin, SoftDeleteMixin, TenantScopedMixin):
    __tablename__ = "business_profiles"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=new_uuid)
    business_name: Mapped[str] = mapped_column(String(255), nullable=False)
    industry: Mapped[str | None] = mapped_column(String(120), nullable=True)
    brand_voice: Mapped[str | None] = mapped_column(Text, nullable=True)
    target_audience: Mapped[str | None] = mapped_column(Text, nullable=True)
    competitors: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    socials: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    goals: Mapped[str | None] = mapped_column(Text, nullable=True)
    logo_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    onboarding_completed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    memory_initialized: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    tenant: Mapped[Tenant] = relationship(back_populates="business_profile")


class CampaignStatus(str, enum.Enum):
    generating = "generating"
    ready = "ready"
    archived = "archived"


class ContentStatus(str, enum.Enum):
    draft = "draft"
    approved = "approved"
    published = "published"
    rejected = "rejected"


class Campaign(Base, TimestampMixin, SoftDeleteMixin, TenantScopedMixin):
    __tablename__ = "campaigns"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=new_uuid)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    month: Mapped[int] = mapped_column(Integer, nullable=False)
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[CampaignStatus] = mapped_column(
        Enum(CampaignStatus, name="campaign_status"),
        default=CampaignStatus.ready,
        nullable=False,
    )
    strategy_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    pillars: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    objectives: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    generation_provider: Mapped[str | None] = mapped_column(String(40), nullable=True)
    generation_model: Mapped[str | None] = mapped_column(String(120), nullable=True)

    posts: Mapped[list[ContentPost]] = relationship(back_populates="campaign")


class ContentPost(Base, TimestampMixin, SoftDeleteMixin, TenantScopedMixin):
    __tablename__ = "content_posts"
    __table_args__ = (
        Index("ix_content_posts_tenant_date", "tenant_id", "scheduled_date"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=new_uuid)
    campaign_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("campaigns.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    scheduled_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    day_index: Mapped[int] = mapped_column(Integer, nullable=False)
    platform: Mapped[str] = mapped_column(String(40), default="instagram", nullable=False)
    theme: Mapped[str] = mapped_column(String(120), nullable=False)
    caption: Mapped[str] = mapped_column(Text, nullable=False)
    hashtags: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    cta: Mapped[str | None] = mapped_column(String(255), nullable=True)
    graphic_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    graphic_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    status: Mapped[ContentStatus] = mapped_column(
        Enum(ContentStatus, name="content_status"),
        default=ContentStatus.draft,
        nullable=False,
    )

    campaign: Mapped[Campaign] = relationship(back_populates="posts")
    media_links: Mapped[list[ContentPostMedia]] = relationship(
        back_populates="post",
        cascade="all, delete-orphan",
        order_by="ContentPostMedia.sort_order",
    )


class MediaSource(str, enum.Enum):
    upload = "upload"
    ai_generated = "ai_generated"


class MediaAsset(Base, TimestampMixin, SoftDeleteMixin, TenantScopedMixin):
    """Brand media library — uploads and AI-generated assets, reusable across posts."""

    __tablename__ = "media_assets"
    __table_args__ = (Index("ix_media_assets_tenant_created", "tenant_id", "created_at"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=new_uuid)
    url: Mapped[str] = mapped_column(String(1024), nullable=False)
    public_id: Mapped[str | None] = mapped_column(String(512), nullable=True)
    filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    mime_type: Mapped[str | None] = mapped_column(String(80), nullable=True)
    source: Mapped[MediaSource] = mapped_column(
        Enum(MediaSource, name="media_source"),
        default=MediaSource.upload,
        nullable=False,
    )
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    role: Mapped[str | None] = mapped_column(String(60), nullable=True)  # cover, quote, cta…
    origin_post_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("content_posts.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    meta_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    post_links: Mapped[list[ContentPostMedia]] = relationship(back_populates="asset")


class ContentPostMedia(Base, TimestampMixin):
    """Join table: which library assets are attached to a content post (1–N)."""

    __tablename__ = "content_post_media"
    __table_args__ = (
        Index("ix_content_post_media_post", "post_id", "sort_order"),
        Index("uq_content_post_media", "post_id", "media_asset_id", unique=True),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=new_uuid)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    post_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("content_posts.id", ondelete="CASCADE"),
        nullable=False,
    )
    media_asset_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("media_assets.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    role: Mapped[str | None] = mapped_column(String(60), nullable=True)

    post: Mapped[ContentPost] = relationship(back_populates="media_links")
    asset: Mapped[MediaAsset] = relationship(back_populates="post_links")


class PlanTier(str, enum.Enum):
    trial = "trial"
    starter = "starter"
    growth = "growth"
    scale = "scale"


class SubscriptionStatus(str, enum.Enum):
    trialing = "trialing"
    active = "active"
    past_due = "past_due"
    cancelled = "cancelled"
    expired = "expired"


class PaymentProvider(str, enum.Enum):
    none = "none"
    paystack = "paystack"
    flutterwave = "flutterwave"
    manual = "manual"


class Subscription(Base, TimestampMixin, SoftDeleteMixin, TenantScopedMixin):
    __tablename__ = "subscriptions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=new_uuid)
    plan: Mapped[PlanTier] = mapped_column(
        Enum(PlanTier, name="plan_tier"),
        default=PlanTier.trial,
        nullable=False,
    )
    status: Mapped[SubscriptionStatus] = mapped_column(
        Enum(SubscriptionStatus, name="subscription_status"),
        default=SubscriptionStatus.trialing,
        nullable=False,
    )
    provider: Mapped[PaymentProvider] = mapped_column(
        Enum(PaymentProvider, name="payment_provider"),
        default=PaymentProvider.none,
        nullable=False,
    )
    currency: Mapped[str] = mapped_column(String(3), default="NGN", nullable=False)
    amount_kobo: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    trial_ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    current_period_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    provider_customer_code: Mapped[str | None] = mapped_column(String(120), nullable=True)
    provider_subscription_code: Mapped[str | None] = mapped_column(String(120), nullable=True)


class BillingEvent(Base, TimestampMixin, TenantScopedMixin):
    __tablename__ = "billing_events"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=new_uuid)
    # Stored as varchar to avoid Postgres enum drift across create_all iterations.
    provider: Mapped[str] = mapped_column(String(40), default=PaymentProvider.none.value, nullable=False)
    event_type: Mapped[str] = mapped_column(String(80), nullable=False)
    amount_kobo: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default="NGN", nullable=False)
    reference: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    payload: Mapped[dict | None] = mapped_column(JSONB, nullable=True)


class LlmUsageEvent(Base, TimestampMixin, TenantScopedMixin):
    __tablename__ = "llm_usage_events"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=new_uuid)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    feature: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    provider: Mapped[str] = mapped_column(String(40), default="peju_local", nullable=False)
    model: Mapped[str] = mapped_column(String(80), default="template-v1", nullable=False)
    prompt_tokens: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    completion_tokens: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    total_tokens: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    metadata_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)


class PromptTemplate(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "prompt_templates"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=new_uuid)
    key: Mapped[str] = mapped_column(String(120), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )


class LlmProviderKind(str, enum.Enum):
    openai = "openai"
    groq = "groq"
    gemini = "gemini"
    custom = "custom"


class LlmProviderConfig(Base, TimestampMixin, SoftDeleteMixin):
    """Platform-managed LLM providers (keys controlled from Super Admin)."""

    __tablename__ = "llm_provider_configs"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=new_uuid)
    kind: Mapped[LlmProviderKind] = mapped_column(
        Enum(LlmProviderKind, name="llm_provider_kind"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    model: Mapped[str] = mapped_column(String(120), nullable=False)
    base_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    api_key_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)
    priority: Mapped[int] = mapped_column(Integer, default=100, nullable=False)
    last_ok_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)


class CloudinaryConfig(Base, TimestampMixin):
    """Singleton-ish Cloudinary credentials controlled from Super Admin."""

    __tablename__ = "cloudinary_configs"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=new_uuid)
    cloud_name: Mapped[str] = mapped_column(String(120), nullable=False)
    api_key_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    api_secret_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    folder_prefix: Mapped[str] = mapped_column(String(120), default="pejuafrica", nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class ImageGenProviderKind(str, enum.Enum):
    cloudflare = "cloudflare"
    google_studio = "google_studio"


class ImageGenProviderConfig(Base, TimestampMixin, SoftDeleteMixin):
    """Platform-managed text-to-image providers (Cloudflare Workers AI, Google AI Studio)."""

    __tablename__ = "image_gen_provider_configs"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=new_uuid)
    kind: Mapped[ImageGenProviderKind] = mapped_column(
        Enum(ImageGenProviderKind, name="image_gen_provider_kind"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    model: Mapped[str] = mapped_column(String(180), nullable=False)
    # Cloudflare account id (required for Workers AI REST)
    account_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    api_key_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)
    priority: Mapped[int] = mapped_column(Integer, default=100, nullable=False)
    last_ok_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)


class AuditLog(Base, TimestampMixin):
    __tablename__ = "audit_logs"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=new_uuid)
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("tenants.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    action: Mapped[str] = mapped_column(String(120), nullable=False)
    resource_type: Mapped[str | None] = mapped_column(String(80), nullable=True)
    resource_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    metadata_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)


class EmailProviderKind(str, enum.Enum):
    resend = "resend"
    brevo = "brevo"


class EmailProviderConfig(Base, TimestampMixin, SoftDeleteMixin):
    """Platform email providers (Resend, Brevo) — Super Admin Email Fabric."""

    __tablename__ = "email_provider_configs"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=new_uuid)
    kind: Mapped[EmailProviderKind] = mapped_column(
        Enum(EmailProviderKind, name="email_provider_kind"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    api_key_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    from_email: Mapped[str] = mapped_column(String(320), nullable=False)
    from_name: Mapped[str] = mapped_column(String(120), default="PejuAfrica", nullable=False)
    reply_to: Mapped[str | None] = mapped_column(String(320), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)
    priority: Mapped[int] = mapped_column(Integer, default=100, nullable=False)
    last_ok_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)


class TenantInvite(Base, TimestampMixin):
    """Org invite — email + token link with role/permissions."""

    __tablename__ = "tenant_invites"
    __table_args__ = (
        Index("ix_tenant_invites_token", "token_hash"),
        Index("ix_tenant_invites_tenant_email", "tenant_id", "email"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=new_uuid)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    email: Mapped[str] = mapped_column(String(320), nullable=False)
    role: Mapped[MembershipRole] = mapped_column(
        Enum(MembershipRole, name="membership_role", create_constraint=False),
        default=MembershipRole.viewer,
        nullable=False,
    )
    permissions_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    invited_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    full_name_hint: Mapped[str | None] = mapped_column(String(255), nullable=True)


class ImageUsageEvent(Base, TimestampMixin):
    """Track image/hybrid graphic generations for admin cost + attribution."""

    __tablename__ = "image_usage_events"
    __table_args__ = (Index("ix_image_usage_tenant_created", "tenant_id", "created_at"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=new_uuid)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    post_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True)
    media_asset_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True)
    feature: Mapped[str] = mapped_column(String(80), default="marketing.graphics", nullable=False)
    engine: Mapped[str] = mapped_column(String(40), default="hybrid", nullable=False)
    image_provider: Mapped[str | None] = mapped_column(String(40), nullable=True)
    image_model: Mapped[str | None] = mapped_column(String(180), nullable=True)
    llm_provider: Mapped[str | None] = mapped_column(String(40), nullable=True)
    llm_model: Mapped[str | None] = mapped_column(String(120), nullable=True)
    prompt_tokens: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    completion_tokens: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    estimated_cost_usd: Mapped[str] = mapped_column(String(24), default="0", nullable=False)
    metadata_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)


class ImageCostRate(Base, TimestampMixin):
    """Super Admin rate card for estimated image generation cost."""

    __tablename__ = "image_cost_rates"
    __table_args__ = (UniqueConstraint("provider", "model", name="uq_image_cost_provider_model"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=new_uuid)
    provider: Mapped[str] = mapped_column(String(40), nullable=False)
    model: Mapped[str] = mapped_column(String(180), nullable=False)
    # USD per successful image (estimate)
    usd_per_image: Mapped[str] = mapped_column(String(24), default="0.003", nullable=False)
    notes: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
