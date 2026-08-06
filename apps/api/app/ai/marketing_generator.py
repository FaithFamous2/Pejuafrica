"""AI Marketing content generation — profile-aware templates (LLM-ready)."""

from __future__ import annotations

import calendar
import json
import re
from datetime import date, datetime, timezone

from app.ai.generation_brief import GenerationBrief
from app.models import BusinessProfile

PILLARS = [
    ("Awareness", "Introduce the brand and spark curiosity"),
    ("Value", "Teach or help your audience with useful insight"),
    ("Social proof", "Show trust, testimonials, and results"),
    ("Offer", "Highlight products, services, or promotions"),
    ("Community", "Invite conversation and local belonging"),
    ("Conversion", "Drive WhatsApp, calls, visits, or bookings"),
]

PLATFORMS = ["instagram", "whatsapp", "facebook", "instagram", "tiktok"]

CTAS = [
    "Send us a WhatsApp message today",
    "Save this post for later",
    "Share with someone who needs this",
    "Comment YES if this resonates",
    "Visit us this week — limited slots",
    "DM us to get started",
]


def _hashtags(profile: BusinessProfile) -> list[str]:
    industry = (profile.industry or "business").lower().replace(" ", "")
    name = "".join(ch for ch in profile.business_name.lower() if ch.isalnum())[:18]
    return [
        f"#{name}" if name else "#pejuafrica",
        f"#{industry}",
        "#MadeInNigeria",
        "#AfricanSME",
        "#LagosBusiness",
        "#GrowWithPeju",
    ]


def _theme_for_day(day_index: int) -> tuple[str, str]:
    return PILLARS[day_index % len(PILLARS)]


def build_strategy(
    profile: BusinessProfile,
    month: int,
    year: int,
    brief: GenerationBrief | None = None,
) -> dict:
    brief = brief or GenerationBrief()
    month_name = calendar.month_name[month]
    industry = profile.industry or "your industry"
    audience = profile.target_audience or "your ideal customers"
    goals = profile.goals or "grow visibility and sales"
    focus_bit = f" Focus this month: {brief.focus}." if brief.focus else ""
    occasion_bit = (
        f" Campaign moment: {brief.occasion_label()}."
        if brief.occasion_id != "always_on"
        else ""
    )
    objectives = [
        "Publish consistently for 30 days",
        "Build trust with value-first posts",
        "Drive conversations on WhatsApp and Instagram",
        "Convert attention into inquiries and visits",
    ]
    if brief.occasion_id != "always_on":
        objectives.append(f"Lean into {brief.occasion_label()}")
    if brief.focus:
        objectives.append(f"Emphasize: {brief.focus}")
    return {
        "summary": (
            f"A {month_name} {year} growth plan for {profile.business_name} in {industry}. "
            f"Content is tuned for {audience}, with a {brief.tone_label().lower()} tone "
            f"grounded in the brand's default memory.{focus_bit}{occasion_bit} "
            f"Primary outcomes: {goals}."
        ),
        "pillars": [{"name": n, "intent": i} for n, i in PILLARS],
        "objectives": objectives,
    }


def compose_post(
    *,
    profile: BusinessProfile,
    day_index: int,
    scheduled: date,
    variation: int = 0,
    platform: str | None = None,
    theme: str | None = None,
    brief: GenerationBrief | None = None,
) -> dict:
    brief = brief or GenerationBrief()
    pillar_name, pillar_intent = _theme_for_day(day_index + variation)
    if theme:
        pillar_name = theme
        pillar_intent = next((i for n, i in PILLARS if n == theme), pillar_intent)
    if brief.focus and variation % 2 == 0:
        pillar_intent = f"{pillar_intent} Tied to focus: {brief.focus}."
    platform_name = (
        brief.platform_override
        or platform
        or PLATFORMS[(day_index + variation) % len(PLATFORMS)]
    ).lower()
    cta = CTAS[(day_index + variation) % len(CTAS)]
    business = profile.business_name
    voice = brief.resolved_tone_instruction(profile.brand_voice)
    audience = profile.target_audience or "ambitious customers"
    industry = profile.industry or "business"
    occasion = brief.occasion_label()

    hooks = [
        f"Quick tip for {audience.split(',')[0].strip()}:",
        f"What {business} wants you to know today:",
        f"If you are in {industry}, read this:",
        f"A {pillar_name.lower()} moment from {business}:",
        f"Let's talk about growth — {pillar_name.lower()} edition:",
        f"Fresh angle for day {day_index} from {business}:",
        f"Rewrite worth posting — {pillar_name.lower()}:",
        f"{occasion} energy from {business}:",
    ]
    hook = hooks[(day_index + variation) % len(hooks)]
    focus_line = f"\nThis post leans into: {brief.focus}." if brief.focus else ""
    notes_line = f"\nCreative note: {brief.extra_notes}." if brief.extra_notes else ""

    caption = (
        f"{hook}\n\n"
        f"{pillar_intent}. At {business}, we keep things practical and human.\n\n"
        f"Today's focus: {pillar_name}. "
        f"We crafted this for {audience.split('.')[0].strip()}."
        f"{focus_line}{notes_line}\n\n"
        f"Tone: {voice[:160]}{'…' if len(voice) > 160 else ''}\n\n"
        f"{cta} ✨"
    )
    graphic = (
        f"Premium lifestyle photo for a Nigerian {industry} brand named {business}. "
        f"Theme: {pillar_name}. Occasion: {occasion}. "
        f"Natural light, warm greens and cream accents, "
        f"modern African aesthetic, clean typography space for caption overlay, "
        f"no clutter, high-end social media quality. Variation {variation + 1}."
    )
    return {
        "day_index": day_index,
        "scheduled_date": datetime(
            scheduled.year, scheduled.month, scheduled.day, tzinfo=timezone.utc
        ),
        "platform": platform_name[:40],
        "theme": pillar_name[:120],
        "caption": caption,
        "hashtags": _hashtags(profile),
        "cta": cta,
        "graphic_prompt": graphic,
    }


def month_dates(year: int, month: int, count: int = 30) -> list[date]:
    days_in_month = calendar.monthrange(year, month)[1]
    n = min(count, days_in_month)
    return [date(year, month, day) for day in range(1, n + 1)]


def build_template_plan(
    profile: BusinessProfile,
    month: int,
    year: int,
    brief: GenerationBrief | None = None,
) -> dict:
    brief = brief or GenerationBrief()
    strategy = build_strategy(profile, month, year, brief=brief)
    dates = month_dates(year, month, 30)
    posts = [
        compose_post(profile=profile, day_index=i + 1, scheduled=d, brief=brief)
        for i, d in enumerate(dates)
    ]
    return {
        "strategy": strategy,
        "posts": posts,
        "provider": "template-v1",
        "usage": None,
        "brief": brief.to_metadata(),
        "prompt_excerpt": brief.to_prompt_block(profile.brand_voice),
        "response_excerpt": strategy["summary"][:1500],
    }


async def build_llm_plan(
    profile: BusinessProfile,
    month: int,
    year: int,
    db=None,
    brief: GenerationBrief | None = None,
) -> dict:
    from app.ai.llm import complete_json, provider_label_from_usage

    brief = brief or GenerationBrief()
    month_name = calendar.month_name[month]
    days = calendar.monthrange(year, month)[1]
    system = (
        "You are PejuAfrica, an AI marketing department for African SMEs. "
        "Return ONLY valid JSON. Prefer WhatsApp/Instagram/Facebook/TikTok. "
        "Captions must match the requested tone, occasion, and focus while staying "
        "local, practical, and mobile-first. Use brand memory as the base."
    )
    user = f"""
Create a {month_name} {year} marketing plan for this business.

Business: {profile.business_name}
Industry: {profile.industry}
Brand voice (default memory): {profile.brand_voice}
Audience: {profile.target_audience}
Competitors: {profile.competitors}
Goals: {profile.goals}
Socials: {profile.socials}

Creative brief (override / tailor the month):
{brief.to_prompt_block(profile.brand_voice)}

Return JSON with this shape:
{{
  "summary": "string",
  "objectives": ["string"],
  "pillars": [{{"name":"string","intent":"string"}}],
  "posts": [
    {{
      "day_index": 1,
      "theme": "Awareness",
      "platform": "instagram",
      "caption": "string",
      "cta": "string",
      "hashtags": ["#tag"],
      "graphic_prompt": "string"
    }}
  ]
}}

Generate exactly {days} posts (day_index 1..{days}), one per calendar day.
Every post should reflect the tone + occasion + focus above when provided.
"""
    data = await complete_json(system=system, user=user, temperature=0.75, db=db)
    usage = data.pop("_usage", None)
    dates = month_dates(year, month, days)
    raw_posts = data.get("posts") or []
    posts: list[dict] = []
    for i, d in enumerate(dates):
        raw = raw_posts[i] if i < len(raw_posts) else {}
        fallback = compose_post(profile=profile, day_index=i + 1, scheduled=d, brief=brief)
        posts.append(
            {
                "day_index": i + 1,
                "scheduled_date": datetime(d.year, d.month, d.day, tzinfo=timezone.utc),
                "platform": str(raw.get("platform") or fallback["platform"]).lower()[:40],
                "theme": str(raw.get("theme") or fallback["theme"])[:120],
                "caption": str(raw.get("caption") or fallback["caption"]),
                "hashtags": raw.get("hashtags") or fallback["hashtags"],
                "cta": str(raw.get("cta") or fallback["cta"] or "")[:255],
                "graphic_prompt": str(raw.get("graphic_prompt") or fallback["graphic_prompt"]),
            }
        )

    strategy = {
        "summary": data.get("summary")
        or build_strategy(profile, month, year, brief=brief)["summary"],
        "pillars": data.get("pillars") or [{"name": n, "intent": i} for n, i in PILLARS],
        "objectives": data.get("objectives")
        or build_strategy(profile, month, year, brief=brief)["objectives"],
    }
    return {
        "strategy": strategy,
        "posts": posts,
        "provider": provider_label_from_usage(usage),
        "usage": usage,
        "brief": brief.to_metadata(),
        "prompt_excerpt": user[:2500],
        "response_excerpt": (strategy["summary"] or "")[:1500],
    }


async def generate_campaign_plan(
    profile: BusinessProfile,
    month: int,
    year: int,
    db=None,
    brief: GenerationBrief | None = None,
) -> dict:
    from app.ai.llm import LLMError, load_active_providers

    brief = brief or GenerationBrief()
    providers = await load_active_providers(db)
    if providers:
        try:
            return await build_llm_plan(profile, month, year, db=db, brief=brief)
        except LLMError:
            pass
    return build_template_plan(profile, month, year, brief=brief)


async def regenerate_day_content(
    profile: BusinessProfile,
    *,
    day_index: int,
    scheduled: date,
    current_platform: str | None = None,
    current_theme: str | None = None,
    variation: int = 1,
    db=None,
    brief: GenerationBrief | None = None,
) -> dict:
    from app.ai.llm import LLMError, complete_json, load_active_providers

    brief = brief or GenerationBrief()
    if brief.platform_override:
        current_platform = brief.platform_override

    providers = await load_active_providers(db)
    if providers:
        try:
            system = (
                "You are PejuAfrica rewriting ONE social post for an African SME. "
                "Return ONLY valid JSON. Make it fresh vs previous drafts — new hook, "
                "same brand memory, honour tone/occasion/focus when provided."
            )
            user = f"""
Rewrite day {day_index} content for:

Business: {profile.business_name}
Industry: {profile.industry}
Brand voice (default memory): {profile.brand_voice}
Audience: {profile.target_audience}
Goals: {profile.goals}
Preferred platform: {current_platform or "instagram"}
Preferred theme: {current_theme or "Value"}
Scheduled date: {scheduled.isoformat()}

Creative brief (optional — if empty, stay on brand defaults):
{brief.to_prompt_block(profile.brand_voice)}

Return JSON:
{{
  "platform": "instagram|whatsapp|facebook|tiktok",
  "theme": "string",
  "caption": "string",
  "cta": "string",
  "hashtags": ["#tag"],
  "graphic_prompt": "string"
}}
"""
            data = await complete_json(system=system, user=user, temperature=0.9, db=db)
            usage = data.pop("_usage", None)
            fallback = compose_post(
                profile=profile,
                day_index=day_index,
                scheduled=scheduled,
                variation=variation,
                platform=current_platform,
                theme=current_theme,
                brief=brief,
            )
            return {
                "day_index": day_index,
                "scheduled_date": fallback["scheduled_date"],
                # Keep the post's platform unless the brief explicitly overrides it
                "platform": (
                    brief.platform_override
                    or current_platform
                    or str(data.get("platform") or fallback["platform"])
                ).lower()[:40],
                "theme": str(data.get("theme") or fallback["theme"])[:120],
                "caption": str(data.get("caption") or fallback["caption"]),
                "hashtags": data.get("hashtags") or fallback["hashtags"],
                "cta": str(data.get("cta") or fallback["cta"] or "")[:255],
                "graphic_prompt": str(data.get("graphic_prompt") or fallback["graphic_prompt"]),
                "provider": f"{usage.get('provider')}:{usage.get('model')}" if usage else "llm",
                "usage": usage,
                "brief": brief.to_metadata(),
                "prompt_excerpt": user[:2500],
                "response_excerpt": str(data.get("caption") or "")[:1500],
            }
        except LLMError:
            pass

    composed = compose_post(
        profile=profile,
        day_index=day_index,
        scheduled=scheduled,
        variation=variation,
        platform=current_platform,
        theme=current_theme,
        brief=brief,
    )
    composed["provider"] = "template-v1"
    composed["usage"] = None
    composed["brief"] = brief.to_metadata()
    composed["prompt_excerpt"] = brief.to_prompt_block(profile.brand_voice)
    composed["response_excerpt"] = composed["caption"][:1500]
    return composed


async def redraft_creative_brief(
    profile: BusinessProfile,
    *,
    rough_notes: str,
    scope: str = "month",
    db=None,
) -> dict:
    from app.ai.llm import LLMError, complete_json, load_active_providers

    providers = await load_active_providers(db)
    fallback = {
        "focus": rough_notes.strip()[:500] or (profile.goals or "Grow visibility and sales"),
        "tone_suggestion": "brand_default",
        "occasion_suggestion": "always_on",
        "polished_brief": (
            f"For {profile.business_name}: lean on brand defaults"
            + (f" while emphasising — {rough_notes.strip()}" if rough_notes.strip() else ".")
        ),
        "extra_notes": rough_notes.strip() or None,
        "usage": None,
    }
    if not providers:
        return fallback

    try:
        system = (
            "You are a senior African SME marketing strategist for PejuAfrica. "
            "Return ONLY valid JSON. Tighten rough notes into a usable creative brief."
        )
        user = f"""
Brand: {profile.business_name}
Industry: {profile.industry}
Default voice: {profile.brand_voice}
Audience: {profile.target_audience}
Goals: {profile.goals}
Scope: {"monthly campaign" if scope == "month" else "single-day post"}
Rough notes from the business owner:
{rough_notes or "(none — propose a strong always-on brief from brand memory)"}

Return JSON:
{{
  "focus": "one clear sentence of what content should emphasise",
  "tone_suggestion": "brand_default|warm_human|bold_confident|premium|playful|educational|urgent|community|storytelling",
  "occasion_suggestion": "always_on|product_launch|promo_sale|payday|anniversary|customer_love|behind_scenes|festive|faith_holiday|independence|back_to_school|valentines|awareness_day",
  "polished_brief": "2-4 sentences the AI can follow",
  "extra_notes": "optional short creative direction"
}}
"""
        data = await complete_json(system=system, user=user, temperature=0.6, db=db)
        usage = data.pop("_usage", None)
        return {
            "focus": str(data.get("focus") or fallback["focus"])[:2000],
            "tone_suggestion": str(data.get("tone_suggestion") or "brand_default")[:40],
            "occasion_suggestion": str(data.get("occasion_suggestion") or "always_on")[:40],
            "polished_brief": str(data.get("polished_brief") or fallback["polished_brief"])[:2000],
            "extra_notes": (str(data.get("extra_notes") or "").strip() or None),
            "usage": usage,
            "prompt_excerpt": user[:2000],
            "response_excerpt": str(data.get("polished_brief") or "")[:1500],
        }
    except LLMError:
        return fallback


def _extract_json_string_field(buf: str, field: str) -> str | None:
    """Best-effort extract of a JSON string field from a partial buffer."""
    pattern = rf'"{re.escape(field)}"\s*:\s*"'
    match = re.search(pattern, buf)
    if not match:
        return None
    i = match.end()
    out: list[str] = []
    while i < len(buf):
        ch = buf[i]
        if ch == "\\" and i + 1 < len(buf):
            nxt = buf[i + 1]
            escapes = {"n": "\n", "t": "\t", "r": "\r", '"': '"', "\\": "\\", "/": "/"}
            out.append(escapes.get(nxt, nxt))
            i += 2
            continue
        if ch == '"':
            return "".join(out)
        out.append(ch)
        i += 1
    return "".join(out)  # still streaming


def _extract_json_array_field(buf: str, field: str) -> list[str] | None:
    pattern = rf'"{re.escape(field)}"\s*:\s*\['
    match = re.search(pattern, buf)
    if not match:
        return None
    start = match.end() - 1
    depth = 0
    i = start
    while i < len(buf):
        ch = buf[i]
        if ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
            if depth == 0:
                try:
                    raw = json.loads(buf[start : i + 1])
                    if isinstance(raw, list):
                        return [str(x) for x in raw if x]
                except json.JSONDecodeError:
                    return None
                return None
        i += 1
    return None


async def stream_regenerate_day_content(
    profile: BusinessProfile,
    *,
    day_index: int,
    scheduled: date,
    current_platform: str | None = None,
    current_theme: str | None = None,
    variation: int = 1,
    db=None,
    brief: GenerationBrief | None = None,
):
    """Yield status/field deltas while rewriting a day, then a final result dict."""
    from app.ai.llm import LLMError, stream_completion, load_active_providers

    brief = brief or GenerationBrief()
    locked_platform = (brief.platform_override or current_platform or "instagram").lower()[:40]

    yield {"type": "status", "message": "Opening brand memory…"}
    providers = await load_active_providers(db)
    if not providers:
        composed = compose_post(
            profile=profile,
            day_index=day_index,
            scheduled=scheduled,
            variation=variation,
            platform=locked_platform,
            theme=current_theme,
            brief=brief,
        )
        yield {"type": "caption", "text": composed["caption"]}
        yield {"type": "cta", "text": composed.get("cta") or ""}
        yield {"type": "hashtags", "tags": composed.get("hashtags") or []}
        yield {
            "type": "result",
            "data": {
                **composed,
                "platform": locked_platform,
                "provider": "template-v1",
                "usage": None,
                "brief": brief.to_metadata(),
                "prompt_excerpt": brief.to_prompt_block(profile.brand_voice),
                "response_excerpt": composed["caption"][:1500],
            },
        }
        return

    system = (
        "You are PejuAfrica rewriting ONE social post for an African SME. "
        "Return ONLY valid JSON. Make it fresh vs previous drafts — new hook, "
        "same brand memory, honour tone/occasion/focus when provided. "
        "Put the caption field first in the JSON object so it streams early."
    )
    user = f"""
Rewrite day {day_index} content for:

Business: {profile.business_name}
Industry: {profile.industry}
Brand voice (default memory): {profile.brand_voice}
Audience: {profile.target_audience}
Goals: {profile.goals}
Keep platform exactly: {locked_platform}
Preferred theme: {current_theme or "Value"}
Scheduled date: {scheduled.isoformat()}

Creative brief (optional — if empty, stay on brand defaults):
{brief.to_prompt_block(profile.brand_voice)}

Return JSON with keys in this order when possible:
{{
  "caption": "string",
  "cta": "string",
  "hashtags": ["#tag"],
  "theme": "string",
  "graphic_prompt": "string",
  "platform": "{locked_platform}"
}}
"""
    yield {"type": "status", "message": "AI is writing your caption…"}
    buf = ""
    usage = None
    last_caption = ""
    last_cta = ""
    try:
        async for event in stream_completion(
            system=system, user=user, temperature=0.9, json_mode=True, db=db
        ):
            if event["type"] == "delta":
                buf += event["text"]
                caption = _extract_json_string_field(buf, "caption")
                if caption is not None and caption != last_caption:
                    last_caption = caption
                    yield {"type": "caption", "text": caption}
                cta_val = _extract_json_string_field(buf, "cta")
                if cta_val is not None and cta_val != last_cta:
                    last_cta = cta_val
                    yield {"type": "cta", "text": cta_val}
                tags = _extract_json_array_field(buf, "hashtags")
                if tags is not None:
                    yield {"type": "hashtags", "tags": tags}
            elif event["type"] == "usage":
                usage = event["usage"]
    except LLMError:
        composed = compose_post(
            profile=profile,
            day_index=day_index,
            scheduled=scheduled,
            variation=variation,
            platform=locked_platform,
            theme=current_theme,
            brief=brief,
        )
        yield {"type": "caption", "text": composed["caption"]}
        yield {
            "type": "result",
            "data": {
                **composed,
                "platform": locked_platform,
                "provider": "template-v1",
                "usage": None,
                "brief": brief.to_metadata(),
                "prompt_excerpt": user[:2500],
                "response_excerpt": composed["caption"][:1500],
            },
        }
        return

    content = buf.strip()
    if content.startswith("```"):
        content = content.strip("`")
        if content.startswith("json"):
            content = content[4:].strip()
    try:
        data = json.loads(content)
    except json.JSONDecodeError:
        data = {}

    fallback = compose_post(
        profile=profile,
        day_index=day_index,
        scheduled=scheduled,
        variation=variation,
        platform=locked_platform,
        theme=current_theme,
        brief=brief,
    )
    result = {
        "day_index": day_index,
        "scheduled_date": fallback["scheduled_date"],
        "platform": locked_platform,
        "theme": str(data.get("theme") or fallback["theme"])[:120],
        "caption": str(data.get("caption") or last_caption or fallback["caption"]),
        "hashtags": data.get("hashtags") or fallback["hashtags"],
        "cta": str(data.get("cta") or last_cta or fallback["cta"] or "")[:255],
        "graphic_prompt": str(data.get("graphic_prompt") or fallback["graphic_prompt"]),
        "provider": f"{usage.get('provider')}:{usage.get('model')}" if usage else "llm",
        "usage": usage,
        "brief": brief.to_metadata(),
        "prompt_excerpt": user[:2500],
        "response_excerpt": str(data.get("caption") or last_caption or "")[:1500],
    }
    yield {"type": "status", "message": "Polishing hashtags & CTA…"}
    yield {"type": "result", "data": result}
