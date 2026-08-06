"""Tenant dashboard helpers: activity feed from Turso."""

from __future__ import annotations

from fastapi import APIRouter, Query

from app.core.deps import CurrentAuth
from app.db.turso import get_turso
from app.schemas.auth import ActivityEventResponse

router = APIRouter(prefix="/activity", tags=["activity"])


@router.get("", response_model=list[ActivityEventResponse])
async def list_activity(auth: CurrentAuth, limit: int = Query(default=20, ge=1, le=100)):
    tenant = auth.require_tenant()
    rows = get_turso().list_activity(str(tenant.id), limit=limit)
    return [
        ActivityEventResponse(
            id=row["id"],
            event_type=row["event_type"],
            title=row["title"],
            metadata=row["metadata"],
            created_at=row["created_at"],
        )
        for row in rows
    ]
