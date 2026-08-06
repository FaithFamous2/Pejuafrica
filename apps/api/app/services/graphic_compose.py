"""Compose marketing graphics: AI background + Neural Fabric text overlay.

Image models paint the scene (no letters). Correct copy is drawn with fonts
so spelling stays reliable without burning image-model tokens on text.
"""

from __future__ import annotations

import io
import logging
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

logger = logging.getLogger(__name__)

ASSETS_DIR = Path(__file__).resolve().parent.parent / "assets" / "fonts"
SIZE = 1080


def _load_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        ASSETS_DIR / "Geist-Regular.ttf",
        Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf"),
        Path("/System/Library/Fonts/Supplemental/Arial.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
    ]
    for path in candidates:
        if path.is_file():
            try:
                return ImageFont.truetype(str(path), size=size)
            except OSError:
                continue
    return ImageFont.load_default()


def _wrap(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.ImageFont, max_width: int) -> list[str]:
    words = (text or "").strip().split()
    if not words:
        return []
    lines: list[str] = []
    current = words[0]
    for word in words[1:]:
        trial = f"{current} {word}"
        bbox = draw.textbbox((0, 0), trial, font=font)
        if bbox[2] - bbox[0] <= max_width:
            current = trial
        else:
            lines.append(current)
            current = word
    lines.append(current)
    return lines


def compose_marketing_graphic(
    *,
    background: bytes,
    business_name: str,
    headline: str,
    subline: str | None = None,
    cta: str | None = None,
    role: str = "cover",
) -> bytes:
    """
    Overlay correctly spelled Neural Fabric copy onto an AI background image.
    Returns PNG bytes (1080×1080).
    """
    try:
        base = Image.open(io.BytesIO(background)).convert("RGBA")
    except Exception:
        base = Image.new("RGBA", (SIZE, SIZE), (18, 42, 32, 255))

    base = base.resize((SIZE, SIZE), Image.Resampling.LANCZOS)

    overlay = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    # Soft vignette / bottom panel for readable type
    for y in range(SIZE // 2, SIZE):
        alpha = int(40 + (y - SIZE // 2) / (SIZE // 2) * 170)
        draw.rectangle([(0, y), (SIZE, y + 1)], fill=(8, 18, 14, alpha))

    # Top brand chip
    brand = (business_name or "PejuAfrica").strip()[:36]
    brand_font = _load_font(28)
    pad = 48
    chip_w = draw.textbbox((0, 0), brand.upper(), font=brand_font)[2] + 36
    chip_h = 52
    draw.rounded_rectangle(
        [(pad, pad), (pad + chip_w, pad + chip_h)],
        radius=26,
        fill=(255, 255, 255, 220),
    )
    draw.text((pad + 18, pad + 12), brand.upper(), font=brand_font, fill=(18, 42, 32, 255))

    headline_font = _load_font(64 if role == "cover" else 56)
    sub_font = _load_font(34)
    cta_font = _load_font(30)

    max_text_w = SIZE - pad * 2
    headline_lines = _wrap(draw, (headline or "").strip()[:90], headline_font, max_text_w)[:3]
    sub_lines = _wrap(draw, (subline or "").strip()[:140], sub_font, max_text_w)[:3] if subline else []

    # Stack from bottom
    y = SIZE - pad
    if cta and cta.strip():
        cta_text = cta.strip()[:40]
        cta_bbox = draw.textbbox((0, 0), cta_text, font=cta_font)
        cta_w = cta_bbox[2] - cta_bbox[0] + 48
        cta_h = 56
        y -= cta_h
        draw.rounded_rectangle(
            [(pad, y), (pad + cta_w, y + cta_h)],
            radius=28,
            fill=(61, 214, 140, 255),
        )
        draw.text((pad + 24, y + 14), cta_text, font=cta_font, fill=(8, 24, 16, 255))
        y -= 28

    for line in reversed(sub_lines):
        bbox = draw.textbbox((0, 0), line, font=sub_font)
        y -= bbox[3] - bbox[1] + 10
        draw.text((pad, y), line, font=sub_font, fill=(230, 245, 236, 240))

    if sub_lines:
        y -= 18

    for line in reversed(headline_lines):
        bbox = draw.textbbox((0, 0), line, font=headline_font)
        y -= bbox[3] - bbox[1] + 8
        # subtle shadow
        draw.text((pad + 2, y + 2), line, font=headline_font, fill=(0, 0, 0, 120))
        draw.text((pad, y), line, font=headline_font, fill=(255, 255, 255, 255))

    composed = Image.alpha_composite(base, overlay).convert("RGB")
    out = io.BytesIO()
    composed.save(out, format="PNG", optimize=True)
    return out.getvalue()


def visual_only_prompt(
    *,
    business_name: str,
    theme: str,
    visual_focus: str,
    platform: str,
    role: str,
    style_hint: str | None = None,
) -> str:
    """Prompt for image models — scenery only, never letters."""
    scene = (visual_focus or theme or "vibrant marketplace").strip()[:260]
    style = (style_hint or "").strip()
    if not style:
        style = (
            "cinematic African SME marketing photo, rich color, clean composition, "
            "square 1:1, premium social ad background, shallow depth of field"
        )
    return (
        f"Photorealistic {platform} background for {business_name}. "
        f"Theme mood: {theme}. Slide: {role}. "
        f"Primary visual direction: {style}. "
        f"Scene details: {scene}. "
        "IMPORTANT: absolutely no text, no letters, no words, no numbers, "
        "no logos, no watermarks, no typography of any kind."
    )
