"""Image generation cost estimates + usage event recording."""

from __future__ import annotations

import uuid
from decimal import Decimal, InvalidOperation

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import ImageCostRate, ImageUsageEvent

# Fallback rate card (USD per successful image) when Super Admin hasn't set rates
DEFAULT_RATES: dict[tuple[str, str], str] = {
    ("cloudflare", "@cf/black-forest-labs/flux-1-schnell"): "0.0003",
    ("cloudflare", "@cf/bytedance/stable-diffusion-xl-lightning"): "0.0004",
    ("cloudflare", "@cf/black-forest-labs/flux-2-klein-9b"): "0.002",
    ("cloudflare", "@cf/black-forest-labs/flux-2-dev"): "0.01",
    ("cloudflare", "*"): "0.001",
    ("google_studio", "*"): "0.002",
    ("template", "*"): "0",
    ("hybrid", "*"): "0.001",
}

# Rough LLM copy-plan cost per 1K tokens USD
LLM_USD_PER_1K = Decimal("0.0002")


async def resolve_image_rate_usd(
    db: AsyncSession,
    *,
    provider: str | None,
    model: str | None,
) -> Decimal:
    provider = (provider or "unknown").lower()
    model = model or "*"
    row = await db.scalar(
        select(ImageCostRate).where(
            ImageCostRate.provider == provider,
            ImageCostRate.model == model,
            ImageCostRate.is_active.is_(True),
        )
    )
    if not row:
        row = await db.scalar(
            select(ImageCostRate).where(
                ImageCostRate.provider == provider,
                ImageCostRate.model == "*",
                ImageCostRate.is_active.is_(True),
            )
        )
    if row:
        try:
            return Decimal(row.usd_per_image)
        except InvalidOperation:
            pass
    key = (provider, model)
    raw = DEFAULT_RATES.get(key) or DEFAULT_RATES.get((provider, "*")) or "0.001"
    return Decimal(raw)


def estimate_total_usd(
    *,
    image_usd: Decimal,
    prompt_tokens: int = 0,
    completion_tokens: int = 0,
) -> Decimal:
    tokens = prompt_tokens + completion_tokens
    llm = (Decimal(tokens) / Decimal(1000)) * LLM_USD_PER_1K
    return (image_usd + llm).quantize(Decimal("0.000001"))


async def record_image_usage(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID | None,
    post_id: uuid.UUID | None,
    media_asset_id: uuid.UUID | None,
    engine: str,
    image_provider: str | None,
    image_model: str | None,
    llm_provider: str | None = None,
    llm_model: str | None = None,
    prompt_tokens: int = 0,
    completion_tokens: int = 0,
    metadata: dict | None = None,
) -> ImageUsageEvent:
    image_usd = await resolve_image_rate_usd(
        db, provider=image_provider or engine, model=image_model
    )
    total = estimate_total_usd(
        image_usd=image_usd,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
    )
    event = ImageUsageEvent(
        tenant_id=tenant_id,
        user_id=user_id,
        post_id=post_id,
        media_asset_id=media_asset_id,
        feature="marketing.graphics",
        engine=engine,
        image_provider=image_provider,
        image_model=image_model,
        llm_provider=llm_provider,
        llm_model=llm_model,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        estimated_cost_usd=str(total),
        metadata_json=metadata,
    )
    db.add(event)
    await db.flush()
    return event
