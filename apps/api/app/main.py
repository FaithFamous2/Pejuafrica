"""PejuAfrica FastAPI application entrypoint."""

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from app.api.v1.router import api_router
from app.core.config import get_settings
from app.core.security_headers import SecurityHeadersMiddleware
from app.db.base import Base
from app.db.postgres import AsyncSessionLocal, engine
from app.db.schema_patches import apply_schema_patches
from app.db.turso import get_turso
from app.services.auth_service import ensure_bootstrap_superadmin
from app.services.prompt_seed import ensure_default_prompts

# Import models so metadata is populated
import app.models  # noqa: F401


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Dev convenience: create tables. Prefer Alembic in staging/prod.
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await apply_schema_patches(conn)

    get_turso().init_schema()

    settings = get_settings()
    upload_root = Path(settings.upload_dir)
    if not upload_root.is_absolute():
        upload_root = Path.cwd() / upload_root
    upload_root.mkdir(parents=True, exist_ok=True)

    async with AsyncSessionLocal() as session:
        await ensure_bootstrap_superadmin(session)
        await ensure_default_prompts(session)
        await session.commit()

    yield
    await engine.dispose()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title=settings.app_name,
        version="0.5.0",
        lifespan=lifespan,
    )
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(api_router, prefix=settings.api_v1_prefix)

    upload_root = Path(settings.upload_dir)
    if not upload_root.is_absolute():
        upload_root = Path.cwd() / upload_root
    upload_root.mkdir(parents=True, exist_ok=True)
    app.mount("/uploads", StaticFiles(directory=str(upload_root)), name="uploads")

    @app.get("/health")
    async def health():
        return {
            "status": "ok",
            "service": settings.app_name,
            "env": settings.app_env,
            "version": "0.5.0",
        }

    @app.get("/ready")
    async def ready():
        checks: dict = {
            "postgres": False,
            "turso": False,
            "llm_env": settings.llm_enabled,
        }
        try:
            async with engine.connect() as conn:
                await conn.execute(text("SELECT 1"))
            checks["postgres"] = True
        except Exception as exc:
            checks["postgres_error"] = str(exc)

        try:
            get_turso().list_activity("__health__", limit=1)
            checks["turso"] = True
        except Exception as exc:
            checks["turso_error"] = str(exc)

        active_llm = 0
        try:
            async with AsyncSessionLocal() as session:
                from sqlalchemy import func, select
                from app.models import LlmProviderConfig

                active_llm = await session.scalar(
                    select(func.count())
                    .select_from(LlmProviderConfig)
                    .where(
                        LlmProviderConfig.deleted_at.is_(None),
                        LlmProviderConfig.is_active.is_(True),
                    )
                ) or 0
        except Exception:
            active_llm = 0
        checks["llm_providers_active"] = int(active_llm)

        ok = checks["postgres"] and checks["turso"]
        return {
            "status": "ready" if ok else "degraded",
            "checks": checks,
            "llm_mode": "providers"
            if active_llm
            else ("openai_env" if settings.llm_enabled else "template"),
        }

    return app


app = create_app()
