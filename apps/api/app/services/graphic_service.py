"""Branded post graphics — 16 selectable templates + optional embedded image."""

from __future__ import annotations

import html
import re
from typing import Any


GRAPHIC_TEMPLATES: list[dict[str, Any]] = [
    {
        "id": "forest_gradient",
        "name": "Forest Gradient",
        "category": "classic",
        "hint": "Deep green fade with lime accents",
        "preview": {"bg": "#083526", "accent": "#d6f56a", "mid": "#117a4f"},
        "supports_image": True,
    },
    {
        "id": "bold_split",
        "name": "Bold Split",
        "category": "layout",
        "hint": "Half panel color, half copy",
        "preview": {"bg": "#0c1f17", "accent": "#d6f56a", "mid": "#1a4d35"},
        "supports_image": True,
    },
    {
        "id": "centered_quote",
        "name": "Centered Quote",
        "category": "typography",
        "hint": "Big quote marks, centered message",
        "preview": {"bg": "#1a2e0f", "accent": "#f0e6c8", "mid": "#0c3d2e"},
        "supports_image": False,
    },
    {
        "id": "poster_stack",
        "name": "Poster Stack",
        "category": "layout",
        "hint": "Stacked bands — title, body, CTA",
        "preview": {"bg": "#101820", "accent": "#ffd18a", "mid": "#243447"},
        "supports_image": True,
    },
    {
        "id": "soft_cream",
        "name": "Soft Cream",
        "category": "light",
        "hint": "Warm cream background, dark type",
        "preview": {"bg": "#f6f0e4", "accent": "#117a4f", "mid": "#e8dcc4"},
        "supports_image": True,
    },
    {
        "id": "night_neon",
        "name": "Night Neon",
        "category": "bold",
        "hint": "Dark canvas with neon outline frame",
        "preview": {"bg": "#0a0f14", "accent": "#5dffb0", "mid": "#15202b"},
        "supports_image": False,
    },
    {
        "id": "marketplace",
        "name": "Marketplace",
        "category": "commerce",
        "hint": "Product image area + offer strip",
        "preview": {"bg": "#146b48", "accent": "#9ee7c4", "mid": "#0a2f22"},
        "supports_image": True,
    },
    {
        "id": "story_frame",
        "name": "Story Frame",
        "category": "social",
        "hint": "Top label bar + bottom CTA dock",
        "preview": {"bg": "#0c2740", "accent": "#c8e7ff", "mid": "#1a4d6e"},
        "supports_image": True,
    },
    {
        "id": "circular_focus",
        "name": "Circular Focus",
        "category": "photo",
        "hint": "Round image window with brand ring",
        "preview": {"bg": "#1e1430", "accent": "#f5c6ff", "mid": "#3a2458"},
        "supports_image": True,
    },
    {
        "id": "diagonal_slash",
        "name": "Diagonal Slash",
        "category": "layout",
        "hint": "Angled color slash across the card",
        "preview": {"bg": "#111827", "accent": "#fbbf24", "mid": "#1f2937"},
        "supports_image": False,
    },
    {
        "id": "minimal_type",
        "name": "Minimal Type",
        "category": "typography",
        "hint": "Lots of whitespace, bold headline",
        "preview": {"bg": "#fafafa", "accent": "#111827", "mid": "#e5e7eb"},
        "supports_image": False,
    },
    {
        "id": "festivity_burst",
        "name": "Festivity Burst",
        "category": "celebration",
        "hint": "Confetti circles for launches & promos",
        "preview": {"bg": "#7a1f2b", "accent": "#ffd18a", "mid": "#a83240"},
        "supports_image": True,
    },
    {
        "id": "newspaper_band",
        "name": "Newspaper Band",
        "category": "editorial",
        "hint": "Editorial header rule + serif feel",
        "preview": {"bg": "#f3efe6", "accent": "#1a1a1a", "mid": "#ddd5c4"},
        "supports_image": False,
    },
    {
        "id": "duotone_block",
        "name": "Duotone Block",
        "category": "bold",
        "hint": "Two solid color blocks, high contrast",
        "preview": {"bg": "#0f766e", "accent": "#fef3c7", "mid": "#115e59"},
        "supports_image": True,
    },
    {
        "id": "badge_ribbon",
        "name": "Badge Ribbon",
        "category": "commerce",
        "hint": "Corner ribbon badge + clean body",
        "preview": {"bg": "#1e3a5f", "accent": "#fca5a5", "mid": "#254a75"},
        "supports_image": True,
    },
    {
        "id": "horizon_band",
        "name": "Horizon Band",
        "category": "classic",
        "hint": "Wide mid band for caption, sky/ground colors",
        "preview": {"bg": "#0ea5e9", "accent": "#ffffff", "mid": "#0369a1"},
        "supports_image": True,
    },
]

TEMPLATE_BY_ID = {t["id"]: t for t in GRAPHIC_TEMPLATES}
DEFAULT_TEMPLATE_ID = "forest_gradient"


def list_graphic_templates() -> list[dict[str, Any]]:
    return list(GRAPHIC_TEMPLATES)


def resolve_template_id(template_id: str | None) -> str:
    if template_id and template_id in TEMPLATE_BY_ID:
        return template_id
    return DEFAULT_TEMPLATE_ID


def build_post_graphic_svg(
    *,
    business_name: str,
    theme: str,
    caption: str,
    cta: str | None = None,
    platform: str = "instagram",
    role: str = "cover",
    title_override: str | None = None,
    focus_override: str | None = None,
    template_id: str | None = None,
    image_url: str | None = None,
) -> bytes:
    """Render a square SVG card using a named template."""
    tid = resolve_template_id(template_id)
    tpl = TEMPLATE_BY_ID[tid]
    colors = tpl["preview"]
    accent, deep, mid = colors["accent"], colors["bg"], colors["mid"]

    title = html.escape((title_override or theme or "PejuAfrica")[:48])
    brand = html.escape((business_name or "PejuAfrica")[:40])
    body = html.escape(_clip(focus_override or caption or "", 220))
    cta_text = html.escape((cta or "Learn more")[:60])
    plat = html.escape((platform or "social").title()[:20])
    role_label = html.escape((role or "cover").upper()[:12])
    img = html.escape(image_url) if image_url else None
    use_image = bool(img and tpl.get("supports_image"))

    builders = {
        "forest_gradient": _tpl_forest,
        "bold_split": _tpl_bold_split,
        "centered_quote": _tpl_centered_quote,
        "poster_stack": _tpl_poster_stack,
        "soft_cream": _tpl_soft_cream,
        "night_neon": _tpl_night_neon,
        "marketplace": _tpl_marketplace,
        "story_frame": _tpl_story_frame,
        "circular_focus": _tpl_circular_focus,
        "diagonal_slash": _tpl_diagonal_slash,
        "minimal_type": _tpl_minimal_type,
        "festivity_burst": _tpl_festivity,
        "newspaper_band": _tpl_newspaper,
        "duotone_block": _tpl_duotone,
        "badge_ribbon": _tpl_badge_ribbon,
        "horizon_band": _tpl_horizon,
    }
    builder = builders.get(tid, _tpl_forest)
    svg = builder(
        accent=accent,
        deep=deep,
        mid=mid,
        title=title,
        brand=brand,
        body=body,
        cta_text=cta_text,
        plat=plat,
        role_label=role_label,
        image_url=img if use_image else None,
    )
    return svg.encode("utf-8")


def _clip(text: str, n: int) -> str:
    cleaned = re.sub(r"\s+", " ", text).strip()
    if len(cleaned) <= n:
        return cleaned
    return cleaned[: n - 1].rstrip() + "…"


def _fo(x: int, y: int, w: int, h: int, text: str, color: str, size: int = 34) -> str:
    return f"""
  <foreignObject x="{x}" y="{y}" width="{w}" height="{h}">
    <div xmlns="http://www.w3.org/1999/xhtml" style="color:{color};font-family:Arial,Helvetica,sans-serif;font-size:{size}px;line-height:1.4;font-weight:500;">
      {text}
    </div>
  </foreignObject>"""


def _img_rect(url: str, x: int, y: int, w: int, h: int, rx: int = 24) -> str:
    return f"""
  <clipPath id="imgclip"><rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}"/></clipPath>
  <image href="{url}" x="{x}" y="{y}" width="{w}" height="{h}" preserveAspectRatio="xMidYMid slice" clip-path="url(#imgclip)"/>"""


def _tpl_forest(**k: str) -> str:
    img = _img_rect(k["image_url"], 72, 300, 936, 320, 28) if k.get("image_url") else ""
    body_y = 640 if k.get("image_url") else 320
    body_h = 180 if k.get("image_url") else 480
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1080" height="1080" viewBox="0 0 1080 1080">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="{k['deep']}"/><stop offset="55%" stop-color="{k['mid']}"/><stop offset="100%" stop-color="#0c1f17"/>
  </linearGradient></defs>
  <rect width="1080" height="1080" fill="url(#bg)"/>
  <circle cx="920" cy="140" r="180" fill="{k['accent']}" fill-opacity="0.18"/>
  <circle cx="120" cy="940" r="220" fill="{k['accent']}" fill-opacity="0.12"/>
  <text x="72" y="90" fill="{k['accent']}" font-family="Arial" font-size="24" font-weight="700" letter-spacing="4">{k['plat'].upper()} · {k['role_label']}</text>
  <text x="72" y="190" fill="#ffffff" font-family="Arial" font-size="64" font-weight="800">{k['title']}</text>
  <text x="72" y="250" fill="{k['accent']}" font-family="Arial" font-size="30" font-weight="600">{k['brand']}</text>
  {img}
  {_fo(72, body_y, 936, body_h, k['body'], '#e8f5ec', 34 if k.get('image_url') else 36)}
  <rect x="72" y="860" width="520" height="88" rx="44" fill="{k['accent']}"/>
  <text x="332" y="916" text-anchor="middle" fill="#1a2e0f" font-family="Arial" font-size="30" font-weight="800">{k['cta_text']}</text>
  <text x="72" y="1020" fill="#ffffff" fill-opacity="0.55" font-family="Arial" font-size="24">Made with PejuAfrica</text>
</svg>"""


def _tpl_bold_split(**k: str) -> str:
    img = (
        _img_rect(k["image_url"], 40, 200, 460, 680, 28)
        if k.get("image_url")
        else f'<rect x="40" y="200" width="460" height="680" rx="28" fill="{k["mid"]}"/>'
    )
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
  <rect width="1080" height="1080" fill="{k['deep']}"/>
  {img}
  <text x="560" y="160" fill="{k['accent']}" font-family="Arial" font-size="22" font-weight="700" letter-spacing="3">{k['plat'].upper()}</text>
  <text x="560" y="260" fill="#fff" font-family="Arial" font-size="52" font-weight="800">{k['title']}</text>
  <text x="560" y="320" fill="{k['accent']}" font-family="Arial" font-size="26" font-weight="600">{k['brand']}</text>
  {_fo(560, 360, 460, 420, k['body'], '#e8f5ec', 28)}
  <rect x="560" y="860" width="440" height="80" rx="40" fill="{k['accent']}"/>
  <text x="780" y="912" text-anchor="middle" fill="#111" font-family="Arial" font-size="26" font-weight="800">{k['cta_text']}</text>
</svg>"""


def _tpl_centered_quote(**k: str) -> str:
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
  <rect width="1080" height="1080" fill="{k['deep']}"/>
  <text x="540" y="220" text-anchor="middle" fill="{k['accent']}" fill-opacity="0.35" font-family="Georgia, serif" font-size="220">“</text>
  <text x="540" y="300" text-anchor="middle" fill="{k['accent']}" font-family="Arial" font-size="22" letter-spacing="4">{k['brand'].upper()}</text>
  {_fo(120, 360, 840, 360, k['body'], '#fff', 40)}
  <text x="540" y="820" text-anchor="middle" fill="{k['accent']}" font-family="Arial" font-size="28" font-weight="700">{k['title']}</text>
  <text x="540" y="900" text-anchor="middle" fill="#fff" font-family="Arial" font-size="26" font-weight="600">{k['cta_text']}</text>
  <text x="540" y="1000" text-anchor="middle" fill="#fff" fill-opacity="0.4" font-family="Arial" font-size="20">{k['plat']}</text>
</svg>"""


def _tpl_poster_stack(**k: str) -> str:
    img = _img_rect(k["image_url"], 0, 180, 1080, 360, 0) if k.get("image_url") else ""
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
  <rect width="1080" height="180" fill="{k['deep']}"/>
  <text x="72" y="110" fill="{k['accent']}" font-family="Arial" font-size="48" font-weight="800">{k['title']}</text>
  {img if img else f'<rect y="180" width="1080" height="360" fill="{k["mid"]}"/>'}
  <rect y="540" width="1080" height="360" fill="#0b1220"/>
  {_fo(72, 580, 936, 240, k['body'], '#e5e7eb', 32)}
  <rect y="900" width="1080" height="180" fill="{k['accent']}"/>
  <text x="72" y="980" fill="#111" font-family="Arial" font-size="28" font-weight="700">{k['brand']} · {k['cta_text']}</text>
  <text x="72" y="1035" fill="#111" fill-opacity="0.7" font-family="Arial" font-size="20">{k['plat'].upper()}</text>
</svg>"""


def _tpl_soft_cream(**k: str) -> str:
    img = _img_rect(k["image_url"], 72, 280, 936, 300, 24) if k.get("image_url") else ""
    by = 620 if k.get("image_url") else 340
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
  <rect width="1080" height="1080" fill="{k['deep']}"/>
  <rect x="48" y="48" width="984" height="984" rx="32" fill="none" stroke="{k['accent']}" stroke-width="3" stroke-opacity="0.25"/>
  <text x="72" y="140" fill="{k['accent']}" font-family="Arial" font-size="22" letter-spacing="3">{k['plat'].upper()}</text>
  <text x="72" y="220" fill="#1a1a1a" font-family="Arial" font-size="56" font-weight="800">{k['title']}</text>
  <text x="72" y="275" fill="{k['accent']}" font-family="Arial" font-size="26">{k['brand']}</text>
  {img}
  {_fo(72, by, 936, 220, k['body'], '#333', 32)}
  <rect x="72" y="880" width="420" height="78" rx="12" fill="{k['accent']}"/>
  <text x="282" y="930" text-anchor="middle" fill="#fff" font-family="Arial" font-size="26" font-weight="700">{k['cta_text']}</text>
</svg>"""


def _tpl_night_neon(**k: str) -> str:
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
  <rect width="1080" height="1080" fill="{k['deep']}"/>
  <rect x="48" y="48" width="984" height="984" rx="40" fill="none" stroke="{k['accent']}" stroke-width="4"/>
  <rect x="68" y="68" width="944" height="944" rx="28" fill="none" stroke="{k['accent']}" stroke-opacity="0.25" stroke-width="2"/>
  <text x="100" y="180" fill="{k['accent']}" font-family="Arial" font-size="24" letter-spacing="6">{k['role_label']}</text>
  <text x="100" y="280" fill="#fff" font-family="Arial" font-size="60" font-weight="800">{k['title']}</text>
  {_fo(100, 360, 880, 400, k['body'], '#d1fae5', 36)}
  <text x="100" y="860" fill="{k['accent']}" font-family="Arial" font-size="28" font-weight="700">{k['cta_text']}</text>
  <text x="100" y="940" fill="#fff" fill-opacity="0.5" font-family="Arial" font-size="22">{k['brand']} · {k['plat']}</text>
</svg>"""


def _tpl_marketplace(**k: str) -> str:
    img = (
        _img_rect(k["image_url"], 72, 120, 936, 480, 28)
        if k.get("image_url")
        else f'<rect x="72" y="120" width="936" height="480" rx="28" fill="{k["mid"]}"/>'
    )
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
  <rect width="1080" height="1080" fill="{k['deep']}"/>
  {img}
  <rect x="72" y="640" width="936" height="340" rx="28" fill="#06281c"/>
  <text x="110" y="720" fill="#fff" font-family="Arial" font-size="44" font-weight="800">{k['title']}</text>
  <text x="110" y="775" fill="{k['accent']}" font-family="Arial" font-size="24">{k['brand']}</text>
  {_fo(110, 800, 860, 100, k['body'], '#d1fae5', 26)}
  <rect x="110" y="920" width="380" height="70" rx="35" fill="{k['accent']}"/>
  <text x="300" y="965" text-anchor="middle" fill="#06281c" font-family="Arial" font-size="24" font-weight="800">{k['cta_text']}</text>
</svg>"""


def _tpl_story_frame(**k: str) -> str:
    img = _img_rect(k["image_url"], 0, 120, 1080, 720, 0) if k.get("image_url") else ""
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
  <rect width="1080" height="120" fill="{k['deep']}"/>
  <text x="48" y="75" fill="{k['accent']}" font-family="Arial" font-size="28" font-weight="700">{k['brand']} · {k['plat'].upper()}</text>
  {img if img else f'<rect y="120" width="1080" height="720" fill="{k["mid"]}"/>'}
  {_fo(48, 200 if not k.get('image_url') else 860, 984, 200 if not k.get('image_url') else 40, k['body'] if not k.get('image_url') else '', '#fff', 32)}
  <rect y="840" width="1080" height="240" fill="{k['deep']}"/>
  <text x="48" y="920" fill="#fff" font-family="Arial" font-size="40" font-weight="800">{k['title']}</text>
  <text x="48" y="980" fill="{k['accent']}" font-family="Arial" font-size="26" font-weight="600">{k['cta_text']}</text>
  <text x="48" y="1035" fill="#fff" fill-opacity="0.5" font-family="Arial" font-size="20">{k['role_label']}</text>
</svg>"""


def _tpl_circular_focus(**k: str) -> str:
    img_block = ""
    if k.get("image_url"):
        img_block = f"""
  <defs><clipPath id="circ"><circle cx="540" cy="380" r="220"/></clipPath></defs>
  <circle cx="540" cy="380" r="240" fill="none" stroke="{k['accent']}" stroke-width="8"/>
  <image href="{k['image_url']}" x="320" y="160" width="440" height="440" preserveAspectRatio="xMidYMid slice" clip-path="url(#circ)"/>"""
    else:
        img_block = f'<circle cx="540" cy="380" r="220" fill="{k["mid"]}"/>'
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
  <rect width="1080" height="1080" fill="{k['deep']}"/>
  {img_block}
  <text x="540" y="700" text-anchor="middle" fill="#fff" font-family="Arial" font-size="48" font-weight="800">{k['title']}</text>
  <text x="540" y="760" text-anchor="middle" fill="{k['accent']}" font-family="Arial" font-size="24">{k['brand']}</text>
  {_fo(140, 800, 800, 140, k['body'], '#ede9fe', 28)}
  <text x="540" y="1000" text-anchor="middle" fill="{k['accent']}" font-family="Arial" font-size="26" font-weight="700">{k['cta_text']}</text>
</svg>"""


def _tpl_diagonal_slash(**k: str) -> str:
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
  <rect width="1080" height="1080" fill="{k['deep']}"/>
  <polygon points="0,0 700,0 280,1080 0,1080" fill="{k['mid']}"/>
  <polygon points="640,0 1080,0 1080,1080 220,1080" fill="{k['accent']}" fill-opacity="0.12"/>
  <text x="72" y="160" fill="{k['accent']}" font-family="Arial" font-size="22" letter-spacing="4">{k['plat'].upper()}</text>
  <text x="72" y="280" fill="#fff" font-family="Arial" font-size="64" font-weight="800">{k['title']}</text>
  {_fo(72, 360, 700, 400, k['body'], '#e5e7eb', 34)}
  <rect x="72" y="860" width="460" height="80" rx="8" fill="{k['accent']}"/>
  <text x="302" y="912" text-anchor="middle" fill="#111" font-family="Arial" font-size="26" font-weight="800">{k['cta_text']}</text>
  <text x="72" y="1000" fill="#fff" fill-opacity="0.5" font-family="Arial" font-size="22">{k['brand']}</text>
</svg>"""


def _tpl_minimal_type(**k: str) -> str:
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
  <rect width="1080" height="1080" fill="{k['deep']}"/>
  <text x="96" y="200" fill="{k['accent']}" font-family="Arial" font-size="20" letter-spacing="6">{k['brand'].upper()}</text>
  <text x="96" y="360" fill="{k['accent']}" font-family="Arial" font-size="72" font-weight="800">{k['title']}</text>
  <line x1="96" y1="420" x2="420" y2="420" stroke="{k['mid']}" stroke-width="4"/>
  {_fo(96, 480, 880, 320, k['body'], '#374151', 36)}
  <text x="96" y="920" fill="{k['accent']}" font-family="Arial" font-size="28" font-weight="700">{k['cta_text']} →</text>
  <text x="96" y="1000" fill="#9ca3af" font-family="Arial" font-size="20">{k['plat']}</text>
</svg>"""


def _tpl_festivity(**k: str) -> str:
    dots = "".join(
        f'<circle cx="{(i * 97) % 1000 + 40}" cy="{(i * 131) % 900 + 60}" r="{(i % 5) * 6 + 8}" fill="{k["accent"]}" fill-opacity="0.{12 + (i % 4)}"/>'
        for i in range(18)
    )
    img = _img_rect(k["image_url"], 140, 220, 800, 360, 28) if k.get("image_url") else ""
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
  <rect width="1080" height="1080" fill="{k['deep']}"/>
  {dots}
  <text x="540" y="140" text-anchor="middle" fill="{k['accent']}" font-family="Arial" font-size="28" letter-spacing="4">{k['plat'].upper()}</text>
  {img}
  <text x="540" y="{640 if k.get('image_url') else 320}" text-anchor="middle" fill="#fff" font-family="Arial" font-size="56" font-weight="800">{k['title']}</text>
  {_fo(140, 680 if k.get('image_url') else 400, 800, 200, k['body'], '#ffe4e6', 30)}
  <rect x="290" y="900" width="500" height="80" rx="40" fill="{k['accent']}"/>
  <text x="540" y="952" text-anchor="middle" fill="#7a1f2b" font-family="Arial" font-size="26" font-weight="800">{k['cta_text']}</text>
</svg>"""


def _tpl_newspaper(**k: str) -> str:
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
  <rect width="1080" height="1080" fill="{k['deep']}"/>
  <text x="540" y="120" text-anchor="middle" fill="{k['accent']}" font-family="Georgia, serif" font-size="42" font-weight="700">{k['brand']}</text>
  <line x1="80" y1="160" x2="1000" y2="160" stroke="{k['accent']}" stroke-width="2"/>
  <line x1="80" y1="172" x2="1000" y2="172" stroke="{k['accent']}" stroke-width="1"/>
  <text x="80" y="250" fill="{k['accent']}" font-family="Georgia, serif" font-size="58" font-weight="700">{k['title']}</text>
  <text x="80" y="300" fill="#666" font-family="Arial" font-size="20">{k['plat']} · {k['role_label']}</text>
  {_fo(80, 360, 920, 420, k['body'], '#222', 34)}
  <line x1="80" y1="860" x2="1000" y2="860" stroke="{k['accent']}" stroke-width="2"/>
  <text x="80" y="940" fill="{k['accent']}" font-family="Arial" font-size="28" font-weight="700">{k['cta_text']}</text>
  <text x="80" y="1000" fill="#888" font-family="Arial" font-size="18">PejuAfrica editorial</text>
</svg>"""


def _tpl_duotone(**k: str) -> str:
    img = _img_rect(k["image_url"], 540, 0, 540, 1080, 0) if k.get("image_url") else ""
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
  <rect width="540" height="1080" fill="{k['deep']}"/>
  {img if img else f'<rect x="540" width="540" height="1080" fill="{k["mid"]}"/>'}
  <text x="48" y="160" fill="{k['accent']}" font-family="Arial" font-size="22" letter-spacing="3">{k['plat'].upper()}</text>
  <text x="48" y="280" fill="#fff" font-family="Arial" font-size="52" font-weight="800">{k['title']}</text>
  {_fo(48, 360, 440, 400, k['body'], '#ecfdf5', 28)}
  <rect x="48" y="860" width="400" height="76" rx="8" fill="{k['accent']}"/>
  <text x="248" y="910" text-anchor="middle" fill="#115e59" font-family="Arial" font-size="24" font-weight="800">{k['cta_text']}</text>
  <text x="48" y="1000" fill="#fff" fill-opacity="0.6" font-family="Arial" font-size="22">{k['brand']}</text>
</svg>"""


def _tpl_badge_ribbon(**k: str) -> str:
    img = _img_rect(k["image_url"], 72, 280, 936, 340, 24) if k.get("image_url") else ""
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
  <rect width="1080" height="1080" fill="{k['deep']}"/>
  <polygon points="780,0 1080,0 1080,220 930,160 780,220" fill="{k['accent']}"/>
  <text transform="translate(900,95) rotate(35)" fill="#7f1d1d" font-family="Arial" font-size="22" font-weight="800">{k['role_label']}</text>
  <text x="72" y="140" fill="#fff" font-family="Arial" font-size="52" font-weight="800">{k['title']}</text>
  <text x="72" y="210" fill="{k['accent']}" font-family="Arial" font-size="26">{k['brand']}</text>
  {img}
  {_fo(72, 660 if k.get('image_url') else 320, 936, 200, k['body'], '#dbeafe', 30)}
  <rect x="72" y="900" width="480" height="78" rx="39" fill="{k['accent']}"/>
  <text x="312" y="950" text-anchor="middle" fill="#7f1d1d" font-family="Arial" font-size="26" font-weight="800">{k['cta_text']}</text>
</svg>"""


def _tpl_horizon(**k: str) -> str:
    img = _img_rect(k["image_url"], 0, 0, 1080, 420, 0) if k.get("image_url") else ""
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
  {img if img else f'<rect width="1080" height="420" fill="{k["mid"]}"/>'}
  <rect y="420" width="1080" height="240" fill="{k['deep']}"/>
  <rect y="660" width="1080" height="420" fill="#0c4a6e"/>
  <text x="72" y="520" fill="#fff" font-family="Arial" font-size="52" font-weight="800">{k['title']}</text>
  <text x="72" y="580" fill="{k['accent']}" font-family="Arial" font-size="26">{k['brand']} · {k['plat']}</text>
  {_fo(72, 720, 936, 220, k['body'], '#e0f2fe', 32)}
  <text x="72" y="1000" fill="{k['accent']}" font-family="Arial" font-size="28" font-weight="700">{k['cta_text']}</text>
</svg>"""
