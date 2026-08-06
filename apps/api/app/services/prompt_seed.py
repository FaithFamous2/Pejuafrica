"""Seed default global prompt templates."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import PromptTemplate

DEFAULT_PROMPTS = [
    {
        "key": "marketing.campaign_strategy",
        "name": "30-day campaign strategy",
        "description": "System prompt for monthly marketing strategy generation.",
        "body": (
            "You are PejuAfrica, an AI marketing department for African SMEs. "
            "Create a practical 30-day content strategy using the business profile. "
            "Prefer WhatsApp, Instagram, and local cultural tone. Keep CTAs actionable."
        ),
    },
    {
        "key": "marketing.caption",
        "name": "Social caption writer",
        "description": "Prompt for day-level captions in brand voice.",
        "body": (
            "Write a social caption for the given theme and platform. "
            "Match brand voice, speak to the target audience, include one clear CTA, "
            "and keep it scannable for mobile."
        ),
    },
]


async def ensure_default_prompts(db: AsyncSession) -> None:
    for item in DEFAULT_PROMPTS:
        existing = await db.scalar(
            select(PromptTemplate.id).where(
                PromptTemplate.key == item["key"],
                PromptTemplate.deleted_at.is_(None),
            )
        )
        if existing:
            continue
        db.add(
            PromptTemplate(
                key=item["key"],
                name=item["name"],
                description=item["description"],
                body=item["body"],
            )
        )
    await db.flush()
