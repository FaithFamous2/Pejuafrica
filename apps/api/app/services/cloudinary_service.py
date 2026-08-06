"""Cloudinary media uploads via signed REST API (no SDK required).

Credentials load from Super Admin DB first, then CLOUDINARY_* env fallback.
"""

from __future__ import annotations

import hashlib
import logging
import time
from dataclasses import dataclass

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.secrets import decrypt_secret
from app.models import CloudinaryConfig

logger = logging.getLogger(__name__)


class CloudinaryError(Exception):
    pass


@dataclass
class CloudinaryRuntime:
    cloud_name: str
    api_key: str
    api_secret: str
    folder_prefix: str
    source: str  # "db" | "env"


async def load_cloudinary_runtime(db: AsyncSession | None = None) -> CloudinaryRuntime | None:
    if db is not None:
        row = await db.scalar(
            select(CloudinaryConfig)
            .where(CloudinaryConfig.is_active.is_(True))
            .order_by(CloudinaryConfig.updated_at.desc())
        )
        if row:
            try:
                return CloudinaryRuntime(
                    cloud_name=row.cloud_name,
                    api_key=decrypt_secret(row.api_key_encrypted),
                    api_secret=decrypt_secret(row.api_secret_encrypted),
                    folder_prefix=row.folder_prefix or "pejuafrica",
                    source="db",
                )
            except Exception:
                logger.warning("Cloudinary DB credentials could not be decrypted")

    settings = get_settings()
    if settings.cloudinary_cloud_name and settings.cloudinary_api_key and settings.cloudinary_api_secret:
        return CloudinaryRuntime(
            cloud_name=settings.cloudinary_cloud_name,
            api_key=settings.cloudinary_api_key,
            api_secret=settings.cloudinary_api_secret,
            folder_prefix=settings.cloudinary_folder_prefix or "pejuafrica",
            source="env",
        )
    return None


def _sign(params: dict[str, str], api_secret: str) -> str:
    """Cloudinary signature: sha1 of sorted key=value pairs + api_secret."""
    payload = "&".join(f"{k}={params[k]}" for k in sorted(params.keys()) if params[k] is not None)
    return hashlib.sha1(f"{payload}{api_secret}".encode("utf-8")).hexdigest()


async def upload_image_bytes(
    db: AsyncSession | None,
    *,
    data: bytes,
    filename: str,
    folder: str,
    resource_type: str = "image",
) -> dict:
    runtime = await load_cloudinary_runtime(db)
    if not runtime:
        raise CloudinaryError(
            "Cloudinary is not configured. Add credentials in Super Admin → Media, "
            "or set CLOUDINARY_* env vars."
        )

    prefix = runtime.folder_prefix.strip("/")
    full_folder = f"{prefix}/{folder}".strip("/")
    timestamp = str(int(time.time()))
    to_sign = {
        "folder": full_folder,
        "timestamp": timestamp,
        "unique_filename": "true",
        "use_filename": "true",
    }
    signature = _sign(to_sign, runtime.api_secret)
    url = f"https://api.cloudinary.com/v1_1/{runtime.cloud_name}/{resource_type}/upload"

    files = {"file": (filename, data)}
    form = {
        **to_sign,
        "api_key": runtime.api_key,
        "signature": signature,
    }

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            res = await client.post(url, data=form, files=files)
    except Exception as exc:
        raise CloudinaryError(f"Cloudinary upload failed: {exc}") from exc

    if res.status_code >= 400:
        raise CloudinaryError(f"Cloudinary HTTP {res.status_code}: {res.text[:400]}")

    result = res.json()
    secure_url = result.get("secure_url") or result.get("url")
    if not secure_url:
        raise CloudinaryError("Cloudinary returned no URL")
    return {
        "url": secure_url,
        "public_id": result.get("public_id"),
        "bytes": result.get("bytes"),
        "format": result.get("format"),
        "width": result.get("width"),
        "height": result.get("height"),
        "source": runtime.source,
    }
