"""Helpers for brand media library + post attachments."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.entities import ContentPost, ContentPostMedia, MediaAsset, MediaSource


def media_asset_dict(asset: MediaAsset) -> dict:
    return {
        "id": asset.id,
        "url": asset.url,
        "public_id": asset.public_id,
        "filename": asset.filename,
        "title": asset.title,
        "mime_type": asset.mime_type,
        "source": asset.source.value if hasattr(asset.source, "value") else str(asset.source),
        "width": asset.width,
        "height": asset.height,
        "bytes": asset.bytes,
        "role": asset.role,
        "origin_post_id": asset.origin_post_id,
        "created_at": asset.created_at,
        "meta_json": asset.meta_json or {},
    }


async def load_post_with_media(
    db: AsyncSession,
    *,
    post_id: uuid.UUID,
    tenant_id: uuid.UUID,
) -> ContentPost | None:
    return await db.scalar(
        select(ContentPost)
        .where(
            ContentPost.id == post_id,
            ContentPost.tenant_id == tenant_id,
            ContentPost.deleted_at.is_(None),
        )
        .options(selectinload(ContentPost.media_links).selectinload(ContentPostMedia.asset))
    )


def serialize_post_media(post: ContentPost) -> list[dict]:
    items: list[dict] = []
    links = sorted(post.media_links or [], key=lambda x: x.sort_order)
    for link in links:
        asset = link.asset
        if not asset or asset.deleted_at is not None:
            continue
        item = media_asset_dict(asset)
        item["sort_order"] = link.sort_order
        item["attachment_role"] = link.role or asset.role
        items.append(item)
    return items


def post_response_dict(post: ContentPost) -> dict:
    media = serialize_post_media(post)
    primary = media[0]["url"] if media else post.graphic_url
    return {
        "id": post.id,
        "campaign_id": post.campaign_id,
        "scheduled_date": post.scheduled_date,
        "day_index": post.day_index,
        "platform": post.platform,
        "theme": post.theme,
        "caption": post.caption,
        "hashtags": post.hashtags,
        "cta": post.cta,
        "graphic_prompt": post.graphic_prompt,
        "graphic_url": primary,
        "status": post.status.value if hasattr(post.status, "value") else str(post.status),
        "media": media,
        "media_count": len(media),
    }


async def next_sort_order(db: AsyncSession, post_id: uuid.UUID) -> int:
    current = await db.scalar(
        select(func.coalesce(func.max(ContentPostMedia.sort_order), -1)).where(
            ContentPostMedia.post_id == post_id
        )
    )
    return int(current) + 1


async def attach_asset_to_post(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    post: ContentPost,
    asset: MediaAsset,
    role: str | None = None,
    sort_order: int | None = None,
) -> ContentPostMedia:
    existing = await db.scalar(
        select(ContentPostMedia).where(
            ContentPostMedia.post_id == post.id,
            ContentPostMedia.media_asset_id == asset.id,
        )
    )
    if existing:
        if role:
            existing.role = role
        # Ensure the in-memory collection stays in sync (delete-orphan)
        if existing not in (post.media_links or []):
            post.media_links.append(existing)
        return existing

    order = sort_order if sort_order is not None else await next_sort_order(db, post.id)
    link = ContentPostMedia(
        tenant_id=tenant_id,
        post_id=post.id,
        media_asset_id=asset.id,
        sort_order=order,
        role=role or asset.role,
    )
    # Wire both sides so serialize_post_media sees asset without a lazy load,
    # and delete-orphan keeps every attached slide.
    link.asset = asset
    post.media_links.append(link)
    # Keep legacy single URL in sync with first attached asset
    if not post.graphic_url or order == 0:
        post.graphic_url = asset.url
    await db.flush()
    return link


async def create_media_asset(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    url: str,
    source: MediaSource,
    public_id: str | None = None,
    filename: str | None = None,
    title: str | None = None,
    mime_type: str | None = None,
    width: int | None = None,
    height: int | None = None,
    bytes_count: int | None = None,
    role: str | None = None,
    origin_post_id: uuid.UUID | None = None,
    meta_json: dict | None = None,
) -> MediaAsset:
    asset = MediaAsset(
        tenant_id=tenant_id,
        url=url,
        public_id=public_id,
        filename=filename,
        title=title,
        mime_type=mime_type,
        source=source,
        width=width,
        height=height,
        bytes=bytes_count,
        role=role,
        origin_post_id=origin_post_id,
        meta_json=meta_json,
    )
    db.add(asset)
    await db.flush()
    await db.refresh(asset)
    return asset


async def sync_post_primary_url(db: AsyncSession, post: ContentPost) -> None:
    """Set graphic_url from the first attached media (or clear)."""
    first = await db.scalar(
        select(ContentPostMedia)
        .where(ContentPostMedia.post_id == post.id)
        .order_by(ContentPostMedia.sort_order.asc())
        .limit(1)
        .options(selectinload(ContentPostMedia.asset))
    )
    if first and first.asset and first.asset.deleted_at is None:
        post.graphic_url = first.asset.url
    else:
        post.graphic_url = None
    await db.flush()
