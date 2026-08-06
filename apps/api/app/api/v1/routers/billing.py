"""Billing & subscription APIs (Phase 4 foundations)."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.core.config import get_settings
from app.core.deps import CurrentAuth, DbSession
from app.db.turso import get_turso
from app.models import (
    BillingEvent,
    MembershipRole,
    PaymentProvider,
    PlanTier,
    Subscription,
    SubscriptionStatus,
    Tenant,
    TenantStatus,
)

router = APIRouter(prefix="/billing", tags=["billing"])

PLAN_PRICES_KOBO = {
    PlanTier.starter: 1500000,  # ₦15,000
    PlanTier.growth: 3500000,  # ₦35,000
    PlanTier.scale: 7500000,  # ₦75,000
}


class SubscriptionResponse(BaseModel):
    id: uuid.UUID
    plan: str
    status: str
    provider: str
    currency: str
    amount_kobo: int
    trial_ends_at: datetime | None
    current_period_end: datetime | None
    days_remaining: int | None = None

    model_config = {"from_attributes": True}


class CheckoutRequest(BaseModel):
    plan: PlanTier = PlanTier.starter
    provider: PaymentProvider = Field(default=PaymentProvider.paystack)


class CheckoutResponse(BaseModel):
    message: str
    provider: str
    plan: str
    amount_kobo: int
    currency: str
    reference: str
    checkout_url: str | None = None
    status: str


def _days_remaining(sub: Subscription) -> int | None:
    end = sub.trial_ends_at if sub.status == SubscriptionStatus.trialing else sub.current_period_end
    if not end:
        return None
    delta = end - datetime.now(timezone.utc)
    return max(0, delta.days)


def _to_response(sub: Subscription) -> SubscriptionResponse:
    data = SubscriptionResponse.model_validate(sub)
    data.days_remaining = _days_remaining(sub)
    return data


async def ensure_subscription(db: DbSession, tenant: Tenant) -> Subscription:
    sub = await db.scalar(
        select(Subscription).where(
            Subscription.tenant_id == tenant.id,
            Subscription.deleted_at.is_(None),
        )
    )
    if sub:
        return sub
    trial_end = tenant.trial_ends_at or (datetime.now(timezone.utc) + timedelta(days=14))
    sub = Subscription(
        tenant_id=tenant.id,
        plan=PlanTier.trial,
        status=SubscriptionStatus.trialing,
        provider=PaymentProvider.none,
        trial_ends_at=trial_end,
        current_period_end=trial_end,
    )
    db.add(sub)
    await db.flush()
    return sub


@router.get("/subscription", response_model=SubscriptionResponse)
async def get_subscription(auth: CurrentAuth, db: DbSession):
    tenant = auth.require_tenant()
    sub = await ensure_subscription(db, tenant)
    await db.refresh(sub)
    return _to_response(sub)


@router.get("/plans")
async def list_plans():
    return {
        "currency": "NGN",
        "plans": [
            {
                "id": "starter",
                "name": "Starter",
                "amount_kobo": PLAN_PRICES_KOBO[PlanTier.starter],
                "amount_naira": PLAN_PRICES_KOBO[PlanTier.starter] // 100,
                "features": ["1 workspace", "30-day AI plans", "Content approval"],
            },
            {
                "id": "growth",
                "name": "Growth",
                "amount_kobo": PLAN_PRICES_KOBO[PlanTier.growth],
                "amount_naira": PLAN_PRICES_KOBO[PlanTier.growth] // 100,
                "features": ["Everything in Starter", "Team seats", "Priority generation"],
            },
            {
                "id": "scale",
                "name": "Scale",
                "amount_kobo": PLAN_PRICES_KOBO[PlanTier.scale],
                "amount_naira": PLAN_PRICES_KOBO[PlanTier.scale] // 100,
                "features": ["Everything in Growth", "Multi-brand", "Priority support"],
            },
        ],
    }


@router.post("/checkout", response_model=CheckoutResponse)
async def start_checkout(payload: CheckoutRequest, auth: CurrentAuth, db: DbSession):
    tenant = auth.require_tenant()
    auth.require_roles(MembershipRole.owner, MembershipRole.admin)

    if payload.plan == PlanTier.trial:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Choose a paid plan")
    if payload.provider not in (PaymentProvider.paystack, PaymentProvider.flutterwave):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Unsupported provider")

    sub = await ensure_subscription(db, tenant)
    amount = PLAN_PRICES_KOBO[payload.plan]
    reference = f"peju_{payload.provider.value}_{uuid.uuid4().hex[:16]}"
    settings = get_settings()

    event = BillingEvent(
        tenant_id=tenant.id,
        provider=payload.provider.value,
        event_type="checkout.initialized",
        amount_kobo=amount,
        currency="NGN",
        reference=reference,
        payload={
            "plan": payload.plan.value,
            "email": auth.user.email,
            "tenant_id": str(tenant.id),
        },
    )
    db.add(event)

    # Phase 4 stub: record intent. Live Paystack/Flutterwave keys wire in next.
    sub.provider = payload.provider
    await db.flush()

    try:
        get_turso().insert_activity(
            event_id=str(uuid.uuid4()),
            tenant_id=str(tenant.id),
            actor_user_id=str(auth.user.id),
            event_type="billing.checkout_started",
            title=f"Checkout started via {payload.provider.value}",
            metadata={"plan": payload.plan.value, "reference": reference},
            created_at=datetime.now(timezone.utc).isoformat(),
        )
    except Exception:
        pass

    # Mock hosted checkout URL for UI flow until keys are configured
    checkout_url = (
        f"{settings.frontend_url}/app/settings?checkout={reference}"
        f"&provider={payload.provider.value}&plan={payload.plan.value}"
    )
    return CheckoutResponse(
        message=(
            f"{payload.provider.value.title()} checkout initialized. "
            "Connect live API keys to complete real payments."
        ),
        provider=payload.provider.value,
        plan=payload.plan.value,
        amount_kobo=amount,
        currency="NGN",
        reference=reference,
        checkout_url=checkout_url,
        status="initialized",
    )


@router.post("/activate-mock", response_model=SubscriptionResponse)
async def activate_mock_subscription(
    plan: PlanTier,
    auth: CurrentAuth,
    db: DbSession,
):
    """Dev helper to simulate a successful payment (non-production)."""
    settings = get_settings()
    if settings.is_production:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Not available in production")

    tenant = auth.require_tenant()
    auth.require_roles(MembershipRole.owner, MembershipRole.admin)
    if plan == PlanTier.trial:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Choose a paid plan")

    sub = await ensure_subscription(db, tenant)
    now = datetime.now(timezone.utc)
    sub.plan = plan
    sub.status = SubscriptionStatus.active
    sub.amount_kobo = PLAN_PRICES_KOBO[plan]
    sub.current_period_end = now + timedelta(days=30)
    sub.trial_ends_at = None
    tenant.status = TenantStatus.active
    await db.flush()
    await db.refresh(sub)
    return _to_response(sub)


async def _activate_paid_subscription(
    db: DbSession,
    *,
    tenant_id: uuid.UUID,
    plan: PlanTier,
    provider: PaymentProvider,
    reference: str,
    amount_kobo: int,
    raw_payload: dict,
) -> Subscription:
    tenant = await db.scalar(select(Tenant).where(Tenant.id == tenant_id))
    if not tenant:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Tenant not found")
    sub = await ensure_subscription(db, tenant)
    now = datetime.now(timezone.utc)
    sub.plan = plan
    sub.status = SubscriptionStatus.active
    sub.provider = provider
    sub.amount_kobo = amount_kobo
    sub.current_period_end = now + timedelta(days=30)
    sub.trial_ends_at = None
    tenant.status = TenantStatus.active
    db.add(
        BillingEvent(
            tenant_id=tenant.id,
            provider=provider.value,
            event_type="payment.success",
            amount_kobo=amount_kobo,
            currency="NGN",
            reference=reference,
            payload=raw_payload,
        )
    )
    await db.flush()
    await db.refresh(sub)
    return sub


@router.post("/webhooks/paystack")
async def paystack_webhook(request: Request, db: DbSession):
    """Activate subscription from Paystack charge.success (secret optional in dev)."""
    import hashlib
    import hmac
    import json

    body = await request.body()
    settings = get_settings()
    signature = request.headers.get("x-paystack-signature", "")
    if settings.paystack_webhook_secret:
        expected = hmac.new(
            settings.paystack_webhook_secret.encode(),
            body,
            hashlib.sha512,
        ).hexdigest()
        if not hmac.compare_digest(expected, signature):
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Invalid Paystack signature")

    payload = json.loads(body.decode("utf-8") or "{}")
    event = payload.get("event")
    data = payload.get("data") or {}
    if event != "charge.success":
        return {"status": "ignored", "event": event}

    reference = data.get("reference") or ""
    metadata = data.get("metadata") or {}
    tenant_id = metadata.get("tenant_id")
    plan_raw = metadata.get("plan", "starter")
    if not tenant_id:
        existing = await db.scalar(
            select(BillingEvent).where(BillingEvent.reference == reference)
        )
        if not existing:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Unknown reference")
        tenant_id = str(existing.tenant_id)
        plan_raw = (existing.payload or {}).get("plan", plan_raw)

    try:
        plan = PlanTier(plan_raw)
    except ValueError:
        plan = PlanTier.starter

    amount = int(data.get("amount") or PLAN_PRICES_KOBO.get(plan, 0))
    sub = await _activate_paid_subscription(
        db,
        tenant_id=uuid.UUID(str(tenant_id)),
        plan=plan,
        provider=PaymentProvider.paystack,
        reference=reference,
        amount_kobo=amount,
        raw_payload=payload,
    )
    return {"status": "ok", "subscription_id": str(sub.id)}


@router.post("/webhooks/flutterwave")
async def flutterwave_webhook(request: Request, db: DbSession):
    settings = get_settings()
    secret = request.headers.get("verif-hash", "")
    if settings.flutterwave_webhook_secret and secret != settings.flutterwave_webhook_secret:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Invalid Flutterwave hash")

    payload = await request.json()
    data = payload.get("data") or payload
    status_value = (data.get("status") or payload.get("status") or "").lower()
    if status_value not in {"successful", "success"}:
        return {"status": "ignored"}

    reference = data.get("tx_ref") or data.get("flw_ref") or ""
    meta = data.get("meta") or {}
    tenant_id = meta.get("tenant_id")
    plan_raw = meta.get("plan", "starter")
    if not tenant_id:
        existing = await db.scalar(select(BillingEvent).where(BillingEvent.reference == reference))
        if not existing:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Unknown reference")
        tenant_id = str(existing.tenant_id)
        plan_raw = (existing.payload or {}).get("plan", plan_raw)

    try:
        plan = PlanTier(plan_raw)
    except ValueError:
        plan = PlanTier.starter

    amount_naira = float(data.get("amount") or 0)
    amount_kobo = int(amount_naira * 100) if amount_naira else PLAN_PRICES_KOBO.get(plan, 0)
    sub = await _activate_paid_subscription(
        db,
        tenant_id=uuid.UUID(str(tenant_id)),
        plan=plan,
        provider=PaymentProvider.flutterwave,
        reference=reference,
        amount_kobo=amount_kobo,
        raw_payload=payload,
    )
    return {"status": "ok", "subscription_id": str(sub.id)}
