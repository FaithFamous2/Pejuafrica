"""Cookie helpers for auth tokens."""

from fastapi import Response

from app.core.config import get_settings


def _cookie_kwargs() -> dict:
    settings = get_settings()
    common: dict = {
        "httponly": True,
        "secure": settings.cookie_secure,
        "samesite": "lax",
        "path": "/",
    }
    # Only set Domain when explicitly configured (shared parent domain).
    # Leave empty for Vercel↔Render rewrite deploys so the browser binds
    # cookies to the frontend host.
    domain = (settings.cookie_domain or "").strip()
    if domain and domain not in {"localhost", "127.0.0.1"}:
        common["domain"] = domain
    return common


def set_auth_cookies(response: Response, *, access_token: str, refresh_token: str) -> None:
    settings = get_settings()
    common = _cookie_kwargs()

    response.set_cookie(
        key=settings.access_cookie_name,
        value=access_token,
        max_age=settings.access_token_expire_minutes * 60,
        **common,
    )
    response.set_cookie(
        key=settings.refresh_cookie_name,
        value=refresh_token,
        max_age=settings.refresh_token_expire_days * 24 * 60 * 60,
        **common,
    )


def clear_auth_cookies(response: Response) -> None:
    settings = get_settings()
    common = _cookie_kwargs()
    response.delete_cookie(settings.access_cookie_name, path=common["path"], domain=common.get("domain"))
    response.delete_cookie(settings.refresh_cookie_name, path=common["path"], domain=common.get("domain"))
