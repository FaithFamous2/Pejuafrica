"""Onboarding step assistance — LLM when available, smart templates otherwise."""

from __future__ import annotations

import re

from app.ai.llm import LLMError, complete_json, load_active_providers


INDUSTRY_TEMPLATES = {
    "fashion": {
        "brand_voice": (
            "Warm, stylish, and confident — like a trusted boutique stylist who knows "
            "Lagos trends and speaks simply. Celebrate how customers look and feel; "
            "avoid stiff corporate jargon. Prefer friendly Instagram captions and clear WhatsApp replies."
        ),
        "target_audience": "Style-conscious women and young professionals who shop for quality outfits, accessories, and occasion wear.",
        "goals": "Grow Instagram reach, drive WhatsApp orders, and turn followers into repeat buyers.",
        "competitors": "Local boutiques and Instagram fashion sellers in the same city",
    },
    "beauty": {
        "brand_voice": (
            "Glow-forward, encouraging, and expert without gatekeeping. Speak like a beauty "
            "pro who wants every customer to feel confident. Keep tips practical; never shame skin or style."
        ),
        "target_audience": "People investing in skincare, haircare, and beauty routines who want trusted product advice.",
        "goals": "Build trust, grow bookings or product sales, and turn clients into referrals.",
        "competitors": "Nearby salons, spas, and beauty brands customers already follow",
    },
    "restaurant": {
        "brand_voice": (
            "Friendly, appetizing, and local — celebratory without being loud. Invite people "
            "to the table. Describe taste and vibe in plain words; keep posts mouth-watering but honest."
        ),
        "target_audience": "Families, office workers nearby, and food lovers looking for reliable meals and weekend hangouts.",
        "goals": "Increase foot traffic, grow delivery/WhatsApp orders, and build a loyal regulars community.",
        "competitors": "Nearby restaurants and popular food spots customers already visit",
    },
    "clinic": {
        "brand_voice": (
            "Calm, trustworthy, and clear — professional care with human warmth. Educate without "
            "fear-mongering. Prefer plain language over medical jargon unless explaining gently."
        ),
        "target_audience": "Patients and caregivers seeking reliable healthcare, appointments, and trustworthy medical guidance.",
        "goals": "Build trust, increase appointment bookings, and become the go-to clinic in the community.",
        "competitors": "Nearby clinics and hospitals patients may already know",
    },
    "retail": {
        "brand_voice": (
            "Helpful, clear, and neighbourly — like a shopkeeper who remembers regulars. "
            "Highlight value and availability; keep promotions honest and easy to act on via WhatsApp."
        ),
        "target_audience": "Local shoppers and families looking for reliable everyday products nearby.",
        "goals": "Increase walk-ins and WhatsApp inquiries, and grow repeat purchases.",
        "competitors": "Nearby shops and markets selling similar products",
    },
    "tech": {
        "brand_voice": (
            "Clear, modern, and confident — explain benefits without buzzword soup. Sound smart "
            "but human; focus on outcomes for African businesses and everyday users."
        ),
        "target_audience": "Founders, SMEs, and professionals adopting digital tools to grow faster.",
        "goals": "Generate qualified leads, explain the product simply, and build trust online.",
        "competitors": "Other tools and agencies serving the same customer segment",
    },
    "default": {
        "brand_voice": (
            "Warm, clear, and confident — practical African SME energy that feels human on "
            "WhatsApp and Instagram. Speak like a trusted local brand: simple words, helpful tone, "
            "no empty hype. Prefer short sentences customers can skim."
        ),
        "target_audience": "Ideal customers in your city who need what you offer and prefer brands that feel local and trustworthy.",
        "goals": "Increase inquiries, grow visibility on social channels, and convert attention into paying customers.",
        "competitors": "Other local businesses serving a similar audience",
    },
}


def _pick_industry_key(industry: str | None) -> str:
    text = (industry or "").lower()
    if any(w in text for w in ("fashion", "boutique", "cloth", "apparel", "wear")):
        return "fashion"
    if any(w in text for w in ("beauty", "cosmetic", "salon", "spa", "skincare", "hair")):
        return "beauty"
    if any(w in text for w in ("restaurant", "food", "cafe", "bakery", "kitchen", "catering", "eatery")):
        return "restaurant"
    if any(w in text for w in ("clinic", "hospital", "health", "dental", "medical", "pharma", "pharmacy")):
        return "clinic"
    if any(w in text for w in ("retail", "grocery", "shop", "store", "ecommerce", "e‑commerce", "e-commerce")):
        return "retail"
    if any(w in text for w in ("tech", "saas", "software", "fintech", "digital", "agency", "marketing")):
        return "tech"
    return "default"


def _clean_text(text: str, limit: int = 900) -> str:
    cleaned = re.sub(r"\s+", " ", (text or "").strip())
    return cleaned[:limit]


def _reshape_goals_template(draft: str, *, name: str, industry: str) -> str:
    raw = _clean_text(draft, 600)
    if not raw:
        return INDUSTRY_TEMPLATES[_pick_industry_key(industry)]["goals"]
    if len(raw) >= 60:
        base = raw.rstrip(".")
        return (
            f"{base}. "
            f"For {name}, keep goals measurable this month — inquiries, sales, or foot traffic — "
            f"and tied to how {industry} customers actually buy."
        )[:700]
    return (
        f"For {name} ({industry}): focus on {raw}. "
        f"Turn that into clear monthly goals — more WhatsApp inquiries, repeat customers, "
        f"and stronger visibility on the channels you already use."
    )[:700]


def _clean_voice(text: str) -> str:
    return _clean_text(text, 900)


def _reshape_voice_template(draft: str, *, name: str, industry: str) -> str:
    """Local rewrite when LLM is unavailable — keep user's meaning, make it usable."""
    raw = _clean_voice(draft)
    if not raw:
        return INDUSTRY_TEMPLATES[_pick_industry_key(industry)]["brand_voice"]

    # If already a solid paragraph, lightly structure it
    if len(raw) >= 80 and ("." in raw or "," in raw):
        base = raw.rstrip(".")
        return (
            f"{base}. "
            f"Write for {name} in {industry} with this same personality on Instagram, WhatsApp, "
            f"and captions — keep language simple, warm, and easy for African SME customers to trust."
        )[:900]

    # Short / fragmented notes → expand into a usable voice brief
    notes = raw
    return (
        f"For {name} ({industry}): sound {notes}. "
        f"Be warm and clear with African SME customers — conversational on WhatsApp and Instagram, "
        f"confident without bragging, and easy to understand. Avoid stiff corporate language; "
        f"prefer short sentences that feel human and local."
    )[:900]


def template_assist(step: str, context: dict, mode: str = "auto") -> dict:
    tpl = INDUSTRY_TEMPLATES[_pick_industry_key(context.get("industry"))]
    name = (context.get("business_name") or "your business").strip() or "your business"
    industry = (context.get("industry") or "your industry").strip() or "your industry"
    existing_voice = _clean_voice(str(context.get("brand_voice") or ""))

    if step == "basics":
        return {
            "suggestions": {
                "industry": context.get("industry") or "Local services / retail",
            },
            "helper_text": (
                "Start simple: name the business clearly and pick the industry customers would search for."
            ),
            "source": "template",
            "mode": mode,
        }
    if step == "voice":
        intent = mode
        if intent == "auto":
            intent = "rewrite" if len(existing_voice) >= 12 else "draft"

        if intent == "rewrite" and existing_voice:
            rewritten = _reshape_voice_template(existing_voice, name=name, industry=industry)
            return {
                "suggestions": {"brand_voice": rewritten},
                "helper_text": (
                    f"Peju reshaped your notes into a clearer brand voice for {name}. "
                    "Edit anything that doesn’t sound like you."
                ),
                "source": "template",
                "mode": "rewrite",
            }

        return {
            "suggestions": {"brand_voice": tpl["brand_voice"]},
            "helper_text": (
                f"Peju drafted a brand voice for {name} in {industry}. "
                "Tweak the tone until it feels like you — then continue."
            ),
            "source": "template",
            "mode": "draft",
        }
    if step == "audience":
        return {
            "suggestions": {
                "target_audience": "Young professionals, Families with kids, WhatsApp-first customers, Local neighbourhood residents",
                "competitors": tpl["competitors"],
            },
            "helper_text": "Pick the audience chips that fit — Peju suggested a starting mix. Add Other for anyone missing.",
            "source": "template",
            "mode": mode,
        }
    if step == "presence":
        handle = "".join(ch for ch in name.lower() if ch.isalnum())[:18] or "yourbrand"
        existing_goals = _clean_text(str(context.get("goals") or ""), 600)
        intent = mode
        if intent == "auto":
            intent = "rewrite" if len(existing_goals) >= 12 else "draft"

        if intent in {"draft", "rewrite"}:
            if intent == "rewrite" and existing_goals:
                return {
                    "suggestions": {
                        "goals": _reshape_goals_template(existing_goals, name=name, industry=industry),
                    },
                    "helper_text": (
                        f"Peju reshaped your goals for {name}. Keep anything that still fits — "
                        "make numbers and channels as specific as you can."
                    ),
                    "source": "template",
                    "mode": "rewrite",
                }
            return {
                "suggestions": {"goals": tpl["goals"]},
                "helper_text": (
                    f"Peju drafted business goals for {name} in {industry}. "
                    "Edit until they match what success looks like for you this month."
                ),
                "source": "template",
                "mode": "draft",
            }

        return {
            "suggestions": {
                "goals": tpl["goals"],
                "socials": f"instagram: @{handle}\nwhatsapp: +234…\nfacebook: {name}\ntiktok: @{handle}",
            },
            "helper_text": "Goals should be measurable. Fill only the socials you actually use.",
            "source": "template",
            "mode": mode,
        }
    if step == "init":
        gaps = []
        if not context.get("brand_voice"):
            gaps.append("brand voice")
        if not context.get("target_audience"):
            gaps.append("audience")
        if not context.get("goals"):
            gaps.append("goals")
        if gaps:
            helper = (
                f"Almost ready — consider filling {', '.join(gaps)} first so Peju writes closer to your brand. "
                "You can still initialize now and refine later in Settings."
            )
        else:
            helper = (
                f"Looking solid for {name}. Initialize memory and Peju will use your voice, audience, "
                "and goals to generate a 30-day marketing plan in under 10 minutes."
            )
        return {
            "suggestions": {},
            "helper_text": helper,
            "source": "template",
            "mode": mode,
        }
    return {
        "suggestions": {},
        "helper_text": "Review everything, then initialize AI memory so Peju can write in your brand voice.",
        "source": "template",
        "mode": mode,
    }


async def assist_onboarding_step(step: str, context: dict, db=None, mode: str = "auto") -> dict:
    """Return field suggestions for an onboarding step.

    mode:
      - auto: draft if empty, rewrite if user already wrote something (voice step)
      - draft: write from scratch
      - rewrite: reshape / improve existing text
    """
    mode = (mode or "auto").strip().lower()
    if mode not in {"auto", "draft", "rewrite"}:
        mode = "auto"

    fallback = template_assist(step, context, mode=mode)
    providers = await load_active_providers(db)
    if not providers:
        return fallback

    existing_voice = _clean_voice(str(context.get("brand_voice") or ""))
    voice_intent = mode
    if step == "voice" and voice_intent == "auto":
        voice_intent = "rewrite" if len(existing_voice) >= 12 else "draft"

    try:
        system = (
            "You are PejuAfrica's onboarding writing coach for African SMEs. "
            "Return ONLY valid JSON. Be practical, local, warm, and concise. "
            "Never leave brand_voice empty on the voice step. "
            "Write in clear English a shop owner can edit in 30 seconds."
        )

        if step == "voice":
            if voice_intent == "rewrite" and existing_voice:
                user = f"""
Onboarding step: voice (REWRITE / RESHAPE)
Business name: {context.get('business_name')}
Industry: {context.get('industry')}

The owner already wrote these brand-voice notes (keep their intent, personality, and meaning):
\"\"\"{existing_voice}\"\"\"

Rewrite into a polished brand voice brief (2–4 short sentences) that PejuAfrica can use for captions and WhatsApp.
Keep their ideas — improve clarity, flow, and usefulness. Do NOT invent a totally different personality.
Include: tone, how to speak to customers, and what to avoid if obvious from their notes.

Return JSON:
{{
  "suggestions": {{ "brand_voice": "rewritten voice brief" }},
  "helper_text": "1 short sentence explaining what you improved"
}}
"""
            else:
                user = f"""
Onboarding step: voice (DRAFT FROM SCRATCH)
Business name: {context.get('business_name')}
Industry: {context.get('industry')}
Owner notes (may be empty): {existing_voice or "(none — invent a strong starting voice)"}

Write a brand voice brief (2–4 short sentences) for this African SME.
Cover: tone/personality, how they speak on Instagram/WhatsApp, and what to avoid.
Make it specific to the business name + industry — not generic filler.

Return JSON:
{{
  "suggestions": {{ "brand_voice": "voice brief" }},
  "helper_text": "1 short sentence inviting the owner to tweak it"
}}
"""
        elif step == "presence" and mode in {"draft", "rewrite"}:
            existing_goals = _clean_text(str(context.get("goals") or ""), 600)
            goals_intent = mode
            if goals_intent == "rewrite" and existing_goals:
                user = f"""
Onboarding step: presence / business goals (REWRITE)
Business name: {context.get('business_name')}
Industry: {context.get('industry')}
Audience: {context.get('target_audience')}

Owner's goal notes:
\"\"\"{existing_goals}\"\"\"

Rewrite into 2–4 clear, measurable business goals for this month for an African SME.
Keep their intent. Prefer concrete outcomes (inquiries, sales, foot traffic, WhatsApp orders).
Do not invent fake numbers they didn't imply.

Return JSON:
{{
  "suggestions": {{ "goals": "polished goals text" }},
  "helper_text": "1 short sentence on what you improved"
}}
"""
            else:
                user = f"""
Onboarding step: presence / business goals (DRAFT)
Business name: {context.get('business_name')}
Industry: {context.get('industry')}
Audience: {context.get('target_audience')}
Owner notes: {existing_goals or "(none)"}

Write 2–4 practical business goals for this African SME for the next 30 days.
Make them specific to the industry and realistic for a small business.

Return JSON:
{{
  "suggestions": {{ "goals": "goals text" }},
  "helper_text": "1 short coaching sentence"
}}
"""
        else:
            user = f"""
Onboarding step: {step}
Current answers:
Business name: {context.get('business_name')}
Industry: {context.get('industry')}
Brand voice: {context.get('brand_voice')}
Audience: {context.get('target_audience')}
Competitors: {context.get('competitors')}
Goals: {context.get('goals')}
Socials: {context.get('socials')}

Return JSON:
{{
  "suggestions": {{
     "industry": "string optional",
     "brand_voice": "string optional",
     "target_audience": "string optional",
     "competitors": "comma-separated string optional",
     "goals": "string optional",
     "socials": "multiline key: value optional"
  }},
  "helper_text": "1-2 sentences coaching the user"
}}

Rules:
- For step "basics" suggest industry if weak/empty.
- For step "audience" suggest target_audience and competitors.
- For step "presence" suggest goals and socials.
- For step "init" leave suggestions empty and give a readiness coach note.
- Keep Nigerian/African SME context when relevant.
"""

        data = await complete_json(system=system, user=user, temperature=0.65, db=db)
        usage = data.pop("_usage", None)
        suggestions = data.get("suggestions") if isinstance(data.get("suggestions"), dict) else {}
        cleaned = {k: str(v).strip() for k, v in suggestions.items() if v and str(v).strip()}

        if step == "voice":
            voice = _clean_voice(cleaned.get("brand_voice") or "")
            if not voice:
                return {**fallback, "usage": usage}
            # Prefer LLM voice fully on voice step (don't dilute with template merge)
            return {
                "suggestions": {"brand_voice": voice},
                "helper_text": str(
                    data.get("helper_text")
                    or (
                        "Peju reshaped your brand voice — edit anything that doesn’t feel like you."
                        if voice_intent == "rewrite"
                        else "Peju drafted a brand voice — tweak it until it sounds like you."
                    )
                ),
                "source": "llm",
                "mode": voice_intent,
                "usage": usage,
            }

        if step == "presence" and mode in {"draft", "rewrite"}:
            goals = _clean_text(cleaned.get("goals") or "", 700)
            if not goals:
                return {**fallback, "usage": usage}
            return {
                "suggestions": {"goals": goals},
                "helper_text": str(
                    data.get("helper_text")
                    or (
                        "Peju reshaped your goals — edit anything that doesn’t fit."
                        if mode == "rewrite"
                        else "Peju drafted your goals — tweak them until they feel real."
                    )
                ),
                "source": "llm",
                "mode": mode,
                "usage": usage,
            }

        merged = {**(fallback.get("suggestions") or {}), **cleaned}
        return {
            "suggestions": merged,
            "helper_text": str(data.get("helper_text") or fallback["helper_text"]),
            "source": "llm",
            "mode": mode,
            "usage": usage,
        }
    except LLMError:
        return fallback
