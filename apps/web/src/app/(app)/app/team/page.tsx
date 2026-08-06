"use client";

import { FormEvent, useEffect, useState } from "react";
import { useApp } from "@/components/app-shell";
import { PageHero } from "@/components/page-hero";
import { api } from "@/lib/api";

const ROLES = ["admin", "editor", "generator", "viewer"] as const;

const PERM_LABELS: Record<string, string> = {
  "plan.view": "View plan",
  "plan.edit": "Edit captions",
  "plan.generate": "Generate / regenerate",
  "graphics.generate": "Generate graphics",
  "media.upload": "Upload media",
  "media.manage": "Manage media",
  "posts.approve": "Approve posts",
  "members.invite": "Invite people",
  "members.manage": "Manage members",
};

export default function TeamPage() {
  const { tenantId, me } = useApp();
  const [members, setMembers] = useState<Awaited<ReturnType<typeof api.listTeamMembers>>>([]);
  const [invites, setInvites] = useState<Awaited<ReturnType<typeof api.listTeamInvites>>>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("viewer");
  const [nameHint, setNameHint] = useState("");
  const [perms, setPerms] = useState<Record<string, boolean>>({});

  async function load() {
    if (!tenantId) return;
    const [m, i] = await Promise.all([
      api.listTeamMembers(tenantId),
      api.listTeamInvites(tenantId),
    ]);
    setMembers(m);
    setInvites(i);
  }

  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : "Failed to load team"));
  }, [tenantId]);

  async function onInvite(e: FormEvent) {
    e.preventDefault();
    if (!tenantId) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const overrides = Object.fromEntries(
        Object.entries(perms).filter(([, v]) => v !== undefined),
      );
      const res = await api.createTeamInvite(tenantId, {
        email,
        role,
        full_name_hint: nameHint || undefined,
        permissions: Object.keys(overrides).length ? overrides : undefined,
      });
      setEmail("");
      setNameHint("");
      setPerms({});
      setMessage(
        res.invite_url
          ? `Invite created. Link (copy if email not configured): ${res.invite_url}`
          : `Invite sent to ${res.email}`,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invite failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <PageHero
        eyebrow="Team"
        title="People & access"
        description="Invite teammates to this marketing workspace and control whether they can view, edit, or generate."
      />

      {(error || message) && (
        <p className={`mt-4 text-sm ${error ? "text-danger" : "text-brand"}`}>{error || message}</p>
      )}

      <form
        onSubmit={onInvite}
        className="mt-8 space-y-4 rounded-[1.5rem] border border-line bg-surface p-6"
      >
        <h2 className="font-display text-xl font-semibold text-brand-deep">Invite someone</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-semibold uppercase tracking-wider text-muted">
            Email
            <input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1.5 w-full rounded-xl border border-line bg-surface-soft/50 px-3 py-2.5 text-sm normal-case tracking-normal text-brand-deep"
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wider text-muted">
            Their name (optional)
            <input
              value={nameHint}
              onChange={(e) => setNameHint(e.target.value)}
              className="mt-1.5 w-full rounded-xl border border-line bg-surface-soft/50 px-3 py-2.5 text-sm normal-case tracking-normal text-brand-deep"
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wider text-muted">
            Role
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="mt-1.5 w-full rounded-xl border border-line bg-surface-soft/50 px-3 py-2.5 text-sm normal-case tracking-normal text-brand-deep"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">
            Extra permissions (optional overrides)
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {Object.entries(PERM_LABELS).map(([key, label]) => (
              <label
                key={key}
                className="flex items-center gap-2 rounded-full border border-line px-3 py-1.5 text-xs text-muted"
              >
                <input
                  type="checkbox"
                  checked={!!perms[key]}
                  onChange={(e) => setPerms((p) => ({ ...p, [key]: e.target.checked }))}
                />
                {label}
              </label>
            ))}
          </div>
        </div>
        <button
          type="submit"
          disabled={busy || !tenantId}
          className="rounded-full bg-brand-deep px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Sending…" : "Send invite"}
        </button>
      </form>

      <section className="mt-8 rounded-[1.5rem] border border-line bg-surface p-6">
        <h2 className="font-display text-xl font-semibold text-brand-deep">Members</h2>
        <ul className="mt-4 divide-y divide-line">
          {members.map((m) => (
            <li key={m.membership_id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <p className="font-semibold text-brand-deep">{m.full_name}</p>
                <p className="text-sm text-muted">
                  {m.email} · <span className="capitalize">{m.role}</span>
                  {m.user_id === me?.user.id ? " · you" : ""}
                </p>
                <p className="mt-1 text-[11px] text-muted">{m.permissions.join(" · ")}</p>
              </div>
              {m.role !== "owner" && m.user_id !== me?.user.id && (
                <button
                  type="button"
                  className="text-xs font-semibold text-danger"
                  onClick={async () => {
                    if (!tenantId || !confirm(`Remove ${m.full_name}?`)) return;
                    await api.removeTeamMember(tenantId, m.membership_id);
                    await load();
                  }}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-6 rounded-[1.5rem] border border-line bg-surface p-6">
        <h2 className="font-display text-xl font-semibold text-brand-deep">Pending invites</h2>
        {invites.filter((i) => !i.accepted_at).length === 0 && (
          <p className="mt-3 text-sm text-muted">No open invites.</p>
        )}
        <ul className="mt-4 space-y-3">
          {invites
            .filter((i) => !i.accepted_at)
            .map((i) => (
              <li
                key={i.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line px-4 py-3"
              >
                <div>
                  <p className="font-medium text-brand-deep">{i.email}</p>
                  <p className="text-xs text-muted capitalize">
                    {i.role} · expires {new Date(i.expires_at).toLocaleDateString()}
                  </p>
                  {i.invite_url && (
                    <button
                      type="button"
                      className="mt-1 text-xs font-semibold text-brand"
                      onClick={() => {
                        void navigator.clipboard.writeText(i.invite_url!);
                        setMessage("Invite link copied");
                      }}
                    >
                      Copy link
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  className="text-xs font-semibold text-danger"
                  onClick={async () => {
                    if (!tenantId) return;
                    await api.revokeTeamInvite(tenantId, i.id);
                    await load();
                  }}
                >
                  Revoke
                </button>
              </li>
            ))}
        </ul>
      </section>
    </div>
  );
}
