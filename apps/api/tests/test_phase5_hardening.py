"""Unit tests for tenant isolation and marketing helpers (Phase 5)."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest

from app.ai.marketing_generator import build_template_plan, month_dates
from app.core.deps import AuthContext
from app.core.rate_limit import enforce_rate_limit
from app.models import MembershipRole, Tenant, TenantStatus, User
from fastapi import HTTPException


def test_month_dates_august():
    dates = month_dates(2026, 8, 30)
    assert len(dates) == 30
    assert dates[0].day == 1
    assert dates[-1].day == 30


def test_template_plan_has_posts():
    class FakeProfile:
        business_name = "Ada Boutique"
        industry = "Fashion"
        brand_voice = "Warm and stylish"
        target_audience = "Young professionals in Lagos"
        competitors = ["Brand A"]
        socials = {"instagram": "@ada"}
        goals = "More walk-ins"

    plan = build_template_plan(FakeProfile(), 8, 2026)  # type: ignore[arg-type]
    assert plan["strategy"]["summary"]
    assert len(plan["posts"]) == 30
    assert plan["posts"][0]["day_index"] == 1
    assert plan["provider"] == "template-v1"


def test_suspended_tenant_blocked():
    user = User(
        id=uuid.uuid4(),
        email="a@b.com",
        password_hash="x",
        full_name="A",
    )
    tenant = Tenant(
        id=uuid.uuid4(),
        name="Suspended Co",
        slug="suspended-co",
        status=TenantStatus.suspended,
    )
    ctx = AuthContext(
        user=user,
        session_id=uuid.uuid4(),
        tenant=tenant,
        membership=None,
        roles=[],
        is_platform_admin=False,
    )
    with pytest.raises(HTTPException) as exc:
        ctx.require_tenant()
    assert exc.value.status_code == 403


def test_rate_limit_trips(monkeypatch):
    class FakeClient:
        host = "203.0.113.10"

    class FakeRequest:
        headers = {}
        client = FakeClient()

    req = FakeRequest()
    # unique scope per test run
    scope = f"test-{uuid.uuid4().hex}"
    for _ in range(3):
        enforce_rate_limit(req, scope=scope, limit=3, window_seconds=60)  # type: ignore[arg-type]
    with pytest.raises(HTTPException) as exc:
        enforce_rate_limit(req, scope=scope, limit=3, window_seconds=60)  # type: ignore[arg-type]
    assert exc.value.status_code == 429
