"""LLM / generation usage metering helpers."""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import LlmUsageEvent


def estimate_tokens(text: str) -> int:
    # Rough heuristic until real provider usage is wired (~4 chars/token).
    return max(1, len(text) // 4)


async def record_usage(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID | None,
    feature: str,
    prompt_text: str,
    completion_text: str,
    provider: str = "peju_local",
    model: str = "template-v1",
    metadata: dict | None = None,
) -> LlmUsageEvent:
    prompt_tokens = estimate_tokens(prompt_text)
    completion_tokens = estimate_tokens(completion_text)
    event = LlmUsageEvent(
        tenant_id=tenant_id,
        user_id=user_id,
        feature=feature,
        provider=provider,
        model=model,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        total_tokens=prompt_tokens + completion_tokens,
        metadata_json=metadata,
    )
    db.add(event)
    await db.flush()
    return event
