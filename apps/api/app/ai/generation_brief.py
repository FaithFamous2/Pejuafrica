"""Marketing generation briefs — tone, focus, and occasion controls."""

from __future__ import annotations

from dataclasses import asdict, dataclass

from pydantic import BaseModel, Field


TONES = [
    {"id": "brand_default", "label": "Brand default", "hint": "Use the voice saved in onboarding"},
    {"id": "warm_human", "label": "Warm & human", "hint": "Friendly, conversational, neighbourly"},
    {"id": "bold_confident", "label": "Bold & confident", "hint": "Strong claims, decisive CTAs"},
    {"id": "premium", "label": "Premium / polished", "hint": "Elevated, calm, high-trust"},
    {"id": "playful", "label": "Playful & witty", "hint": "Light humour without losing clarity"},
    {"id": "educational", "label": "Educational expert", "hint": "Teach first, sell second"},
    {"id": "urgent", "label": "Urgent / scarcity", "hint": "Limited slots, payday push, act now"},
    {"id": "community", "label": "Community pride", "hint": "Local belonging, African SME energy"},
    {"id": "storytelling", "label": "Story-led soft sell", "hint": "Narrative hooks, emotional arc"},
    {"id": "custom", "label": "Custom tone", "hint": "Paste your own tone instructions"},
]

OCCASIONS = [
    {"id": "always_on", "label": "Always-on brand", "hint": "Normal monthly content rhythm"},
    {"id": "product_launch", "label": "Product / service launch", "hint": "Tease, reveal, proof, CTA"},
    {"id": "promo_sale", "label": "Promo / flash sale", "hint": "Offer clarity, urgency, social proof"},
    {"id": "payday", "label": "Payday weekend", "hint": "Timing around salary cycles"},
    {"id": "anniversary", "label": "Anniversary / grand opening", "hint": "Celebrate milestones"},
    {"id": "customer_love", "label": "Customer appreciation", "hint": "Testimonials, gratitude, referrals"},
    {"id": "behind_scenes", "label": "Behind the scenes", "hint": "Team, process, culture"},
    {"id": "festive", "label": "Festive / holiday season", "hint": "Christmas, New Year, local festivities"},
    {"id": "faith_holiday", "label": "Faith / cultural holiday", "hint": "Respectful seasonal messaging"},
    {"id": "independence", "label": "National / Independence Day", "hint": "Pride + brand purpose"},
    {"id": "back_to_school", "label": "Back to school", "hint": "Parents, students, seasonal demand"},
    {"id": "valentines", "label": "Valentine / love season", "hint": "Gifting, couples, self-love"},
    {"id": "awareness_day", "label": "Industry awareness day", "hint": "Thought leadership tied to a cause"},
    {"id": "custom", "label": "Custom occasion", "hint": "Describe your own moment"},
]


class GenerationBriefIn(BaseModel):
    tone_id: str = Field(default="brand_default", max_length=40)
    custom_tone: str | None = Field(default=None, max_length=2000)
    occasion_id: str = Field(default="always_on", max_length=40)
    custom_occasion: str | None = Field(default=None, max_length=500)
    focus: str | None = Field(
        default=None,
        max_length=2000,
        description="What this plan/post should emphasize for the brand",
    )
    extra_notes: str | None = Field(default=None, max_length=2000)
    platform_override: str | None = Field(default=None, max_length=40)


@dataclass
class GenerationBrief:
    tone_id: str = "brand_default"
    custom_tone: str | None = None
    occasion_id: str = "always_on"
    custom_occasion: str | None = None
    focus: str | None = None
    extra_notes: str | None = None
    platform_override: str | None = None

    @classmethod
    def from_payload(cls, payload: GenerationBriefIn | None) -> "GenerationBrief":
        if payload is None:
            return cls()
        return cls(
            tone_id=payload.tone_id or "brand_default",
            custom_tone=(payload.custom_tone or "").strip() or None,
            occasion_id=payload.occasion_id or "always_on",
            custom_occasion=(payload.custom_occasion or "").strip() or None,
            focus=(payload.focus or "").strip() or None,
            extra_notes=(payload.extra_notes or "").strip() or None,
            platform_override=(payload.platform_override or "").strip().lower() or None,
        )

    def tone_label(self) -> str:
        if self.tone_id == "custom" and self.custom_tone:
            return f"Custom: {self.custom_tone[:120]}"
        match = next((t for t in TONES if t["id"] == self.tone_id), None)
        return match["label"] if match else self.tone_id

    def occasion_label(self) -> str:
        if self.occasion_id == "custom" and self.custom_occasion:
            return self.custom_occasion[:120]
        match = next((o for o in OCCASIONS if o["id"] == self.occasion_id), None)
        return match["label"] if match else self.occasion_id

    def resolved_tone_instruction(self, brand_voice: str | None) -> str:
        if self.tone_id == "custom" and self.custom_tone:
            return self.custom_tone
        presets = {
            "brand_default": brand_voice or "Warm, clear, and confident",
            "warm_human": "Warm, human, conversational — like a trusted neighbour helping a friend",
            "bold_confident": "Bold and confident — clear claims, strong verbs, decisive CTAs",
            "premium": "Premium and polished — calm authority, refined language, high trust",
            "playful": "Playful and witty — light humour, still clear and brand-safe",
            "educational": "Educational expert — teach a useful insight before any soft CTA",
            "urgent": "Urgent but respectful — scarcity, payday timing, limited slots — never spammy",
            "community": "Community pride — local belonging, African SME energy, inclusive language",
            "storytelling": "Story-led soft sell — short narrative hook, emotional beat, then offer",
        }
        return presets.get(self.tone_id, brand_voice or "Warm, clear, and confident")

    def to_prompt_block(self, brand_voice: str | None = None) -> str:
        parts = [
            f"Tone: {self.resolved_tone_instruction(brand_voice)}",
            f"Occasion / campaign moment: {self.occasion_label()}",
        ]
        if self.focus:
            parts.append(f"Primary focus for this generation: {self.focus}")
        if self.extra_notes:
            parts.append(f"Extra creative notes: {self.extra_notes}")
        if self.platform_override:
            parts.append(f"Preferred platform: {self.platform_override}")
        return "\n".join(parts)

    def to_metadata(self) -> dict:
        return {
            "tone_id": self.tone_id,
            "tone_label": self.tone_label(),
            "custom_tone": self.custom_tone,
            "occasion_id": self.occasion_id,
            "occasion_label": self.occasion_label(),
            "custom_occasion": self.custom_occasion,
            "focus": self.focus,
            "extra_notes": self.extra_notes,
            "platform_override": self.platform_override,
        }

    def as_dict(self) -> dict:
        return asdict(self)
