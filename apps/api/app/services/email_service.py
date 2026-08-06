"""Transactional email via Resend / Brevo with Super Admin failover."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.secrets import decrypt_secret
from app.models.entities import EmailProviderConfig, EmailProviderKind

logger = logging.getLogger(__name__)


class EmailError(Exception):
    pass


@dataclass
class EmailRuntime:
    id: str
    kind: str
    name: str
    api_key: str
    from_email: str
    from_name: str
    reply_to: str | None
    config: EmailProviderConfig | None = None


async def load_active_email_providers(db: AsyncSession) -> list[EmailRuntime]:
    rows = await db.scalars(
        select(EmailProviderConfig)
        .where(
            EmailProviderConfig.deleted_at.is_(None),
            EmailProviderConfig.is_active.is_(True),
        )
        .order_by(EmailProviderConfig.priority.asc(), EmailProviderConfig.created_at.asc())
    )
    out: list[EmailRuntime] = []
    for row in rows:
        try:
            key = decrypt_secret(row.api_key_encrypted)
        except Exception:
            logger.warning("Skipping email provider %s — cannot decrypt", row.name)
            continue
        kind = row.kind.value if hasattr(row.kind, "value") else str(row.kind)
        out.append(
            EmailRuntime(
                id=str(row.id),
                kind=kind,
                name=row.name,
                api_key=key,
                from_email=row.from_email,
                from_name=row.from_name,
                reply_to=row.reply_to,
                config=row,
            )
        )
    return out


async def _send_resend(runtime: EmailRuntime, *, to: str, subject: str, html: str) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "from": f"{runtime.from_name} <{runtime.from_email}>",
        "to": [to],
        "subject": subject,
        "html": html,
    }
    if runtime.reply_to:
        payload["reply_to"] = runtime.reply_to
    async with httpx.AsyncClient(timeout=30.0) as client:
        res = await client.post(
            "https://api.resend.com/emails",
            headers={
                "Authorization": f"Bearer {runtime.api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
        )
        if res.status_code >= 400:
            raise EmailError(f"Resend HTTP {res.status_code}: {res.text[:400]}")
        data = res.json() if res.content else {}
        return {"provider": "resend", "id": data.get("id"), "raw": data}


async def _send_brevo(runtime: EmailRuntime, *, to: str, subject: str, html: str) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "sender": {"name": runtime.from_name, "email": runtime.from_email},
        "to": [{"email": to}],
        "subject": subject,
        "htmlContent": html,
    }
    if runtime.reply_to:
        payload["replyTo"] = {"email": runtime.reply_to}
    async with httpx.AsyncClient(timeout=30.0) as client:
        res = await client.post(
            "https://api.brevo.com/v3/smtp/email",
            headers={
                "api-key": runtime.api_key,
                "Content-Type": "application/json",
                "accept": "application/json",
            },
            json=payload,
        )
        if res.status_code >= 400:
            raise EmailError(f"Brevo HTTP {res.status_code}: {res.text[:400]}")
        data = res.json() if res.content else {}
        return {"provider": "brevo", "id": data.get("messageId"), "raw": data}


async def send_email(
    db: AsyncSession,
    *,
    to: str,
    subject: str,
    html: str,
) -> dict[str, Any]:
    providers = await load_active_email_providers(db)
    if not providers:
        raise EmailError("No active email providers. Configure Resend or Brevo in Super Admin.")

    errors: list[str] = []
    for runtime in providers:
        try:
            if runtime.kind == EmailProviderKind.resend.value:
                result = await _send_resend(runtime, to=to, subject=subject, html=html)
            elif runtime.kind == EmailProviderKind.brevo.value:
                result = await _send_brevo(runtime, to=to, subject=subject, html=html)
            else:
                raise EmailError(f"Unsupported email kind: {runtime.kind}")
            if runtime.config is not None:
                runtime.config.last_ok_at = datetime.now(timezone.utc)
                runtime.config.last_error = None
                await db.flush()
            return {**result, "provider_name": runtime.name}
        except Exception as exc:
            msg = f"{runtime.name}: {exc}"
            logger.warning("Email send failed: %s", msg)
            errors.append(msg)
            if runtime.config is not None:
                runtime.config.last_error = str(exc)[:2000]
                await db.flush()
    raise EmailError("All email providers failed: " + " | ".join(errors[:3]))


async def test_email_provider(runtime: EmailRuntime, *, to: str) -> dict[str, Any]:
    subject = "PejuAfrica Email Fabric probe"
    html = (
        "<p>This is a test from <strong>PejuAfrica Email Fabric</strong>.</p>"
        f"<p>Provider: {runtime.kind} · {runtime.name}</p>"
    )
    if runtime.kind == EmailProviderKind.resend.value:
        return await _send_resend(runtime, to=to, subject=subject, html=html)
    if runtime.kind == EmailProviderKind.brevo.value:
        return await _send_brevo(runtime, to=to, subject=subject, html=html)
    raise EmailError(f"Unsupported email kind: {runtime.kind}")


def invite_email_html(
    *,
    org_name: str,
    inviter_name: str,
    role: str,
    invite_url: str,
    invitee_name: str | None = None,
) -> str:
    greeting = f"Hi {invitee_name}," if invitee_name else "Hi,"
    return f"""
    <div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;color:#14261c">
      <p style="font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#3dd68c">PejuAfrica</p>
      <h1 style="font-size:28px;line-height:1.2">You're invited to {org_name}</h1>
      <p>{greeting}</p>
      <p><strong>{inviter_name}</strong> invited you to collaborate on their AI marketing workspace
      as <strong>{role}</strong>.</p>
      <p style="margin:28px 0">
        <a href="{invite_url}"
           style="background:#1a3a2a;color:#fff;padding:14px 22px;border-radius:999px;text-decoration:none;font-weight:600">
          Accept invite
        </a>
      </p>
      <p style="font-size:13px;color:#5a6b60">This link expires in 7 days. If you didn't expect this, ignore the email.</p>
    </div>
    """


def welcome_verify_email_html(*, full_name: str, verify_url: str) -> str:
    return f"""
    <div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;color:#14261c">
      <p style="font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#3dd68c">PejuAfrica</p>
      <h1 style="font-size:28px;line-height:1.2">Welcome, {full_name}</h1>
      <p>Your AI marketing workspace is ready. Confirm your email to keep the account secure.</p>
      <p style="margin:28px 0">
        <a href="{verify_url}"
           style="background:#1a3a2a;color:#fff;padding:14px 22px;border-radius:999px;text-decoration:none;font-weight:600">
          Verify email
        </a>
      </p>
      <p style="font-size:13px;color:#5a6b60">This link expires in 24 hours.</p>
    </div>
    """


def password_reset_code_html(*, full_name: str, code: str) -> str:
    return f"""
    <div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;color:#14261c">
      <p style="font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#3dd68c">PejuAfrica</p>
      <h1 style="font-size:28px;line-height:1.2">Reset your password</h1>
      <p>Hi {full_name}, use this code to reset your password:</p>
      <p style="font-size:36px;letter-spacing:.28em;font-weight:700;margin:24px 0">{code}</p>
      <p style="font-size:13px;color:#5a6b60">Expires in 15 minutes. If you didn't ask for this, ignore the email.</p>
    </div>
    """


def password_changed_html(*, full_name: str) -> str:
    return f"""
    <div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;color:#14261c">
      <p style="font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#3dd68c">PejuAfrica</p>
      <h1 style="font-size:28px;line-height:1.2">Password updated</h1>
      <p>Hi {full_name}, your PejuAfrica password was changed successfully.</p>
      <p style="font-size:13px;color:#5a6b60">If this wasn't you, reset your password immediately and contact support.</p>
    </div>
    """
