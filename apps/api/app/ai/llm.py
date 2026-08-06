"""Multi-provider LLM client — OpenAI, Groq, Gemini (OpenAI-compatible APIs)."""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.secrets import decrypt_secret
from app.models import LlmProviderConfig, LlmProviderKind

logger = logging.getLogger(__name__)

DEFAULT_BASE_URLS = {
    LlmProviderKind.openai: "https://api.openai.com/v1",
    LlmProviderKind.groq: "https://api.groq.com/openai/v1",
    LlmProviderKind.gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
    LlmProviderKind.custom: "https://api.openai.com/v1",
}

DEFAULT_MODELS = {
    LlmProviderKind.openai: "gpt-4o-mini",
    LlmProviderKind.groq: "llama-3.3-70b-versatile",
    LlmProviderKind.gemini: "gemini-2.0-flash",
    LlmProviderKind.custom: "gpt-4o-mini",
}


class LLMError(Exception):
    pass


@dataclass
class ProviderRuntime:
    id: str | None
    kind: str
    name: str
    model: str
    base_url: str
    api_key: str
    config: LlmProviderConfig | None = None


async def load_active_providers(db: AsyncSession | None) -> list[ProviderRuntime]:
    providers: list[ProviderRuntime] = []
    if db is not None:
        rows = await db.scalars(
            select(LlmProviderConfig)
            .where(
                LlmProviderConfig.deleted_at.is_(None),
                LlmProviderConfig.is_active.is_(True),
            )
            .order_by(LlmProviderConfig.priority.asc(), LlmProviderConfig.created_at.asc())
        )
        for row in rows:
            try:
                key = decrypt_secret(row.api_key_encrypted)
            except Exception:
                logger.warning("Skipping provider %s — cannot decrypt key", row.name)
                continue
            kind = row.kind if isinstance(row.kind, LlmProviderKind) else LlmProviderKind(row.kind)
            base = row.base_url or DEFAULT_BASE_URLS.get(kind, DEFAULT_BASE_URLS[LlmProviderKind.openai])
            providers.append(
                ProviderRuntime(
                    id=str(row.id),
                    kind=kind.value,
                    name=row.name,
                    model=row.model,
                    base_url=base.rstrip("/"),
                    api_key=key,
                    config=row,
                )
            )

    # Env fallback when no active DB providers
    settings = get_settings()
    if not providers and settings.openai_api_key:
        providers.append(
            ProviderRuntime(
                id=None,
                kind="openai",
                name="OpenAI (env)",
                model=settings.openai_model,
                base_url=DEFAULT_BASE_URLS[LlmProviderKind.openai],
                api_key=settings.openai_api_key,
            )
        )
    return providers


async def _call_openai_compatible(
    provider: ProviderRuntime,
    *,
    system: str,
    user: str,
    temperature: float,
) -> dict[str, Any]:
    headers = {
        "Authorization": f"Bearer {provider.api_key}",
        "Content-Type": "application/json",
    }
    body = {
        "model": provider.model,
        "temperature": temperature,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    }
    url = f"{provider.base_url}/chat/completions"
    async with httpx.AsyncClient(timeout=90.0) as client:
        res = await client.post(url, headers=headers, json=body)
        if res.status_code >= 400:
            raise LLMError(f"{provider.kind} HTTP {res.status_code}: {res.text[:300]}")
        data = res.json()
        content = data["choices"][0]["message"]["content"]
        # Some models wrap JSON in fences
        content = content.strip()
        if content.startswith("```"):
            content = content.strip("`")
            if content.startswith("json"):
                content = content[4:].strip()
        parsed = json.loads(content)
        if not isinstance(parsed, dict):
            raise LLMError("LLM returned non-object JSON")
        usage = data.get("usage") or {}
        parsed["_usage"] = {
            "prompt_tokens": int(usage.get("prompt_tokens") or 0),
            "completion_tokens": int(usage.get("completion_tokens") or 0),
            "total_tokens": int(usage.get("total_tokens") or 0),
            "provider": provider.kind,
            "model": provider.model,
            "provider_name": provider.name,
            "provider_id": provider.id,
        }
        return parsed


async def stream_completion(
    *,
    system: str,
    user: str,
    temperature: float = 0.7,
    json_mode: bool = True,
    db: AsyncSession | None = None,
):
    """Yield OpenAI-compatible chat completion text deltas from the first healthy provider."""
    providers = await load_active_providers(db)
    if not providers:
        raise LLMError("No active LLM providers configured")

    errors: list[str] = []
    for provider in providers:
        headers = {
            "Authorization": f"Bearer {provider.api_key}",
            "Content-Type": "application/json",
        }
        body: dict[str, Any] = {
            "model": provider.model,
            "temperature": temperature,
            "stream": True,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        }
        if json_mode:
            body["response_format"] = {"type": "json_object"}

        url = f"{provider.base_url}/chat/completions"
        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                async with client.stream("POST", url, headers=headers, json=body) as res:
                    if res.status_code >= 400:
                        text = (await res.aread()).decode("utf-8", errors="ignore")[:300]
                        raise LLMError(f"{provider.kind} HTTP {res.status_code}: {text}")

                    usage: dict[str, Any] = {
                        "prompt_tokens": 0,
                        "completion_tokens": 0,
                        "total_tokens": 0,
                        "provider": provider.kind,
                        "model": provider.model,
                    }
                    async for line in res.aiter_lines():
                        if not line or not line.startswith("data:"):
                            continue
                        payload = line[5:].strip()
                        if payload == "[DONE]":
                            break
                        try:
                            chunk = json.loads(payload)
                        except json.JSONDecodeError:
                            continue
                        if chunk.get("usage"):
                            u = chunk["usage"]
                            usage["prompt_tokens"] = int(u.get("prompt_tokens") or 0)
                            usage["completion_tokens"] = int(u.get("completion_tokens") or 0)
                            usage["total_tokens"] = int(u.get("total_tokens") or 0)
                        choices = chunk.get("choices") or []
                        if not choices:
                            continue
                        delta = (choices[0].get("delta") or {}).get("content") or ""
                        if delta:
                            yield {"type": "delta", "text": delta}
                    yield {"type": "usage", "usage": usage}
                    if provider.config is not None and db is not None:
                        provider.config.last_ok_at = datetime.now(timezone.utc)
                        provider.config.last_error = None
                        await db.flush()
                    return
        except Exception as exc:
            msg = f"{provider.name} ({provider.kind}/{provider.model}): {exc}"
            logger.warning("LLM stream failed: %s", msg)
            errors.append(msg)
            if provider.config is not None and db is not None:
                provider.config.last_error = str(exc)[:2000]
                await db.flush()

    raise LLMError("All LLM providers failed: " + " | ".join(errors[:3]))


async def complete_json(
    *,
    system: str,
    user: str,
    temperature: float = 0.7,
    db: AsyncSession | None = None,
) -> dict[str, Any]:
    """
    Try active providers in priority order until one succeeds.
    """
    providers = await load_active_providers(db)
    if not providers:
        raise LLMError("No active LLM providers configured")

    errors: list[str] = []
    for provider in providers:
        try:
            result = await _call_openai_compatible(
                provider, system=system, user=user, temperature=temperature
            )
            if provider.config is not None and db is not None:
                provider.config.last_ok_at = datetime.now(timezone.utc)
                provider.config.last_error = None
                await db.flush()
            return result
        except Exception as exc:
            msg = f"{provider.name} ({provider.kind}/{provider.model}): {exc}"
            logger.warning("LLM provider failed: %s", msg)
            errors.append(msg)
            if provider.config is not None and db is not None:
                provider.config.last_error = str(exc)[:2000]
                await db.flush()

    raise LLMError("All LLM providers failed: " + " | ".join(errors[:3]))


async def test_provider(provider: ProviderRuntime) -> dict[str, Any]:
    result = await _call_openai_compatible(
        provider,
        system='Return JSON {"ok": true, "provider": "name"}',
        user="Ping health check.",
        temperature=0,
    )
    return {
        "ok": True,
        "provider": provider.kind,
        "model": provider.model,
        "usage": result.get("_usage"),
    }


def provider_label_from_usage(usage: dict | None) -> str:
    if not usage:
        return "template-v1"
    return f"{usage.get('provider', 'unknown')}:{usage.get('model', 'unknown')}"
