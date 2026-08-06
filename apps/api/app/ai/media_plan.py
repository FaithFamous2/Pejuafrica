"""Decide how many graphics a post needs (1–5) and what each slide should convey."""

from __future__ import annotations

from app.ai.llm import LLMError, complete_json, load_active_providers


ROLES = ("cover", "quote", "product", "tip", "cta")


def heuristic_media_plan(
    *,
    theme: str,
    caption: str,
    cta: str | None,
    platform: str,
) -> dict:
    """Fallback when no LLM: pick count from content shape."""
    text = f"{theme} {caption} {cta or ''}".lower()
    slides: list[dict] = []

    # Always a cover
    slides.append(
        {
            "role": "cover",
            "title": (theme or "Today")[:48],
            "subline": (caption or theme or "")[:90],
            "focus": f"Atmospheric visual for: {(caption or theme or '')[:120]}",
            "cta": cta,
        }
    )

    # Quote / hook if caption is long
    if len(caption or "") > 180:
        snippet = (caption or "").strip().split(".")[0][:120]
        slides.append(
            {
                "role": "quote",
                "title": "Key message",
                "subline": snippet or theme,
                "focus": f"Clean editorial photo mood for: {snippet or theme}",
                "cta": None,
            }
        )

    # Tip / value if educational cues
    if any(w in text for w in ("tip", "how to", "why", "guide", "learn", "step")):
        slides.append(
            {
                "role": "tip",
                "title": "Quick tip",
                "subline": (caption or theme)[:90],
                "focus": f"Helpful lifestyle scene illustrating: {(caption or theme)[:100]}",
                "cta": None,
            }
        )

    # Product / offer cues
    if any(w in text for w in ("order", "buy", "sale", "offer", "deal", "menu", "book", "shop")):
        slides.append(
            {
                "role": "product",
                "title": "What we offer",
                "subline": (caption or theme)[:90],
                "focus": f"Product/service showcase scene: {(caption or theme)[:100]}",
                "cta": cta,
            }
        )

    # CTA slide when we have a call-to-action and room
    if cta and len(slides) < 5:
        slides.append(
            {
                "role": "cta",
                "title": "Take action",
                "subline": cta,
                "focus": f"Inviting action-oriented scene for: {cta}",
                "cta": cta,
            }
        )

    # Cap 1–5; prefer 2 for Instagram carousels when only cover exists and caption is meaty
    if len(slides) == 1 and len(caption or "") > 120 and (platform or "").lower() in (
        "instagram",
        "facebook",
        "linkedin",
    ):
        slides.append(
            {
                "role": "quote",
                "title": "Details",
                "subline": (caption or "")[:90],
                "focus": f"Supporting visual for: {(caption or '')[:120]}",
                "cta": cta,
            }
        )

    slides = slides[:5]
    return {
        "count": len(slides),
        "reason": "Heuristic plan based on caption length, offer cues, and platform.",
        "slides": slides,
        "source": "heuristic",
    }


def _apply_preferred_count(
    slides: list[dict],
    *,
    preferred_count: int,
    theme: str,
    caption: str,
    cta: str | None,
) -> list[dict]:
    slides = list(slides)
    while len(slides) < preferred_count:
        slides.append(
            {
                "role": ROLES[len(slides) % len(ROLES)],
                "title": theme[:48],
                "subline": (caption or theme)[:90],
                "focus": f"Marketing scene for: {(caption or theme)[:120]}",
                "cta": cta,
            }
        )
    return slides[:preferred_count]


def apply_user_overlay_text(slides: list[dict], on_image_text: str | None) -> list[dict]:
    """Honor optional user on-image text: line1=headline, line2=subline, line3=cta."""
    if not on_image_text or not slides:
        return slides
    lines = [ln.strip() for ln in on_image_text.splitlines() if ln.strip()]
    if not lines:
        # single paragraph — use as headline
        text = on_image_text.strip()
        if not text:
            return slides
        lines = [text[:48]]
    out = [dict(s) for s in slides]
    out[0]["title"] = lines[0][:48]
    if len(lines) > 1:
        out[0]["subline"] = lines[1][:120]
    if len(lines) > 2:
        out[0]["cta"] = lines[2][:40]
    # Cascade headline vibe to later slides lightly if user only gave one line
    if len(lines) == 1 and len(out) > 1:
        for slide in out[1:]:
            if not slide.get("title"):
                slide["title"] = lines[0][:48]
    return out


async def plan_post_graphics(
    *,
    theme: str,
    caption: str,
    cta: str | None,
    platform: str,
    graphic_prompt: str | None = None,
    business_name: str | None = None,
    preferred_count: int | None = None,
    user_overlay_text: str | None = None,
    user_image_direction: str | None = None,
    db=None,
) -> dict:
    """Return {count, reason, slides[{role,title,subline,focus,cta}], source}."""
    fallback = heuristic_media_plan(theme=theme, caption=caption, cta=cta, platform=platform)
    if preferred_count:
        preferred_count = max(1, min(5, preferred_count))
        fallback["slides"] = _apply_preferred_count(
            fallback["slides"],
            preferred_count=preferred_count,
            theme=theme,
            caption=caption,
            cta=cta,
        )
        fallback["count"] = preferred_count
    fallback["slides"] = apply_user_overlay_text(fallback["slides"], user_overlay_text)
    if user_image_direction:
        for slide in fallback["slides"]:
            slide["focus"] = f"{user_image_direction.strip()[:160]}. {slide.get('focus') or ''}"[:200]

    providers = await load_active_providers(db)
    if not providers:
        return fallback

    try:
        system = (
            "You are PejuAfrica media art director for African SME social posts. "
            "Decide branded graphics (1–5). Neural Fabric writes exact on-image copy; "
            "image models only paint backgrounds. Return ONLY valid JSON."
        )
        user = f"""
Business: {business_name or "SME"}
Platform: {platform}
Theme: {theme}
Caption:
{caption}
CTA: {cta or "—"}
Existing graphic prompt: {graphic_prompt or "—"}
User on-image text (OPTIONAL — if set, honor closely for title/subline/cta):
{user_overlay_text or "—"}
User image / visual direction (OPTIONAL — steer focus/scene, never render as letters):
{user_image_direction or "—"}
Preferred count (MUST honor if set): {preferred_count or "decide yourself"}

Return JSON:
{{
  "count": 1-5,
  "reason": "one sentence why this many assets",
  "slides": [
    {{
      "role": "cover|quote|product|tip|cta",
      "title": "exact headline ON the image, max 6 words, perfect spelling",
      "subline": "exact supporting line ON the image, max 12 words, perfect spelling",
      "focus": "visual scene only for the image model — no words, describe photo/illustration",
      "cta": "exact short CTA button text (2-4 words) or null"
    }}
  ]
}}

Rules:
- count must match slides length, between 1 and 5.
- If Preferred count is a number, count MUST equal that number.
- Prefer carousels (2–4) for Instagram when caption has multiple beats.
- Prefer 1 strong graphic for short WhatsApp-style posts.
- Always include a cover-like first slide.
- title/subline/cta must be customer-facing copy with correct spelling (shown as real text overlay).
- If User on-image text is provided, the FIRST slide title/subline/cta MUST reflect it (line1=title, line2=subline, line3=cta when multi-line).
- If User image direction is provided, weave it into every slide's focus scene.
- focus must NEVER include text/letters — only the visual scene.
"""
        data = await complete_json(system=system, user=user, temperature=0.4, db=db)
        usage = data.pop("_usage", None)
        slides_raw = data.get("slides") if isinstance(data.get("slides"), list) else []
        slides: list[dict] = []
        for raw in slides_raw[:5]:
            if not isinstance(raw, dict):
                continue
            role = str(raw.get("role") or "cover").lower()
            if role not in ROLES:
                role = "cover"
            title = str(raw.get("title") or theme)[:48]
            subline = str(raw.get("subline") or raw.get("focus") or caption or theme)[:120]
            focus = str(raw.get("focus") or caption or theme)[:200]
            slides.append(
                {
                    "role": role,
                    "title": title,
                    "subline": subline,
                    "focus": focus,
                    "cta": (str(raw["cta"])[:40] if raw.get("cta") else None),
                }
            )
        if not slides:
            return {**fallback, "usage": usage}
        if preferred_count:
            slides = _apply_preferred_count(
                slides,
                preferred_count=preferred_count,
                theme=theme,
                caption=caption,
                cta=cta,
            )
        slides = apply_user_overlay_text(slides, user_overlay_text)
        if user_image_direction:
            direction = user_image_direction.strip()[:160]
            for slide in slides:
                focus = str(slide.get("focus") or "")
                if direction.lower() not in focus.lower():
                    slide["focus"] = f"{direction}. {focus}".strip()[:200]
        return {
            "count": len(slides),
            "reason": str(data.get("reason") or "AI media plan"),
            "slides": slides,
            "source": "llm",
            "usage": usage,
        }
    except LLMError:
        return fallback


def _heuristic_graphic_direction(
    *,
    theme: str,
    caption: str,
    cta: str | None,
    graphic_prompt: str | None,
    notes: str | None,
    mode: str,
) -> dict:
    headline = (theme or "Today")[:48]
    subline = (caption or theme or "")[:90]
    if notes and notes.strip():
        # Prefer user notes as the seed for overlay
        lines = [ln.strip() for ln in notes.splitlines() if ln.strip()]
        if lines:
            headline = lines[0][:48]
            if len(lines) > 1:
                subline = lines[1][:120]
    on_image = f"{headline}\n{subline}"
    if cta:
        on_image = f"{on_image}\n{cta.strip()[:40]}"
    image_prompt = (
        (notes or graphic_prompt or "").strip()
        or f"Cinematic African SME scene for {theme}: {(caption or theme)[:140]}, rich color, square social ad background, no text"
    )
    if mode == "text":
        return {"on_image_text": on_image, "image_prompt": None, "source": "heuristic"}
    if mode == "image":
        return {"on_image_text": None, "image_prompt": image_prompt[:500], "source": "heuristic"}
    return {
        "on_image_text": on_image,
        "image_prompt": image_prompt[:500],
        "source": "heuristic",
    }


async def suggest_graphic_direction(
    *,
    theme: str,
    caption: str,
    cta: str | None,
    platform: str,
    graphic_prompt: str | None = None,
    business_name: str | None = None,
    notes: str | None = None,
    mode: str = "both",
    db=None,
) -> dict:
    """Suggest optional on-image text and/or an image prompt from post content + user notes."""
    mode = mode if mode in ("text", "image", "both") else "both"
    fallback = _heuristic_graphic_direction(
        theme=theme,
        caption=caption,
        cta=cta,
        graphic_prompt=graphic_prompt,
        notes=notes,
        mode=mode,
    )

    providers = await load_active_providers(db)
    if not providers:
        return fallback

    try:
        system = (
            "You are PejuAfrica creative director. Write short, punchy social graphic copy "
            "and visual prompts for African SME brands. Return ONLY valid JSON."
        )
        user = f"""
Business: {business_name or "SME"}
Platform: {platform}
Theme: {theme}
Caption:
{caption}
CTA: {cta or "—"}
Existing graphic prompt: {graphic_prompt or "—"}
User notes / direction (optional seed — refine and improve):
{notes or "—"}
Mode: {mode}

Return JSON:
{{
  "on_image_text": "multiline string: line1 headline (max 6 words), line2 subline (max 12 words), optional line3 CTA (2-4 words). Perfect spelling. Or null if mode=image",
  "image_prompt": "one vivid visual scene for an image model — no letters/words/logos — mood, setting, lighting, subjects. Or null if mode=text"
}}

Rules:
- If mode is text: fill on_image_text, set image_prompt to null.
- If mode is image: fill image_prompt, set on_image_text to null.
- If mode is both: fill both.
- on_image_text must be customer-facing and spell-perfect; prefer punchy over long.
- image_prompt must NEVER ask for text, letters, watermarks, or logos in the image.
- Ground everything in the caption/theme; improve the user's notes rather than ignoring them.
"""
        data = await complete_json(system=system, user=user, temperature=0.55, db=db)
        usage = data.pop("_usage", None)
        on_image = data.get("on_image_text")
        image_prompt = data.get("image_prompt")
        result: dict = {"source": "llm", "usage": usage}
        if mode in ("text", "both"):
            result["on_image_text"] = (
                str(on_image).strip()[:500] if on_image else fallback.get("on_image_text")
            )
        else:
            result["on_image_text"] = None
        if mode in ("image", "both"):
            result["image_prompt"] = (
                str(image_prompt).strip()[:500] if image_prompt else fallback.get("image_prompt")
            )
        else:
            result["image_prompt"] = None
        return result
    except LLMError:
        return fallback
