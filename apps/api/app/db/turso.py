"""
Turso / libSQL client — tenant operational store.

Postgres remains the system of record for users, tenants, billing, campaigns, content.
Turso stores high-churn operational data:
  - activity_events (dashboard activity feed)
  - feature_flags (per-tenant flags)

Local fallback: embedded SQLite file when TURSO_DATABASE_URL is empty.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import libsql_client

from app.core.config import get_settings

_SCHEMA_STATEMENTS = [
    """
    CREATE TABLE IF NOT EXISTS activity_events (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        actor_user_id TEXT,
        event_type TEXT NOT NULL,
        title TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
    )
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_activity_tenant_created
        ON activity_events (tenant_id, created_at DESC)
    """,
    """
    CREATE TABLE IF NOT EXISTS feature_flags (
        tenant_id TEXT NOT NULL,
        flag_key TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 0,
        payload_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, flag_key)
    )
    """,
]


class TursoClient:
    def __init__(self) -> None:
        settings = get_settings()
        if settings.turso_database_url:
            self._client = libsql_client.create_client_sync(
                url=settings.turso_database_url,
                auth_token=settings.turso_auth_token or None,
            )
        else:
            data_dir = Path(__file__).resolve().parents[2] / "data"
            data_dir.mkdir(parents=True, exist_ok=True)
            db_path = data_dir / "turso_local.db"
            self._client = libsql_client.create_client_sync(url=f"file:{db_path}")

    def init_schema(self) -> None:
        for statement in _SCHEMA_STATEMENTS:
            self._client.execute(statement)

    def insert_activity(
        self,
        *,
        event_id: str,
        tenant_id: str,
        actor_user_id: str | None,
        event_type: str,
        title: str,
        metadata: dict[str, Any] | None,
        created_at: str,
    ) -> None:
        self._client.execute(
            """
            INSERT INTO activity_events
                (id, tenant_id, actor_user_id, event_type, title, metadata_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            [
                event_id,
                tenant_id,
                actor_user_id,
                event_type,
                title,
                json.dumps(metadata or {}),
                created_at,
            ],
        )

    def list_activity(self, tenant_id: str, limit: int = 20) -> list[dict[str, Any]]:
        result = self._client.execute(
            """
            SELECT id, tenant_id, actor_user_id, event_type, title, metadata_json, created_at
            FROM activity_events
            WHERE tenant_id = ?
            ORDER BY created_at DESC
            LIMIT ?
            """,
            [tenant_id, limit],
        )
        rows: list[dict[str, Any]] = []
        for row in result.rows:
            rows.append(
                {
                    "id": row[0],
                    "tenant_id": row[1],
                    "actor_user_id": row[2],
                    "event_type": row[3],
                    "title": row[4],
                    "metadata": json.loads(row[5] or "{}"),
                    "created_at": row[6],
                }
            )
        return rows

    def close(self) -> None:
        self._client.close()


_turso: TursoClient | None = None


def get_turso() -> TursoClient:
    global _turso
    if _turso is None:
        _turso = TursoClient()
        _turso.init_schema()
    return _turso
