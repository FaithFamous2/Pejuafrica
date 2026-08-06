"""Transform an existing media asset based on user direction.

Keeps the source image as the subject (flyer / enhance / recolor / background),
analyzes the working image cheaply before generating, uses an image agent when
available, and draws spell-checked Neural Fabric text for flyer/graphic intents.
"""

from __future__ import annotations

import io
import logging
import re
from collections import Counter
from typing import Any

import httpx
from PIL import Image, ImageEnhance, ImageOps, ImageStat

from app.ai.llm import LLMError, complete_json, load_active_providers

logger = logging.getLogger(__name__)

TRANSFORM_INTENTS = (
    "flyer",
    "graphic",
    "enhance",
    "recolor",
    "bw",
    "background",
    "general",
)

OCCASIONS = (
    ("launch", r"\b(launch|grand\s*opening|opening|unveil)\b"),
    ("sale", r"\b(sale|discount|promo|offer|clearance|%|percent)\b"),
    ("weekend", r"\b(weekend|saturday|sunday)\b"),
    ("eid", r"\b(eid|ramadan|sallah)\b"),
    ("christmas", r"\b(christmas|xmas|festive|december)\b"),
    ("new_year", r"\b(new\s*year|january|nye)\b"),
    ("wedding", r"\b(wedding|bridal|engagement)\b"),
    ("birthday", r"\b(birthday|anniversary)\b"),
    ("independence", r"\b(independence|national\s*day|nigeria\s*day|ghana\s*day)\b"),
    ("product", r"\b(product|new\s*arrival|drop|collection)\b"),
    ("general", r"."),
)

INTENT_SUGGESTIONS = [
    {
        "id": "flyer",
        "label": "Make a flyer",
        "prompt": "Turn this into a bold marketing flyer for a product promo with a clear headline and CTA",
    },
    {
        "id": "flyer_sale",
        "label": "Sale flyer",
        "prompt": "Make a sale flyer from this image for a weekend discount promo",
    },
    {
        "id": "flyer_launch",
        "label": "Launch flyer",
        "prompt": "Make a grand opening / launch flyer from this image",
    },
    {
        "id": "graphic",
        "label": "Graphic design",
        "prompt": "Convert this into a clean social graphic design poster",
    },
    {
        "id": "enhance",
        "label": "Enhance quality",
        "prompt": "Enhance this image — sharper, richer color, keep the same subject",
    },
    {
        "id": "colorful",
        "label": "More colorful",
        "prompt": "Make this more colorful and vibrant while keeping the same subject",
    },
    {
        "id": "bw",
        "label": "Black & white",
        "prompt": "Convert this to a premium black and white look, keep the same subject",
    },
    {
        "id": "background",
        "label": "Change background",
        "prompt": "Keep the main subject and change the background to a clean studio backdrop",
    },
]

# Tiny local spelling / grammar fixes for common flyer mistakes (0 tokens)
COMMON_FIXES = {
    "recieve": "receive",
    "seperate": "separate",
    "occured": "occurred",
    "definately": "definitely",
    "tommorow": "tomorrow",
    "tommorrow": "tomorrow",
    "buisness": "business",
    "busines": "business",
    "opurtunity": "opportunity",
    "oportunity": "opportunity",
    "avaliable": "available",
    "availble": "available",
    "proffessional": "professional",
    "profesional": "professional",
    "sucess": "success",
    "succes": "success",
    "exculsive": "exclusive",
    "exclussive": "exclusive",
    "offical": "official",
    "greate": "great",
    "wonderfull": "wonderful",
    "beutiful": "beautiful",
    "beautifull": "beautiful",
    "lagosian": "Lagos",
    "shoping": "shopping",
    "dicount": "discount",
    "disount": "discount",
    "oppening": "opening",
    "oppen": "open",
    "lanch": "launch",
    "lauch": "launch",
    "celeberation": "celebration",
    "celebation": "celebration",
}


def detect_transform_intent(text: str | None) -> str:
    t = (text or "").lower()
    if re.search(r"\b(flyer|flyers|leaflet|handbill)\b", t):
        return "flyer"
    if re.search(r"\b(poster|graphic|graphics|design|banner|carousel)\b", t):
        return "graphic"
    if re.search(r"\b(black\s*and\s*white|b\s*&\s*w|grayscale|monochrome)\b", t):
        return "bw"
    if re.search(r"\b(background|backdrop|bg)\b", t):
        return "background"
    if re.search(r"\b(colorful|colourful|vibrant|saturat|recolor|recolour|white\s+and\s+black)\b", t):
        if re.search(r"\b(white\s+and\s+black|black\s+and\s+white)\b", t):
            return "bw"
        return "recolor"
    if re.search(r"\b(enhance|improve|sharpen|upscale|cleaner|better\s+quality)\b", t):
        return "enhance"
    return "general"


def detect_occasion(text: str | None) -> str:
    t = (text or "").lower()
    for name, pattern in OCCASIONS:
        if name == "general":
            continue
        if re.search(pattern, t, re.I):
            return name
    return "general"


def clean_overlay_text(value: str | None, *, max_len: int) -> str:
    """Normalize on-image copy — correct spacing, strip junk, apply local spelling fixes."""
    if not value:
        return ""
    text = str(value).replace("\u00a0", " ")
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"[\x00-\x1f\x7f]", "", text)
    text = text.replace(" ,", ",").replace(" .", ".")
    text = re.sub(r"[\"“”]+", "", text)
    # Local spelling fixes (word boundaries)
    words = []
    for w in text.split(" "):
        key = re.sub(r"[^a-zA-Z]", "", w).lower()
        if key in COMMON_FIXES:
            fixed = COMMON_FIXES[key]
            # preserve simple capitalization
            if w[:1].isupper():
                fixed = fixed[:1].upper() + fixed[1:]
            punct = re.sub(r"[a-zA-Z]", "", w)
            words.append(fixed + punct if punct and not w[-1:].isalnum() else fixed)
        else:
            words.append(w)
    text = " ".join(words)
    return text[:max_len].strip()


async def fetch_image_bytes(url: str) -> bytes:
    async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
        res = await client.get(url)
        if res.status_code >= 400:
            raise RuntimeError(f"Could not download source image ({res.status_code})")
        data = res.content
        if not data:
            raise RuntimeError("Source image was empty")
        return data


def analyze_image_brief(
    image_bytes: bytes,
    *,
    meta: dict | None = None,
) -> dict[str, Any]:
    """Cheap local analysis of the working image — no LLM tokens."""
    meta = meta or {}
    brief: dict[str, Any] = {
        "palette": "unknown",
        "brightness": "medium",
        "mood": "neutral",
        "prior_intent": meta.get("intent"),
        "prior_headline": (meta.get("overlay") or {}).get("headline")
        if isinstance(meta.get("overlay"), dict)
        else meta.get("headline"),
        "prior_user_prompt": (meta.get("user_prompt") or "")[:160] or None,
    }
    try:
        img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        img = ImageOps.exif_transpose(img)
        small = img.resize((64, 64), Image.Resampling.BILINEAR)
        stat = ImageStat.Stat(small)
        avg = sum(stat.mean) / 3.0
        brief["brightness"] = "bright" if avg > 170 else "dark" if avg < 85 else "medium"
        # Sample colors
        colors = list(small.getdata())
        buckets: Counter[str] = Counter()
        for r, g, b in colors:
            if max(r, g, b) - min(r, g, b) < 28:
                buckets["neutral"] += 1
            elif r > g + 25 and r > b + 25:
                buckets["warm-red"] += 1
            elif g > r + 20 and g > b + 15:
                buckets["green"] += 1
            elif b > r + 20 and b > g + 15:
                buckets["cool-blue"] += 1
            elif r > 180 and g > 140 and b < 100:
                buckets["gold"] += 1
            else:
                buckets["mixed"] += 1
        top = [c for c, _ in buckets.most_common(2)]
        brief["palette"] = "+".join(top) if top else "mixed"
        if brief["brightness"] == "bright" and "gold" in top:
            brief["mood"] = "festive"
        elif "green" in top:
            brief["mood"] = "fresh"
        elif brief["brightness"] == "dark":
            brief["mood"] = "dramatic"
        else:
            brief["mood"] = "clean"
        brief["size"] = f"{img.width}x{img.height}"
    except Exception as exc:
        logger.warning("Image brief failed: %s", exc)
    return brief


def brief_to_prompt_line(brief: dict[str, Any]) -> str:
    parts = [
        f"palette {brief.get('palette')}",
        f"{brief.get('brightness')} lighting",
        f"{brief.get('mood')} mood",
    ]
    if brief.get("prior_intent"):
        parts.append(f"previous intent was {brief['prior_intent']}")
    if brief.get("prior_headline"):
        parts.append(f"previous headline “{brief['prior_headline']}”")
    if brief.get("prior_user_prompt"):
        parts.append(f"earlier request: {brief['prior_user_prompt']}")
    return "; ".join(parts)


def local_transform(image_bytes: bytes, *, intent: str, direction: str = "") -> bytes:
    """Deterministic PIL transforms that keep the same photo subject."""
    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    img = ImageOps.exif_transpose(img)
    side = min(img.size)
    left = (img.width - side) // 2
    top = (img.height - side) // 2
    img = img.crop((left, top, left + side, top + side)).resize((1080, 1080), Image.Resampling.LANCZOS)

    d = direction.lower()
    if intent == "bw" or ("black" in d and "white" in d):
        img = ImageOps.grayscale(img).convert("RGB")
        img = ImageEnhance.Contrast(img).enhance(1.15)
    elif intent == "recolor" or "color" in d or "vibrant" in d:
        img = ImageEnhance.Color(img).enhance(1.45)
        img = ImageEnhance.Contrast(img).enhance(1.08)
        img = ImageEnhance.Sharpness(img).enhance(1.15)
    elif intent == "enhance":
        img = ImageEnhance.Contrast(img).enhance(1.12)
        img = ImageEnhance.Color(img).enhance(1.1)
        img = ImageEnhance.Sharpness(img).enhance(1.25)
        img = ImageEnhance.Brightness(img).enhance(1.03)
    else:
        img = ImageEnhance.Sharpness(img).enhance(1.1)

    out = io.BytesIO()
    img.save(out, format="PNG", optimize=True)
    return out.getvalue()


def build_image_edit_prompt(
    *,
    user_prompt: str,
    intent: str,
    occasion: str | None = None,
    image_brief: str | None = None,
) -> str:
    """Instruction for multimodal edit — keep subject, apply direction."""
    user = (user_prompt or "").strip()[:700]
    occ = f" Occasion: {occasion}." if occasion and occasion != "general" else ""
    brief = f" Working image analysis: {image_brief}." if image_brief else ""
    keep = (
        "CRITICAL: edit THIS exact photo — keep the same main subject and recognisable details. "
        "Do not invent a different scene or person."
    )
    if intent == "flyer":
        return (
            f"{keep} Restyle into a marketing FLYER background for African SME social posts.{occ}{brief} "
            f"Direction: {user}. Punchy poster look, clear space at bottom for headline overlay. "
            "Do NOT render any text, letters, numbers, or logos."
        )
    if intent == "graphic":
        return (
            f"{keep} Restyle as a clean social GRAPHIC design.{occ}{brief} "
            f"Direction: {user}. Bold shapes and brand color. "
            "Do NOT render text or letters."
        )
    if intent == "background":
        return (
            f"{keep} Only change the background.{brief} Direction: {user}. No text or letters."
        )
    if intent == "bw":
        return f"{keep} Premium black and white.{brief} {user}. No text."
    if intent == "recolor":
        return f"{keep} Recolor as directed.{brief} Direction: {user}. No text."
    if intent == "enhance":
        return f"{keep} Enhance quality — sharper, cleaner, richer.{brief} {user}. No text."
    return f"{keep} Direction: {user}.{brief} No text or letters."


async def plan_overlay_copy(
    *,
    user_prompt: str,
    business_name: str | None,
    title: str | None,
    intent: str,
    occasion: str | None = None,
    image_brief: str | None = None,
    db=None,
) -> dict[str, Any]:
    """Write short, spell-perfect on-image copy for flyer/graphic, then proofread."""
    occasion = occasion or detect_occasion(user_prompt)
    fallback_cta = {
        "sale": "Shop the sale",
        "launch": "Visit us today",
        "weekend": "This weekend",
        "eid": "Celebrate with us",
        "christmas": "Shop gifts",
        "new_year": "Start fresh",
        "wedding": "Book now",
        "birthday": "Celebrate",
        "product": "Order now",
    }.get(occasion or "", "Shop now")

    fallback = {
        "headline": clean_overlay_text(title or business_name or "Special offer", max_len=42),
        "subline": clean_overlay_text(
            (user_prompt or "Made for you").split(".")[0], max_len=72
        ),
        "cta": fallback_cta,
        "occasion": occasion,
        "source": "heuristic",
    }
    quoted = re.findall(r"[\"“']([^\"”']{3,60})[\"”']", user_prompt or "")
    if quoted:
        fallback["headline"] = clean_overlay_text(quoted[0], max_len=42)

    providers = await load_active_providers(db)
    if not providers:
        return proofread_overlay_fields(fallback)

    try:
        # Tiny, strict prompt — fewer tokens, better spelling
        system = (
            "You write ON-IMAGE flyer copy. Perfect UK/US English spelling. "
            "Return ONLY JSON. Never invent misspellings."
        )
        user = f"""Business: {business_name or "SME"}
Occasion: {occasion}
Intent: {intent}
Image context: {(image_brief or "—")[:180]}
User wants:
{(user_prompt or "")[:320]}

JSON only:
{{"headline":"max 5 words","subline":"max 10 words","cta":"2-4 words"}}
Rules: correct spelling; no hashtags; no emojis; match the occasion; African SME tone."""
        data = await complete_json(system=system, user=user, temperature=0.15, db=db)
        usage = data.pop("_usage", None)
        draft = {
            "headline": clean_overlay_text(str(data.get("headline") or fallback["headline"]), max_len=42),
            "subline": clean_overlay_text(str(data.get("subline") or fallback["subline"]), max_len=72),
            "cta": clean_overlay_text(str(data.get("cta") or fallback_cta), max_len=28) or fallback_cta,
            "occasion": occasion,
            "source": "llm",
            "usage": usage,
        }
        # Second cheap proofread pass — only if LLM providers exist
        proofed = await _llm_proofread_copy(draft, db=db)
        return proofread_overlay_fields(proofed)
    except LLMError:
        return proofread_overlay_fields(fallback)


async def _llm_proofread_copy(copy: dict[str, Any], *, db=None) -> dict[str, Any]:
    """Dedicated spelling/grammar check — tiny JSON, temperature 0."""
    providers = await load_active_providers(db)
    if not providers:
        return copy
    try:
        system = "Proofread flyer text. Fix spelling and grammar only. Keep meaning. JSON only."
        user = f"""Proofread:
headline: {copy.get("headline")}
subline: {copy.get("subline")}
cta: {copy.get("cta")}

Return: {{"headline":"...","subline":"...","cta":"..."}}
If already correct, return the same words."""
        data = await complete_json(system=system, user=user, temperature=0.0, db=db)
        usage2 = data.pop("_usage", None)
        out = dict(copy)
        for key in ("headline", "subline", "cta"):
            if data.get(key):
                out[key] = str(data[key]).strip()
        # Merge token usage
        if usage2 and out.get("usage"):
            u = out["usage"]
            for k in ("prompt_tokens", "completion_tokens", "total_tokens"):
                u[k] = int(u.get(k) or 0) + int(usage2.get(k) or 0)
        elif usage2:
            out["usage"] = usage2
        out["proofread"] = True
        return out
    except LLMError:
        return copy


def proofread_overlay_fields(copy: dict[str, Any]) -> dict[str, Any]:
    """Final local proofread pass before drawing text."""
    out = dict(copy)
    for key, limit in (("headline", 42), ("subline", 72), ("cta", 28)):
        if out.get(key):
            out[key] = clean_overlay_text(str(out[key]), max_len=limit)
    h = out.get("headline") or ""
    if h and h == h.lower() and len(h.split()) <= 6:
        out["headline"] = h.title()
    # Drop empty CTA
    if out.get("cta") and len(str(out["cta"]).strip()) < 2:
        out["cta"] = None
    return out
