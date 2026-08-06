"""Brand media library — upload, list, delete, AI redesign, reusable across posts."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, Query, Request, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.core.deps import CurrentAuth, DbSession
from app.core.rate_limit import enforce_rate_limit
from app.db.turso import get_turso
from app.models import LlmUsageEvent, MembershipRole
from app.models.entities import BusinessProfile, MediaAsset, MediaSource
from app.services.media_service import create_media_asset, media_asset_dict

router = APIRouter(prefix="/media", tags=["media"])

ALLOWED_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/svg+xml": ".svg",
}
MAX_BYTES = 8 * 1024 * 1024


class MediaAssetResponse(BaseModel):
    id: uuid.UUID
    url: str
    public_id: str | None = None
    filename: str | None = None
    title: str | None = None
    mime_type: str | None = None
    source: str
    width: int | None = None
    height: int | None = None
    bytes: int | None = None
    role: str | None = None
    origin_post_id: uuid.UUID | None = None
    created_at: datetime
    meta_json: dict[str, Any] = Field(default_factory=dict)

    model_config = {"from_attributes": True}


class SuggestRedesignPromptRequest(BaseModel):
    notes: str | None = Field(default=None, max_length=800)


class SuggestRedesignPromptResponse(BaseModel):
    prompt: str
    source: str = "heuristic"
    mode: str  # fork|iterate for asset
    suggest_mode: str = "enhance"  # enhance | draft
    intent: str = "general"
    message: str = ""
    suggestions: list[dict] = Field(default_factory=list)


class RedesignMediaRequest(BaseModel):
    prompt: str = Field(min_length=3, max_length=1200)
    chat_notes: str | None = Field(default=None, max_length=2000)
    intent: str | None = Field(default=None, max_length=40)


class RedesignMediaResponse(BaseModel):
    asset: MediaAssetResponse
    mode: str
    kept_original: bool
    message: str
    intent: str = "general"
    overlay: dict | None = None


def _asset_mode(asset: MediaAsset) -> str:
    src = asset.source.value if hasattr(asset.source, "value") else str(asset.source)
    return "iterate" if src == MediaSource.ai_generated.value else "fork"


@router.get("", response_model=list[MediaAssetResponse])
async def list_media(
    auth: CurrentAuth,
    db: DbSession,
    source: str | None = Query(default=None, pattern="^(upload|ai_generated)$"),
    limit: int = Query(default=60, ge=1, le=200),
):
    tenant = auth.require_tenant()
    q = select(MediaAsset).where(
        MediaAsset.tenant_id == tenant.id,
        MediaAsset.deleted_at.is_(None),
    )
    if source:
        q = q.where(MediaAsset.source == MediaSource(source))
    q = q.order_by(MediaAsset.created_at.desc()).limit(limit)
    rows = (await db.scalars(q)).all()
    return [MediaAssetResponse(**media_asset_dict(r)) for r in rows]


@router.post("/upload", response_model=MediaAssetResponse)
async def upload_media(
    auth: CurrentAuth,
    db: DbSession,
    file: UploadFile = File(...),
    title: str | None = Form(default=None),
):
    """Upload brand media into the reusable library (Cloudinary)."""
    from app.services.cloudinary_service import CloudinaryError, upload_image_bytes

    tenant = auth.require_tenant()
    auth.require_roles(MembershipRole.owner, MembershipRole.admin, MembershipRole.member)

    content_type = (file.content_type or "").lower()
    if content_type not in ALLOWED_TYPES:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Media must be JPEG, PNG, WebP, GIF, or SVG",
        )

    data = await file.read()
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Empty file")
    if len(data) > MAX_BYTES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="File must be under 8MB")

    ext = ALLOWED_TYPES[content_type]
    safe_name = (file.filename or f"upload{ext}")[:180]
    try:
        uploaded = await upload_image_bytes(
            db,
            data=data,
            filename=safe_name if "." in safe_name else f"{safe_name}{ext}",
            folder=f"tenants/{tenant.id}/library",
        )
    except CloudinaryError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    asset = await create_media_asset(
        db,
        tenant_id=tenant.id,
        url=uploaded["url"],
        source=MediaSource.upload,
        public_id=uploaded.get("public_id"),
        filename=safe_name,
        title=(title or safe_name)[:255],
        mime_type=content_type,
        width=uploaded.get("width"),
        height=uploaded.get("height"),
        bytes_count=uploaded.get("bytes") or len(data),
        role="upload",
        meta_json={"storage": "cloudinary"},
    )

    try:
        get_turso().insert_activity(
            event_id=str(uuid.uuid4()),
            tenant_id=str(tenant.id),
            actor_user_id=str(auth.user.id),
            event_type="media.uploaded",
            title=f"Uploaded media: {asset.title or asset.filename}",
            metadata={"media_id": str(asset.id), "url": asset.url},
            created_at=datetime.now(timezone.utc).isoformat(),
        )
    except Exception:
        pass

    return MediaAssetResponse(**media_asset_dict(asset))


@router.post("/{media_id}/suggest-redesign-prompt", response_model=SuggestRedesignPromptResponse)
async def suggest_redesign_prompt_endpoint(
    media_id: uuid.UUID,
    auth: CurrentAuth,
    db: DbSession,
    request: Request,
    payload: SuggestRedesignPromptRequest | None = None,
):
    """AI rewrites the user's redesign notes into a stronger image prompt."""
    from app.ai.media_redesign import seed_prompt_from_asset, suggest_redesign_prompt
    from app.ai.media_transform import INTENT_SUGGESTIONS, detect_transform_intent

    body = payload or SuggestRedesignPromptRequest()
    enforce_rate_limit(request, scope=f"media-suggest:{auth.user.id}", limit=60, window_seconds=3600)
    tenant = auth.require_tenant()
    auth.require_permission("graphics.generate")

    asset = await db.scalar(
        select(MediaAsset).where(
            MediaAsset.id == media_id,
            MediaAsset.tenant_id == tenant.id,
            MediaAsset.deleted_at.is_(None),
        )
    )
    if not asset:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Media not found")

    profile = await db.scalar(
        select(BusinessProfile).where(
            BusinessProfile.tenant_id == tenant.id,
            BusinessProfile.deleted_at.is_(None),
        )
    )
    business = profile.business_name if profile else tenant.name
    mode = _asset_mode(asset)
    base = seed_prompt_from_asset(title=asset.title, role=asset.role, meta=asset.meta_json)

    result = await suggest_redesign_prompt(
        base_prompt=base,
        notes=body.notes,
        title=asset.title,
        source=str(asset.source.value if hasattr(asset.source, "value") else asset.source),
        business_name=business,
        meta=asset.meta_json or {},
        db=db,
    )
    intent = detect_transform_intent(body.notes or result.get("prompt"))

    usage = result.get("usage")
    if usage:
        db.add(
            LlmUsageEvent(
                tenant_id=tenant.id,
                user_id=auth.user.id,
                feature="media.suggest_redesign_prompt",
                provider=(usage or {}).get("provider", "peju_local"),
                model=(usage or {}).get("model", "unknown"),
                prompt_tokens=int((usage or {}).get("prompt_tokens") or 0),
                completion_tokens=int((usage or {}).get("completion_tokens") or 0),
                total_tokens=int((usage or {}).get("total_tokens") or 0),
                metadata_json={
                    "media_id": str(asset.id),
                    "mode": mode,
                    "suggest_mode": result.get("mode"),
                    "intent": intent,
                },
            )
        )
        await db.flush()

    return SuggestRedesignPromptResponse(
        prompt=str(result.get("prompt") or ""),
        source=str(result.get("source") or "local"),
        mode=mode,
        suggest_mode=str(result.get("mode") or "enhance"),
        intent=intent,
        message=str(result.get("message") or ""),
        suggestions=INTENT_SUGGESTIONS,
    )


@router.post("/{media_id}/redesign", response_model=RedesignMediaResponse)
async def redesign_media(
    media_id: uuid.UUID,
    auth: CurrentAuth,
    db: DbSession,
    request: Request,
    payload: RedesignMediaRequest,
):
    """Transform the working image (flyer / enhance / bg / recolor) — keeps the subject.

    - Uploads → fork (original stays)
    - AI assets → new version in library
    - Flyer/graphic → Neural Fabric draws spell-checked text on top
    """
    from app.ai.image_gen import ImageGenError, generate_with_failover, load_active_image_providers
    from app.ai.media_redesign import seed_prompt_from_asset
    from app.ai.media_transform import (
        analyze_image_brief,
        brief_to_prompt_line,
        build_image_edit_prompt,
        detect_occasion,
        detect_transform_intent,
        fetch_image_bytes,
        local_transform,
        plan_overlay_copy,
        proofread_overlay_fields,
    )
    from app.services.cloudinary_service import CloudinaryError, upload_image_bytes
    from app.services.graphic_compose import compose_marketing_graphic

    enforce_rate_limit(request, scope=f"media-redesign:{auth.user.id}", limit=30, window_seconds=3600)
    tenant = auth.require_tenant()
    auth.require_permission("graphics.generate")

    asset = await db.scalar(
        select(MediaAsset).where(
            MediaAsset.id == media_id,
            MediaAsset.tenant_id == tenant.id,
            MediaAsset.deleted_at.is_(None),
        )
    )
    if not asset:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Media not found")

    profile = await db.scalar(
        select(BusinessProfile).where(
            BusinessProfile.tenant_id == tenant.id,
            BusinessProfile.deleted_at.is_(None),
        )
    )
    business = profile.business_name if profile else tenant.name

    mode = _asset_mode(asset)
    meta = asset.meta_json or {}
    base = seed_prompt_from_asset(title=asset.title, role=asset.role, meta=meta)
    user_prompt = payload.prompt.strip()
    # Map UI chips like flyer_sale → flyer
    raw_intent = (payload.intent or "").strip().lower()
    if raw_intent.startswith("flyer"):
        intent = "flyer"
    elif raw_intent in ("flyer", "graphic", "enhance", "recolor", "bw", "background", "general"):
        intent = raw_intent
    else:
        intent = detect_transform_intent(user_prompt)
    occasion = detect_occasion(user_prompt)

    try:
        source_bytes = await fetch_image_bytes(asset.url)
    except Exception as exc:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=f"Could not load the working image: {exc}",
        ) from exc

    # Always analyse the working image (cheap, local) before creating anything
    image_brief = analyze_image_brief(source_bytes, meta=meta)
    brief_line = brief_to_prompt_line(image_brief)

    providers = await load_active_image_providers(db)
    edit_prompt = build_image_edit_prompt(
        user_prompt=user_prompt,
        intent=intent,
        occasion=occasion,
        image_brief=brief_line,
    )

    engine = "local"
    provider_meta: dict = {"image_brief": image_brief, "occasion": occasion}
    visual_bytes = source_bytes
    overlay_info: dict | None = None

    # Prefer graphic-friendly models for flyer/graphic; photo models otherwise
    agent_intent = "graphic" if intent in ("flyer", "graphic") else "photo"

    if providers:
        try:
            generated = await generate_with_failover(
                db,
                prompt=edit_prompt,
                intent=agent_intent,
                source_image=source_bytes,
            )
            visual_bytes = generated["bytes"]
            engine = "image_edit"
            provider_meta.update(
                {
                    "image_provider": generated.get("provider"),
                    "image_model": generated.get("model"),
                    "provider_name": generated.get("provider_name"),
                    "agent_attempts": generated.get("agent_attempts"),
                    "cost_tier": generated.get("cost_tier"),
                    "used_source_image": True,
                }
            )
        except ImageGenError as exc:
            provider_meta["edit_fallback_reason"] = str(exc)[:300]
            visual_bytes = local_transform(source_bytes, intent=intent, direction=user_prompt)
            engine = "local_transform"
    else:
        visual_bytes = local_transform(source_bytes, intent=intent, direction=user_prompt)
        engine = "local_transform"

    if intent in ("flyer", "graphic"):
        copy = await plan_overlay_copy(
            user_prompt=user_prompt,
            business_name=business,
            title=asset.title,
            intent=intent,
            occasion=occasion,
            image_brief=brief_line,
            db=db,
        )
        copy = proofread_overlay_fields(copy)
        overlay_info = {
            "headline": copy.get("headline"),
            "subline": copy.get("subline"),
            "cta": copy.get("cta"),
            "occasion": copy.get("occasion") or occasion,
            "copy_source": copy.get("source"),
            "proofread": bool(copy.get("proofread")),
        }
        visual_bytes = compose_marketing_graphic(
            background=visual_bytes,
            business_name=business or "PejuAfrica",
            headline=str(copy.get("headline") or "Special offer"),
            subline=copy.get("subline"),
            cta=copy.get("cta"),
            role="cover" if intent == "flyer" else "quote",
        )
        engine = f"{engine}+text_overlay"
        usage = copy.get("usage")
        if usage:
            db.add(
                LlmUsageEvent(
                    tenant_id=tenant.id,
                    user_id=auth.user.id,
                    feature="media.overlay_copy",
                    provider=(usage or {}).get("provider", "peju_local"),
                    model=(usage or {}).get("model", "unknown"),
                    prompt_tokens=int((usage or {}).get("prompt_tokens") or 0),
                    completion_tokens=int((usage or {}).get("completion_tokens") or 0),
                    total_tokens=int((usage or {}).get("total_tokens") or 0),
                    metadata_json={
                        "media_id": str(asset.id),
                        "intent": intent,
                        "occasion": occasion,
                    },
                )
            )

    parent_id = str(meta.get("parent_asset_id") or asset.id)
    root_id = str(asset.id if mode == "fork" else (meta.get("root_asset_id") or asset.id))
    if mode == "fork":
        root_id = str(asset.id)
        parent_id = str(asset.id)

    filename = f"transform-{intent}-{str(asset.id)[:8]}-{uuid.uuid4().hex[:6]}.png"
    try:
        uploaded = await upload_image_bytes(
            db,
            data=visual_bytes,
            filename=filename,
            folder=f"tenants/{tenant.id}/redesigns",
        )
    except CloudinaryError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    title_base = (asset.title or asset.filename or "Media").strip()[:160]
    label = {
        "flyer": "Flyer",
        "graphic": "Graphic",
        "enhance": "Enhanced",
        "recolor": "Recolor",
        "bw": "B&W",
        "background": "New background",
        "general": "Redesign",
    }.get(intent, "Redesign")
    if mode == "fork":
        new_title = f"{label} · {title_base}"[:255]
        message = f"Created an AI {label.lower()} from your upload — original kept."
        if overlay_info:
            occ = overlay_info.get("occasion")
            message += f" Occasion: {occ}." if occ and occ != "general" else ""
            message += " On-image text was proofread and drawn by Neural Fabric."
    else:
        new_title = f"{label} · {title_base}"[:255]
        message = f"Transformed this image ({intent}"
        if occasion and occasion != "general":
            message += f" · {occasion}"
        message += ")."
        message += (
            " Text overlay proofread."
            if overlay_info
            else " Same subject kept from your working image."
        )

    new_asset = await create_media_asset(
        db,
        tenant_id=tenant.id,
        url=uploaded["url"],
        source=MediaSource.ai_generated,
        public_id=uploaded.get("public_id"),
        filename=filename,
        title=new_title,
        mime_type="image/png",
        width=uploaded.get("width") or 1080,
        height=uploaded.get("height") or 1080,
        bytes_count=uploaded.get("bytes") or len(visual_bytes),
        role=intent if intent != "general" else "redesign",
        origin_post_id=asset.origin_post_id,
        meta_json={
            "engine": engine,
            "mode": mode,
            "intent": intent,
            "parent_asset_id": parent_id,
            "root_asset_id": root_id,
            "user_prompt": user_prompt[:800],
            "prompt_excerpt": edit_prompt[:500],
            "prior_prompt": (base or "")[:500],
            "overlay": overlay_info,
            **provider_meta,
        },
    )

    try:
        get_turso().insert_activity(
            event_id=str(uuid.uuid4()),
            tenant_id=str(tenant.id),
            actor_user_id=str(auth.user.id),
            event_type="media.redesigned",
            title=f"AI {intent} ({mode}): {new_title}",
            metadata={
                "media_id": str(new_asset.id),
                "parent_asset_id": parent_id,
                "mode": mode,
                "intent": intent,
                "engine": engine,
            },
            created_at=datetime.now(timezone.utc).isoformat(),
        )
    except Exception:
        pass

    return RedesignMediaResponse(
        asset=MediaAssetResponse(**media_asset_dict(new_asset)),
        mode=mode,
        kept_original=True,
        message=message.strip(),
        intent=intent,
        overlay=overlay_info,
    )


@router.delete("/{media_id}")
async def delete_media(media_id: uuid.UUID, auth: CurrentAuth, db: DbSession):
    tenant = auth.require_tenant()
    auth.require_roles(MembershipRole.owner, MembershipRole.admin, MembershipRole.member)

    asset = await db.scalar(
        select(MediaAsset).where(
            MediaAsset.id == media_id,
            MediaAsset.tenant_id == tenant.id,
            MediaAsset.deleted_at.is_(None),
        )
    )
    if not asset:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Media not found")

    asset.deleted_at = datetime.now(timezone.utc)
    await db.flush()
    return {"ok": True, "id": str(media_id)}
