"""Text-to-image providers: Cloudflare Workers AI + Google AI Studio.

Image Agent: tries active nodes cheapest-first, fails over on error,
and only escalates to expensive models when lighter ones fail.
"""

from __future__ import annotations

import base64
import io
import logging
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.secrets import decrypt_secret
from app.models.entities import ImageGenProviderConfig, ImageGenProviderKind

logger = logging.getLogger(__name__)


class ImageGenError(Exception):
    pass


# Catalog of available text-to-image models per provider
# Cloudflare Workers AI (@cf/…) + Cloudflare AI third-party partners (openai/…, google/…)
IMAGE_MODEL_CATALOG: dict[str, list[dict[str, str]]] = {
    "cloudflare": [
        # — Fast / cheap defaults (Cloudflare-hosted) —
        {
            "id": "@cf/black-forest-labs/flux-1-schnell",
            "label": "FLUX.1 Schnell",
            "hint": "Fast default · Cloudflare-hosted",
        },
        {
            "id": "@cf/black-forest-labs/flux-2-klein-4b",
            "label": "FLUX.2 Klein 4B",
            "hint": "Ultra-fast FLUX.2 · generate + edit · Cloudflare-hosted",
        },
        {
            "id": "@cf/black-forest-labs/flux-2-klein-9b",
            "label": "FLUX.2 Klein 9B",
            "hint": "Fast FLUX.2 with stronger quality · Cloudflare-hosted",
        },
        {
            "id": "@cf/bytedance/stable-diffusion-xl-lightning",
            "label": "SDXL Lightning",
            "hint": "Very fast SDXL · Cloudflare-hosted",
        },
        {
            "id": "@cf/lykon/dreamshaper-8-lcm",
            "label": "DreamShaper 8 LCM",
            "hint": "Stylized / illustrative · great for graphics · Cloudflare-hosted",
        },
        {
            "id": "@cf/stabilityai/stable-diffusion-xl-base-1.0",
            "label": "Stable Diffusion XL",
            "hint": "Classic SDXL · Cloudflare-hosted",
        },
        {
            "id": "@cf/black-forest-labs/flux-2-dev",
            "label": "FLUX.2 Dev",
            "hint": "Highest detail FLUX.2 · slower · Cloudflare-hosted",
        },
        # — Leonardo (strong graphic + text adherence) —
        {
            "id": "@cf/leonardo/lucid-origin",
            "label": "Lucid Origin (Leonardo)",
            "hint": "Sharp graphic design · strong prompt adherence · Cloudflare-hosted",
        },
        {
            "id": "@cf/leonardo/phoenix-1.0",
            "label": "Phoenix 1.0 (Leonardo)",
            "hint": "Prompt adherence + coherent text · Cloudflare-hosted",
        },
        # — Edit / inpaint —
        {
            "id": "@cf/runwayml/stable-diffusion-v1-5-img2img",
            "label": "SD 1.5 img2img",
            "hint": "Edit from a source image · Cloudflare-hosted",
        },
        {
            "id": "@cf/runwayml/stable-diffusion-v1-5-inpainting",
            "label": "SD 1.5 inpainting",
            "hint": "Masked inpainting · Cloudflare-hosted",
        },
        # — OpenAI via Cloudflare AI universal /ai/run (same account; needs AI Gateway / Unified Billing) —
        {
            "id": "openai/gpt-image-1.5",
            "label": "GPT Image 1.5 (OpenAI)",
            "hint": "Create + edit · via CF /ai/run · needs Unified Billing",
        },
        {
            "id": "openai/gpt-image-2",
            "label": "GPT Image 2 (OpenAI)",
            "hint": "Next-gen create + edit · via CF /ai/run · needs Unified Billing",
        },
        # — Google via Cloudflare AI —
        {
            "id": "google/nano-banana",
            "label": "Nano Banana (Google)",
            "hint": "Fast Google image · via CF /ai/run (not @cf path) · Unified Billing",
        },
        {
            "id": "google/nano-banana-2",
            "label": "Nano Banana 2 (Google)",
            "hint": "Google gen-2 · via CF /ai/run · Unified Billing",
        },
        {
            "id": "google/nano-banana-pro",
            "label": "Nano Banana Pro (Google)",
            "hint": "Higher detail · via CF /ai/run · Unified Billing",
        },
        {
            "id": "google/imagen-4",
            "label": "Imagen 4 (Google)",
            "hint": "Photorealistic · via CF /ai/run · Unified Billing",
        },
        # — ByteDance Seedream —
        {
            "id": "bytedance/seedream-4.0",
            "label": "Seedream 4.0",
            "hint": "Gen + edit · via CF /ai/run · Unified Billing",
        },
        {
            "id": "bytedance/seedream-4.5",
            "label": "Seedream 4.5",
            "hint": "Multi-reference · via CF /ai/run · Unified Billing",
        },
        {
            "id": "bytedance/seedream-5-lite",
            "label": "Seedream 5 Lite",
            "hint": "Faster Seedream · via CF /ai/run · Unified Billing",
        },
        # — Alibaba —
        {
            "id": "alibaba/wan-2.6-image",
            "label": "Wan 2.6 Image (Alibaba)",
            "hint": "Text-to-image · via CF /ai/run · Unified Billing",
        },
    ],
    "google_studio": [
        {
            "id": "gemini-2.0-flash-preview-image-generation",
            "label": "Gemini 2.0 Flash Image",
            "hint": "Google AI Studio free-tier friendly · supports image edit",
        },
        {
            "id": "gemini-2.5-flash-image-preview",
            "label": "Gemini 2.5 Flash Image",
            "hint": "Newer Gemini image preview · supports image edit",
        },
        {
            "id": "imagen-3.0-generate-002",
            "label": "Imagen 3",
            "hint": "Dedicated Imagen 3 (may need paid/billing)",
        },
    ],
}

DEFAULT_MODELS = {
    ImageGenProviderKind.cloudflare: "@cf/black-forest-labs/flux-1-schnell",
    ImageGenProviderKind.google_studio: "gemini-2.0-flash-preview-image-generation",
}

# Lower = prefer first (saves neurons / quota). Agent climbs this ladder on failure.
MODEL_COST_TIER: dict[str, int] = {
    "@cf/black-forest-labs/flux-1-schnell": 10,
    "@cf/black-forest-labs/flux-2-klein-4b": 12,
    "@cf/bytedance/stable-diffusion-xl-lightning": 15,
    "@cf/black-forest-labs/flux-2-klein-9b": 20,
    "@cf/lykon/dreamshaper-8-lcm": 25,
    "@cf/stabilityai/stable-diffusion-xl-base-1.0": 35,
    "gemini-2.0-flash-preview-image-generation": 40,
    "gemini-2.5-flash-image-preview": 45,
    "@cf/runwayml/stable-diffusion-v1-5-img2img": 50,
    "@cf/runwayml/stable-diffusion-v1-5-inpainting": 55,
    "@cf/leonardo/phoenix-1.0": 60,
    "@cf/leonardo/lucid-origin": 65,
    "google/nano-banana": 70,
    "google/nano-banana-2": 72,
    "bytedance/seedream-5-lite": 74,
    "alibaba/wan-2.6-image": 76,
    "@cf/black-forest-labs/flux-2-dev": 80,
    "google/nano-banana-pro": 82,
    "bytedance/seedream-4.0": 84,
    "bytedance/seedream-4.5": 86,
    "openai/gpt-image-1.5": 88,
    "google/imagen-4": 90,
    "imagen-3.0-generate-002": 92,
    "openai/gpt-image-2": 95,
}

# Cheap models the agent may try with the same Cloudflare credentials when a node fails
# Keep short — expensive partners only run when admin configures them as the primary model.
CF_AGENT_LADDER = [
    "@cf/black-forest-labs/flux-1-schnell",
    "@cf/black-forest-labs/flux-2-klein-4b",
    "@cf/bytedance/stable-diffusion-xl-lightning",
    "@cf/black-forest-labs/flux-2-klein-9b",
    "@cf/lykon/dreamshaper-8-lcm",
    "@cf/leonardo/phoenix-1.0",
    "@cf/stabilityai/stable-diffusion-xl-base-1.0",
    "@cf/leonardo/lucid-origin",
    "@cf/black-forest-labs/flux-2-dev",
]

GOOGLE_AGENT_LADDER = [
    "gemini-2.0-flash-preview-image-generation",
    "gemini-2.5-flash-image-preview",
    "imagen-3.0-generate-002",
]

# Cap attempts per graphic so one failure cascade cannot burn the daily quota
MAX_AGENT_ATTEMPTS = 4


@dataclass
class ImageGenRuntime:
    id: str | None
    kind: str
    name: str
    model: str
    api_key: str
    account_id: str | None = None
    config: ImageGenProviderConfig | None = None
    priority: int = 100
    last_ok_at: datetime | None = None


def model_cost_tier(model: str) -> int:
    if model in MODEL_COST_TIER:
        return MODEL_COST_TIER[model]
    m = model.lower()
    if "schnell" in m or "klein-4b" in m:
        return 12
    if "lightning" in m:
        return 15
    if "klein" in m:
        return 20
    if "dreamshaper" in m or "phoenix" in m:
        return 28
    if "lucid" in m:
        return 65
    if "flux-2-dev" in m or "flux-2/" in m:
        return 80
    if "gpt-image" in m:
        return 90
    if "imagen" in m or "seedream" in m or "nano-banana" in m or "wan-2" in m:
        return 85
    if "img2img" in m or "inpainting" in m:
        return 50
    if "gemini" in m and "flash" in m:
        return 42
    return 50


async def load_active_image_providers(db: AsyncSession | None) -> list[ImageGenRuntime]:
    if db is None:
        return []
    rows = await db.scalars(
        select(ImageGenProviderConfig)
        .where(
            ImageGenProviderConfig.deleted_at.is_(None),
            ImageGenProviderConfig.is_active.is_(True),
        )
        .order_by(ImageGenProviderConfig.priority.asc(), ImageGenProviderConfig.created_at.asc())
    )
    out: list[ImageGenRuntime] = []
    for row in rows:
        try:
            key = decrypt_secret(row.api_key_encrypted)
        except Exception:
            logger.warning("Skipping image provider %s — cannot decrypt key", row.name)
            continue
        kind = row.kind if isinstance(row.kind, ImageGenProviderKind) else ImageGenProviderKind(row.kind)
        out.append(
            ImageGenRuntime(
                id=str(row.id),
                kind=kind.value,
                name=row.name,
                model=row.model,
                api_key=key,
                account_id=row.account_id,
                config=row,
                priority=row.priority,
                last_ok_at=row.last_ok_at,
            )
        )
    return out


def build_agent_attempt_queue(
    providers: list[ImageGenRuntime],
    *,
    intent: str | None = None,
    with_source_image: bool = False,
) -> list[ImageGenRuntime]:
    """
    Build a cost-aware attempt queue from configured nodes.

    - Expands each credential across its cheap→expensive ladder
    - Always prefers low-cost models first (saves neurons / quota)
    - For intent=graphic, prefer stylized models (DreamShaper / SDXL) slightly earlier
    - For intent=photo, prefer Flux photoreal models
    - When with_source_image, prefer Gemini image + img2img (true edit) first
    - Keeps at least one attempt per configured provider kind when possible
    - Caps at MAX_AGENT_ATTEMPTS
    """
    if not providers:
        return []

    seen: set[str] = set()
    candidates: list[ImageGenRuntime] = []

    def push(base: ImageGenRuntime, model: str, *, label_suffix: str = "") -> None:
        key = f"{base.kind}|{base.account_id or ''}|{model}|{base.api_key[:12]}"
        if key in seen:
            return
        # Skip img2img ladder unless we have a source image (or it's the configured model)
        if "img2img" in model.lower() and model != base.model and not with_source_image:
            return
        # Skip imagen when editing a source photo (text-only)
        if with_source_image and model.startswith("imagen-"):
            return
        seen.add(key)
        name = base.name if model == base.model else f"{base.name}{label_suffix}"
        candidates.append(replace(base, model=model, name=name))

    configured_kinds = {p.kind for p in providers}

    for p in providers:
        push(p, p.model)
        ladder = (
            CF_AGENT_LADDER
            if p.kind == ImageGenProviderKind.cloudflare.value
            else GOOGLE_AGENT_LADDER
            if p.kind == ImageGenProviderKind.google_studio.value
            else []
        )
        for mid in ladder:
            push(p, mid, label_suffix=f" · {mid.split('/')[-1]}")
        # Explicitly include img2img when transforming a source photo
        if with_source_image and p.kind == ImageGenProviderKind.cloudflare.value:
            push(p, "@cf/runwayml/stable-diffusion-v1-5-img2img", label_suffix=" · img2img")

    def intent_bias(model: str) -> int:
        m = model.lower()
        if with_source_image:
            # Multimodal edit models first
            if "gemini" in m and "image" in m:
                return -55
            if "img2img" in m:
                return -40
            if "flux-2" in m:
                return -15
            if "imagen" in m:
                return 40
        if intent in ("graphic", "flyer"):
            if "lucid" in m or "phoenix" in m:
                return -35
            if "dreamshaper" in m:
                return -25
            if "sdxl" in m or "stable-diffusion-xl" in m:
                return -12
            if "flux" in m:
                return 5
            return 0
        if intent == "photo":
            if "flux" in m:
                return -20
            if "imagen" in m:
                return -10
            if "dreamshaper" in m:
                return 8
            return 0
        return 0

    # Prefer each admin-configured model (the ones known to work) ahead of ladder variants
    configured_models = {(p.kind, p.model) for p in providers}

    def configured_bias(r: ImageGenRuntime) -> int:
        return -40 if (r.kind, r.model) in configured_models else 0

    ordered = sorted(
        candidates,
        key=lambda r: (
            model_cost_tier(r.model) + intent_bias(r.model) + configured_bias(r),
            r.priority,
            0 if r.last_ok_at else 1,
            r.name,
        ),
    )

    queue = ordered[:MAX_AGENT_ATTEMPTS]

    # Ensure each configured provider kind still gets a shot inside the cap
    kinds_in_queue = {r.kind for r in queue}
    for kind in configured_kinds:
        if kind in kinds_in_queue:
            continue
        alt = next((r for r in ordered if r.kind == kind), None)
        if not alt or not queue:
            continue
        # Replace the most expensive attempt
        worst_i = max(range(len(queue)), key=lambda i: model_cost_tier(queue[i].model))
        queue[worst_i] = alt
        kinds_in_queue.add(kind)

    queue.sort(
        key=lambda r: (
            model_cost_tier(r.model) + intent_bias(r.model) + configured_bias(r),
            r.priority,
            0 if r.last_ok_at else 1,
        )
    )
    return queue


def build_image_prompt(
    *,
    business_name: str,
    theme: str,
    caption: str,
    cta: str | None,
    platform: str,
    role: str = "cover",
    focus: str | None = None,
    style_hint: str | None = None,
) -> str:
    """Tight marketing prompt — strong visuals, low token/neuron waste."""
    concept = (focus or caption or theme or "").strip()
    # Keep short: image models pay per steps/tiles more than prompt length, but long prompts dilute quality
    concept = concept[:280]
    headline = (theme or business_name or "Offer")[:80]
    style = style_hint or (
        "clean modern African SME social graphic, bold focal subject, "
        "square 1:1, high contrast, premium marketing look, no watermark, no logo clutter"
    )
    parts = [
        f"{platform} ad graphic for {business_name}.",
        f"Headline idea: {headline}.",
        f"Role: {role}.",
        f"Scene: {concept}",
    ]
    if cta:
        parts.append(f"CTA mood: {cta[:80]}.")
    parts.append(style)
    parts.append("Large readable shapes; avoid tiny text and busy backgrounds.")
    return " ".join(parts)


def _is_cf_hosted_model(model: str) -> bool:
    """Workers AI path models (@cf/...). Partner catalog IDs are author/model."""
    return (model or "").startswith("@cf/")


def _normalize_cf_account_id(account_id: str | None) -> str:
    aid = (account_id or "").strip()
    if not aid:
        raise ImageGenError("Cloudflare account_id is required")
    # Cloudflare account IDs are 32 hex chars — truncated IDs yield HTTP 7000 "No route"
    if len(aid) != 32 or any(c not in "0123456789abcdefABCDEF" for c in aid):
        raise ImageGenError(
            f"Cloudflare Account ID looks invalid ({len(aid)} chars). "
            "Paste the full 32-character ID from the Cloudflare dashboard."
        )
    return aid


def _parse_cloudflare_image_response(res: httpx.Response) -> bytes:
    content_type = (res.headers.get("content-type") or "").lower()
    if "application/json" in content_type:
        data = res.json()
        if isinstance(data, dict) and data.get("success") is False:
            errs = data.get("errors") or []
            msg = errs[0].get("message") if errs and isinstance(errs[0], dict) else res.text[:300]
            raise ImageGenError(f"Cloudflare AI error: {msg}")
        result = data.get("result") if isinstance(data, dict) else None
        # Universal /ai/run envelope sometimes nests under result.output / result.image
        if isinstance(result, dict):
            for key in ("image", "b64_json", "data"):
                val = result.get(key)
                if isinstance(val, str) and len(val) > 64:
                    try:
                        return base64.b64decode(val)
                    except Exception:
                        pass
                if isinstance(val, list) and val:
                    first = val[0]
                    if isinstance(first, str):
                        return base64.b64decode(first)
                    if isinstance(first, dict):
                        for k in ("b64_json", "image", "data"):
                            if isinstance(first.get(k), str):
                                return base64.b64decode(first[k])
            out = result.get("output")
            if isinstance(out, list) and out:
                first = out[0]
                if isinstance(first, str) and first.startswith("data:image"):
                    b64 = first.split(",", 1)[-1]
                    return base64.b64decode(b64)
                if isinstance(first, str):
                    return base64.b64decode(first)
                if isinstance(first, dict):
                    for k in ("image", "b64_json", "data", "url"):
                        v = first.get(k)
                        if isinstance(v, str) and k != "url" and len(v) > 64:
                            return base64.b64decode(v)
            if result.get("image"):
                return base64.b64decode(result["image"])
        if isinstance(result, str):
            return base64.b64decode(result)
        if isinstance(data, dict) and data.get("image"):
            return base64.b64decode(data["image"])
        raise ImageGenError("Cloudflare response missing image payload")
    return res.content


def _cloudflare_steps(model: str) -> int:
    """Economical step counts — quality without burning neurons."""
    m = model.lower()
    if "flux-2-dev" in m:
        return 12
    if "lucid" in m or "phoenix" in m:
        return 8
    if "klein" in m:
        return 4
    if "schnell" in m or "lightning" in m or "lcm" in m:
        return 4
    if "flux" in m:
        return 4
    return 4


def _cf_http_error(res: httpx.Response, *, model: str) -> ImageGenError:
    text = res.text[:500]
    if "No route for that URI" in text:
        if _is_cf_hosted_model(model):
            return ImageGenError(
                f"Cloudflare HTTP {res.status_code}: model path not found for {model}. "
                "Check the model ID and that your Account ID is the full 32 characters."
            )
        return ImageGenError(
            f"Cloudflare HTTP {res.status_code}: partner model `{model}` is not on the "
            "Workers AI path. Peju now uses POST /ai/run with {model, input}. "
            "Ensure Unified Billing / AI Gateway is enabled and your token has AI Gateway permission."
        )
    return ImageGenError(f"Cloudflare HTTP {res.status_code}: {text}")


async def _generate_cloudflare_partner(
    *,
    account_id: str,
    api_key: str,
    model: str,
    prompt: str,
    source_image: bytes | None = None,
) -> bytes:
    """Third-party CF catalog models (google/*, openai/*, …) use universal /ai/run envelope."""
    url = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    model_l = model.lower()
    clipped = prompt[:1800]
    inp: dict[str, Any] = {"prompt": clipped, "aspect_ratio": "1:1"}

    if "gpt-image" in model_l or "openai/" in model_l:
        inp.pop("aspect_ratio", None)
        inp["size"] = "1024x1024"
    if source_image and (
        "nano-banana" in model_l
        or "gpt-image" in model_l
        or "seedream" in model_l
        or "imagen" in model_l
        or "wan-2" in model_l
    ):
        b64 = base64.b64encode(source_image).decode("ascii")
        if "nano-banana" in model_l or "imagen" in model_l:
            inp["image_input"] = [b64]
        else:
            inp["image"] = b64

    body = {"model": model, "input": inp}
    async with httpx.AsyncClient(timeout=180.0) as client:
        res = await client.post(url, headers=headers, json=body)
        if res.status_code >= 400 and "image_input" in inp:
            inp.pop("image_input", None)
            inp.pop("image", None)
            res = await client.post(url, headers=headers, json={"model": model, "input": inp})
        elif res.status_code >= 400 and "image" in inp:
            inp.pop("image", None)
            res = await client.post(url, headers=headers, json={"model": model, "input": inp})
        if res.status_code >= 400:
            raise _cf_http_error(res, model=model)
        return _parse_cloudflare_image_response(res)


async def _generate_cloudflare(
    runtime: ImageGenRuntime,
    prompt: str,
    *,
    source_image: bytes | None = None,
) -> bytes:
    account_id = _normalize_cf_account_id(runtime.account_id)
    model = runtime.model or DEFAULT_MODELS[ImageGenProviderKind.cloudflare]

    # Partner / third-party catalog → universal envelope (NOT /ai/run/{author}/{model})
    if not _is_cf_hosted_model(model):
        return await _generate_cloudflare_partner(
            account_id=account_id,
            api_key=runtime.api_key,
            model=model,
            prompt=prompt,
            source_image=source_image,
        )

    url = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run/{model}"
    headers = {"Authorization": f"Bearer {runtime.api_key}"}
    model_l = model.lower()
    clipped = prompt[:1800]
    steps = _cloudflare_steps(model)

    # img2img — keep source subject
    if source_image and "img2img" in model_l:
        # Workers AI SD img2img expects a 0–1 float array of pixels (RGB).
        from PIL import Image

        img = Image.open(io.BytesIO(source_image)).convert("RGB").resize((512, 512))
        pixels = list(img.getdata())
        flat: list[float] = []
        for r, g, b in pixels:
            flat.extend([r / 255.0, g / 255.0, b / 255.0])
        body = {
            "prompt": clipped,
            "image": flat,
            "strength": 0.55,
            "num_steps": 20,
        }
        async with httpx.AsyncClient(timeout=180.0) as client:
            res = await client.post(
                url,
                headers={**headers, "Content-Type": "application/json"},
                json=body,
            )
            if res.status_code >= 400:
                raise _cf_http_error(res, model=model)
            return _parse_cloudflare_image_response(res)

    # FLUX.2 + Leonardo often want multipart/form-data
    if "flux-2" in model_l or "leonardo/" in model_l:
        form: dict[str, str] = {
            "prompt": clipped,
            "width": "1024",
            "height": "1024",
            "steps": str(steps),
        }
        files = None
        if source_image and ("flux-2" in model_l or "lucid" in model_l or "phoenix" in model_l):
            files = {"image": ("source.png", source_image, "image/png")}
        async with httpx.AsyncClient(timeout=180.0) as client:
            res = await client.post(url, headers=headers, data=form, files=files)
            if res.status_code >= 400 and source_image and files:
                res = await client.post(url, headers=headers, data=form)
            if res.status_code >= 400:
                raise _cf_http_error(res, model=model)
            return _parse_cloudflare_image_response(res)

    # FLUX.1 / SDXL / DreamShaper — JSON body on path endpoint
    body: dict[str, Any] = {"prompt": clipped}
    if "flux" in model_l or "lightning" in model_l or "lcm" in model_l:
        body["steps"] = steps

    async with httpx.AsyncClient(timeout=180.0) as client:
        res = await client.post(
            url,
            headers={**headers, "Content-Type": "application/json"},
            json=body,
        )
        if res.status_code >= 400:
            raise _cf_http_error(res, model=model)
        return _parse_cloudflare_image_response(res)


async def _generate_google_studio(
    runtime: ImageGenRuntime,
    prompt: str,
    *,
    source_image: bytes | None = None,
) -> bytes:
    model = runtime.model or DEFAULT_MODELS[ImageGenProviderKind.google_studio]
    # Imagen predict API (text-only)
    if model.startswith("imagen-"):
        if source_image:
            raise ImageGenError("Imagen text-to-image cannot edit a source photo — try Gemini image")
        url = (
            f"https://generativelanguage.googleapis.com/v1beta/models/"
            f"{model}:predict?key={runtime.api_key}"
        )
        body = {
            "instances": [{"prompt": prompt[:1500]}],
            "parameters": {"sampleCount": 1},
        }
        async with httpx.AsyncClient(timeout=120.0) as client:
            res = await client.post(url, json=body)
            if res.status_code >= 400:
                raise ImageGenError(f"Google Imagen HTTP {res.status_code}: {res.text[:400]}")
            data = res.json()
            preds = data.get("predictions") or []
            if not preds:
                raise ImageGenError("Imagen returned no predictions")
            b64 = preds[0].get("bytesBase64Encoded") or preds[0].get("image")
            if not b64:
                raise ImageGenError("Imagen prediction missing image bytes")
            return base64.b64decode(b64)

    # Gemini native image generation / edit
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{model}:generateContent?key={runtime.api_key}"
    )
    parts: list[dict[str, Any]] = [{"text": prompt[:1500]}]
    if source_image:
        # Detect mime lightly
        mime = "image/png"
        if source_image[:2] == b"\xff\xd8":
            mime = "image/jpeg"
        elif source_image[:4] == b"RIFF":
            mime = "image/webp"
        parts.append(
            {
                "inline_data": {
                    "mime_type": mime,
                    "data": base64.b64encode(source_image).decode("ascii"),
                }
            }
        )
    body = {
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {
            "responseModalities": ["TEXT", "IMAGE"],
        },
    }
    async with httpx.AsyncClient(timeout=180.0) as client:
        res = await client.post(url, json=body)
        if res.status_code >= 400:
            raise ImageGenError(f"Google Gemini image HTTP {res.status_code}: {res.text[:400]}")
        data = res.json()
        candidates = data.get("candidates") or []
        for cand in candidates:
            cparts = ((cand.get("content") or {}).get("parts")) or []
            for part in cparts:
                inline = part.get("inlineData") or part.get("inline_data") or {}
                b64 = inline.get("data")
                if b64:
                    return base64.b64decode(b64)
        raise ImageGenError("Gemini response contained no image data")


async def generate_image_bytes(
    runtime: ImageGenRuntime,
    *,
    prompt: str,
    source_image: bytes | None = None,
) -> tuple[bytes, str]:
    """Return (image_bytes, mime_hint). Pass source_image to edit/transform."""
    if runtime.kind == ImageGenProviderKind.cloudflare.value:
        data = await _generate_cloudflare(runtime, prompt, source_image=source_image)
        return data, "image/png"
    if runtime.kind == ImageGenProviderKind.google_studio.value:
        data = await _generate_google_studio(runtime, prompt, source_image=source_image)
        return data, "image/png"
    raise ImageGenError(f"Unsupported image provider kind: {runtime.kind}")


async def generate_with_failover(
    db: AsyncSession,
    *,
    prompt: str,
    intent: str | None = None,
    source_image: bytes | None = None,
) -> dict[str, Any]:
    """
    Image Agent: try cheapest working model first; switch on failure.
    Optional intent lightly biases model order.
    Pass source_image to transform/edit the working photo (Gemini / img2img).
    Returns {bytes, mime, provider, model, provider_name, agent_attempts, ...}.
    """
    providers = await load_active_image_providers(db)
    if not providers:
        raise ImageGenError("No active image generation providers configured")

    queue = build_agent_attempt_queue(
        providers,
        intent=intent,
        with_source_image=bool(source_image),
    )
    errors: list[str] = []
    attempted: list[str] = []

    for runtime in queue:
        label = f"{runtime.kind}/{runtime.model}"
        attempted.append(label)
        try:
            logger.info(
                "Image agent trying %s (%s) intent=%s source=%s",
                runtime.name,
                label,
                intent or "auto",
                bool(source_image),
            )
            data, mime = await generate_image_bytes(
                runtime,
                prompt=prompt,
                source_image=source_image,
            )
            if runtime.config is not None:
                runtime.config.last_ok_at = datetime.now(timezone.utc)
                runtime.config.last_error = None
                await db.flush()
            return {
                "bytes": data,
                "mime": mime,
                "provider": runtime.kind,
                "model": runtime.model,
                "provider_name": runtime.name,
                "provider_id": runtime.id,
                "agent_attempts": attempted,
                "cost_tier": model_cost_tier(runtime.model),
                "intent": intent,
                "used_source_image": bool(source_image),
            }
        except Exception as exc:
            msg = f"{runtime.name} ({label}): {exc}"
            logger.warning("Image agent step failed: %s", msg)
            errors.append(msg)
            if runtime.config is not None and runtime.model == (runtime.config.model or ""):
                runtime.config.last_error = str(exc)[:2000]
                await db.flush()

    raise ImageGenError(
        "Image agent exhausted attempts: "
        + " | ".join(errors[:3])
        + (f" (tried {len(attempted)} models)" if attempted else "")
    )


async def test_image_provider(runtime: ImageGenRuntime) -> dict[str, Any]:
    prompt = "Simple flat icon of a green leaf on white background, minimal, square"
    data, mime = await generate_image_bytes(runtime, prompt=prompt)
    return {
        "ok": True,
        "provider": runtime.kind,
        "model": runtime.model,
        "bytes": len(data),
        "mime": mime,
    }
