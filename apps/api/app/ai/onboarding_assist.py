"""Onboarding step assistance — LLM when available, smart templates otherwise."""

from __future__ import annotations

from app.ai.llm import LLMError, complete_json, load_active_providers


INDUSTRY_TEMPLATES = {
    "fashion": {
        "brand_voice": "Warm, stylish, and confident — like a trusted boutique stylist who knows Lagos trends and speaks simply.",
        "target_audience": "Style-conscious women and young professionals who shop for quality outfits, accessories, and occasion wear.",
        "goals": "Grow Instagram reach, drive WhatsApp orders, and turn followers into repeat buyers.",
        "competitors": "Local boutiques and Instagram fashion sellers in the same city",
    },
    "restaurant": {
        "brand_voice": "Friendly, appetizing, and local — celebratory without being loud. Invite people to the table.",
        "target_audience": "Families, office workers nearby, and food lovers looking for reliable meals and weekend hangouts.",
        "goals": "Increase foot traffic, grow delivery/WhatsApp orders, and build a loyal regulars community.",
        "competitors": "Nearby restaurants and popular food spots customers already visit",
    },
    "clinic": {
        "brand_voice": "Calm, trustworthy, and clear — professional care with human warmth. Educate without fear-mongering.",
        "target_audience": "Patients and caregivers seeking reliable healthcare, appointments, and trustworthy medical guidance.",
        "goals": "Build trust, increase appointment bookings, and become the go-to clinic in the community.",
        "competitors": "Nearby clinics and hospitals patients may already know",
    },
    "default": {
        "brand_voice": "Warm, clear, and confident — practical African SME energy that feels human on WhatsApp and Instagram.",
        "target_audience": "Ideal customers in your city who need what you offer and prefer brands that feel local and trustworthy.",
        "goals": "Increase inquiries, grow visibility on social channels, and convert attention into paying customers.",
        "competitors": "Other local businesses serving a similar audience",
    },
}


def _pick_industry_key(industry: str | None) -> str:
    text = (industry or "").lower()
    if any(w in text for w in ("fashion", "boutique", "cloth", "apparel", "beauty", "cosmetic")):
        return "fashion"
    if any(w in text for w in ("restaurant", "food", "cafe", "kitchen", "catering", "eatery")):
        return "restaurant"
    if any(w in text for w in ("clinic", "hospital", "health", "dental", "medical", "pharma")):
        return "clinic"
    return "default"


def template_assist(step: str, context: dict) -> dict:
    tpl = INDUSTRY_TEMPLATES[_pick_industry_key(context.get("industry"))]
    name = context.get("business_name") or "your business"
    industry = context.get("industry") or "your industry"

    if step == "basics":
        return {
            "suggestions": {
                "industry": context.get("industry") or "Local services / retail",
            },
            "helper_text": (
                f"Start simple: name the business clearly and pick the industry customers would search for. "
                f"Example for a similar brand: Fashion boutique, Restaurant, or Healthcare clinic."
            ),
            "source": "template",
        }
    if step == "voice":
        return {
            "suggestions": {"brand_voice": tpl["brand_voice"]},
            "helper_text": f"Peju drafted a voice for {name} in {industry}. Edit anything that doesn’t feel like you.",
            "source": "template",
        }
    if step == "audience":
        return {
            "suggestions": {
                "target_audience": tpl["target_audience"],
                "competitors": tpl["competitors"],
            },
            "helper_text": "Who buys from you most often? Peju filled a starting audience — make it specific to your city.",
            "source": "template",
        }
    if step == "presence":
        handle = "".join(ch for ch in name.lower() if ch.isalnum())[:18] or "yourbrand"
        return {
            "suggestions": {
                "goals": tpl["goals"],
                "socials": f"instagram: @{handle}\nwhatsapp: +234…\nfacebook: {name}",
            },
            "helper_text": "Goals should be measurable. Socials can be updated later — placeholders are fine for now.",
            "source": "template",
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
                f"You can still initialize now and refine later in Settings."
            )
        else:
            helper = (
                f"Looking solid for {name}. Initialize memory and Peju will use your voice, audience, "
                f"and goals to generate a 30-day marketing plan in under 10 minutes."
            )
        return {
            "suggestions": {},
            "helper_text": helper,
            "source": "template",
        }
    return {
        "suggestions": {},
        "helper_text": "Review everything, then initialize AI memory so Peju can write in your brand voice.",
        "source": "template",
    }


async def assist_onboarding_step(step: str, context: dict, db=None) -> dict:
    """Return field suggestions for an onboarding step."""
    fallback = template_assist(step, context)
    providers = await load_active_providers(db)
    if not providers:
        return fallback

    try:
        system = (
            "You are PejuAfrica onboarding coach for African SMEs. "
            "Return ONLY valid JSON. Be practical, local, and concise. "
            "Help users who feel stuck — never leave fields empty."
        )
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
     // only include fields relevant to this step
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
- For step "voice" always suggest brand_voice.
- For step "audience" suggest target_audience and competitors.
- For step "presence" suggest goals and socials.
- For step "init" leave suggestions empty and give a readiness coach note.
- Keep Nigerian/African SME context when relevant.
"""
        data = await complete_json(system=system, user=user, temperature=0.7, db=db)
        usage = data.pop("_usage", None)
        suggestions = data.get("suggestions") if isinstance(data.get("suggestions"), dict) else {}
        # merge with template so empty LLM fields still help
        merged = {**(fallback.get("suggestions") or {}), **{k: v for k, v in suggestions.items() if v}}
        return {
            "suggestions": merged,
            "helper_text": str(data.get("helper_text") or fallback["helper_text"]),
            "source": "llm",
            "usage": usage,
        }
    except LLMError:
        return fallback
