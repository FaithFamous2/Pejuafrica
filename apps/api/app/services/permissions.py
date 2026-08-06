"""Team permission helpers — role defaults + optional membership overrides."""

from __future__ import annotations

from app.models.entities import Membership, MembershipRole

# Fine-grained flags
PERMISSIONS = (
    "plan.view",
    "plan.edit",
    "plan.generate",
    "graphics.generate",
    "media.upload",
    "media.manage",
    "posts.approve",
    "members.invite",
    "members.manage",
)

ROLE_DEFAULTS: dict[MembershipRole, set[str]] = {
    MembershipRole.owner: set(PERMISSIONS),
    MembershipRole.admin: {
        "plan.view",
        "plan.edit",
        "plan.generate",
        "graphics.generate",
        "media.upload",
        "media.manage",
        "posts.approve",
        "members.invite",
        "members.manage",
    },
    MembershipRole.editor: {
        "plan.view",
        "plan.edit",
        "plan.generate",
        "graphics.generate",
        "media.upload",
        "media.manage",
        "posts.approve",
    },
    MembershipRole.generator: {
        "plan.view",
        "plan.generate",
        "graphics.generate",
        "media.upload",
    },
    MembershipRole.member: {
        "plan.view",
        "plan.edit",
        "plan.generate",
        "graphics.generate",
        "media.upload",
        "posts.approve",
    },
    MembershipRole.viewer: {"plan.view"},
}


def role_permissions(role: MembershipRole | str) -> set[str]:
    if isinstance(role, str):
        try:
            role = MembershipRole(role)
        except ValueError:
            return {"plan.view"}
    return set(ROLE_DEFAULTS.get(role, {"plan.view"}))


def effective_permissions(membership: Membership | None) -> set[str]:
    if membership is None:
        return set()
    base = role_permissions(membership.role)
    overrides = membership.permissions_json or {}
    # overrides: {"plan.edit": true/false, ...}
    for key, enabled in overrides.items():
        if key not in PERMISSIONS:
            continue
        if enabled:
            base.add(key)
        else:
            base.discard(key)
    return base


def has_permission(membership: Membership | None, permission: str, *, is_platform_admin: bool = False) -> bool:
    if is_platform_admin:
        return True
    return permission in effective_permissions(membership)
