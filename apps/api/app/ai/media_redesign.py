"""AI helpers to redesign / iterate on media library images via text prompts.

Goals:
- Enhance the user's input (don't invent a different scene)
- Draft a starter only when the input is empty
- Detect graphic vs photo intent and shape prompts + model preference
- Keep LLM calls short to save tokens
"""

from __future__ import annotations

import re

from app.ai.llm import LLMError, complete_json, load_active_providers

GRAPHIC_WORDS = re.compile(
    r"\b(graphic|graphics|poster|flyer|banner|design|designed|"
    r"illustration|illustrative|vector|flat\s*design|infographic|carousel|"
    r"social\s*card|ad\s*creative|branded|typography|layout|template|pack)\b",
    re.I,
)
PHOTO_WORDS = re.compile(
    r"\b(photo|photograph|photorealistic|realistic|cinematic|camera|portrait|"
    r"lifestyle\s*shot|product\s*shot|studio\s*light)\b",
    re.I,
)


def detect_intent(text: str | None, *, meta: dict | None = None) -> str:
    """Return 'graphic' or 'photo' from user text / asset metadata."""
    blob = (text or "").strip()
    meta = meta or {}
    engine = str(meta.get("engine") or "")
    role = str(meta.get("role") or "")
    if GRAPHIC_WORDS.search(blob):
        return "graphic"
    if PHOTO_WORDS.search(blob):
        return "photo"
    if engine in ("hybrid", "template", "redesign") or role in (
        "cover",
        "quote",
        "cta",
        "tip",
        "product",
        "redesign",
    ):
        # Prior marketing graphics lean graphic unless user said photo
        if "prompt_excerpt" in meta or "headline" in meta:
            return "graphic"
    # Default: if wording sounds like scene description → photo, else graphic for marketing lib
    if any(w in blob.lower() for w in ("scene", "person", "people", "street", "market", "kitchen")):
        return "photo"
    return "graphic" if blob else "graphic"


def seed_prompt_from_asset(*, title: str | None, role: str | None, meta: dict | None) -> str:
    meta = meta or {}
    for key in ("user_prompt", "prompt_excerpt", "focus", "image_prompt", "style_hint"):
        val = meta.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()[:500]
    bits = [b for b in [title, role] if b]
    if bits:
        return f"Marketing graphic for: {', '.join(bits)}"
    return "Clean African SME social graphic, bold focal subject, square 1:1"


def build_redesign_image_prompt(
    *,
    user_prompt: str,
    intent: str,
    base_prompt: str | None = None,
) -> str:
    """Honor the user's prompt as the primary instruction.

    Prior asset seed is only light context — never overrides the user.
    """
    user = (user_prompt or "").strip()[:900]
    if not user:
        user = (base_prompt or "African SME marketing visual").strip()[:400]

    if intent == "photo":
        craft = (
            "Photorealistic photograph, natural lighting, square 1:1 social crop, "
            "premium marketing look. Do not render readable text, letters, logos, or watermarks."
        )
    else:
        craft = (
            "Stylized marketing GRAPHIC / poster design (not a photo): bold shapes, "
            "clean composition, high contrast brand colors, square 1:1 social creative. "
            "Illustration or graphic-design look. Leave clear space for headline overlays; "
            "do not render tiny unreadable letters — prefer solid shapes and color blocks."
        )

    # User prompt first — models weight early tokens heavily
    return f"{user}. {craft}"


def _local_enhance(notes: str, *, intent: str) -> str:
    """Zero-token polish: keep the user's words, add a short craft suffix."""
    core = " ".join(notes.split()).strip()
    if not core:
        return core
    # Avoid stacking the same suffix repeatedly
    lower = core.lower()
    if intent == "photo":
        if "photoreal" in lower or "photograph" in lower:
            return core[:900]
        return f"{core}. Photorealistic, square 1:1, clean marketing photo."[:900]
    if any(w in lower for w in ("graphic", "poster", "illustration", "vector", "design")):
        return f"{core}. Square 1:1 social graphic, bold clear composition."[:900]
    return f"{core}. Stylized marketing graphic poster, square 1:1, bold clean design."[:900]


def _local_draft(*, base_prompt: str, intent: str, title: str | None) -> str:
    seed = (base_prompt or title or "African SME brand").strip()[:220]
    if intent == "photo":
        return (
            f"Photorealistic lifestyle photo for {seed}: warm natural light, "
            f"clear subject, shallow depth of field, square 1:1 social crop."
        )[:900]
    return (
        f"Bold marketing graphic poster for {seed}: strong focal shape, "
        f"high-contrast brand colors, clean layout, square 1:1 social creative."
    )[:900]


async def suggest_redesign_prompt(
    *,
    base_prompt: str,
    notes: str | None = None,
    title: str | None = None,
    source: str = "ai_generated",
    business_name: str | None = None,
    meta: dict | None = None,
    db=None,
) -> dict:
    """
    - If notes: ENHANCE that text (same meaning). Prefer local polish (0 tokens).
      Optional tiny LLM pass only when notes are very short/rough.
    - If empty: draft a starter the user can edit.
    """
    notes_clean = (notes or "").strip()
    intent = detect_intent(notes_clean or base_prompt, meta=meta)
    mode = "enhance" if notes_clean else "draft"

    if mode == "enhance":
        # Default: free local enhance — saves tokens and keeps the user's wording
        enhanced = _local_enhance(notes_clean, intent=intent)
        # Only spend LLM tokens when the note is very short (needs expansion help)
        if len(notes_clean) >= 40:
            return {
                "prompt": enhanced,
                "source": "local",
                "mode": mode,
                "intent": intent,
                "message": "Enhanced your prompt — edit if you want, then redesign.",
            }

        providers = await load_active_providers(db)
        if not providers:
            return {
                "prompt": enhanced,
                "source": "local",
                "mode": mode,
                "intent": intent,
                "message": "Enhanced your prompt — edit if you want, then redesign.",
            }

        try:
            # Tiny prompt = fewer tokens
            system = (
                "Enhance the user's image prompt. Keep their meaning. "
                "Do NOT invent a different scene. Return ONLY JSON."
            )
            user = f"""Enhance this prompt (keep intent, clarify wording, max 60 words):
{notes_clean}

Intent hint: {intent}
Return: {{"prompt":"...","intent":"graphic|photo"}}"""
            data = await complete_json(system=system, user=user, temperature=0.2, db=db)
            usage = data.pop("_usage", None)
            prompt = str(data.get("prompt") or "").strip()
            intent_out = str(data.get("intent") or intent).lower()
            if intent_out not in ("graphic", "photo"):
                intent_out = intent
            if not prompt:
                prompt = enhanced
            # Guard: if model drifted too far, fall back to local
            if notes_clean.lower()[:12] not in prompt.lower() and len(notes_clean) > 8:
                # Allow if most significant words still present
                words = [w for w in re.findall(r"[a-z0-9]+", notes_clean.lower()) if len(w) > 3]
                hits = sum(1 for w in words if w in prompt.lower())
                if words and hits < max(1, len(words) // 2):
                    prompt = enhanced
            return {
                "prompt": prompt[:900],
                "source": "llm",
                "mode": mode,
                "intent": intent_out,
                "usage": usage,
                "message": "Enhanced your prompt — edit if you want, then redesign.",
            }
        except LLMError:
            return {
                "prompt": enhanced,
                "source": "local",
                "mode": mode,
                "intent": intent,
                "message": "Enhanced your prompt — edit if you want, then redesign.",
            }

    # Draft mode (empty input)
    draft = _local_draft(base_prompt=base_prompt, intent=intent, title=title)
    providers = await load_active_providers(db)
    if not providers:
        return {
            "prompt": draft,
            "source": "local",
            "mode": mode,
            "intent": intent,
            "message": "Draft prompt ready — edit it, then redesign.",
        }

    try:
        system = "Write one short editable image prompt. Return ONLY JSON."
        user = f"""Draft a starter prompt the user can edit.
Business: {business_name or "SME"}
Asset: {title or "—"}
Seed: {(base_prompt or "")[:180] or "—"}
Prefer intent: {intent}
Max 45 words. Return: {{"prompt":"...","intent":"graphic|photo"}}"""
        data = await complete_json(system=system, user=user, temperature=0.4, db=db)
        usage = data.pop("_usage", None)
        prompt = str(data.get("prompt") or "").strip() or draft
        intent_out = str(data.get("intent") or intent).lower()
        if intent_out not in ("graphic", "photo"):
            intent_out = intent
        return {
            "prompt": prompt[:900],
            "source": "llm",
            "mode": mode,
            "intent": intent_out,
            "usage": usage,
            "message": "Draft prompt ready — edit it, then redesign.",
        }
    except LLMError:
        return {
            "prompt": draft,
            "source": "local",
            "mode": mode,
            "intent": intent,
            "message": "Draft prompt ready — edit it, then redesign.",
        }
