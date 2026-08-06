"use client";

import { FormEvent, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useApp } from "@/components/app-shell";
import { PageHero } from "@/components/page-hero";
import {
  AudiencePicker,
  CompetitorTags,
  SocialAccountsFields,
  parseSocialsMap,
  parseTagList,
} from "@/components/brand-profile-fields";
import { useStudioModal } from "@/hooks/use-studio-modal";
import { api } from "@/lib/api";

type Plan = {
  id: string;
  name: string;
  amount_kobo: number;
  amount_naira: number;
  features: string[];
};

type Subscription = Awaited<ReturnType<typeof api.getSubscription>>;
type Profile = NonNullable<ReturnType<typeof useApp>["profile"]>;

export default function SettingsPage() {
  const { me, tenantId, tenantName, profile, refresh } = useApp();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [provider, setProvider] = useState<"paystack" | "flutterwave">("paystack");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    api.getSubscription(tenantId).then(setSubscription).catch(() => setSubscription(null));
    api.listPlans().then((r) => setPlans(r.plans)).catch(() => setPlans([]));
  }, [tenantId]);

  async function checkout(planId: string) {
    if (!tenantId) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await api.startCheckout(tenantId, { plan: planId, provider });
      setMessage(res.message);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Checkout failed");
    } finally {
      setBusy(false);
    }
  }

  async function mockActivate(planId: string) {
    if (!tenantId) return;
    setBusy(true);
    setMessage(null);
    try {
      const sub = await api.activateMockPlan(tenantId, planId);
      setSubscription(sub as Subscription);
      setMessage(`Activated ${sub.plan} plan (dev mock).`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Activation failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <PageHero
        eyebrow="Settings"
        title="Workspace"
        description="Business profile, billing, and account security for your marketing studio."
      />

      <div className="mt-8 space-y-5">
        <section className="rounded-[1.5rem] border border-line bg-surface p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <LogoAvatar
                name={profile?.business_name || tenantName}
                logoUrl={profile?.logo_url}
                size="lg"
              />
              <div>
                <h2 className="font-display text-lg font-semibold text-brand-deep">Business</h2>
                <p className="mt-1 text-sm font-medium text-foreground">
                  {profile?.business_name || tenantName}
                </p>
                <p className="text-sm text-muted">{profile?.industry || "Industry not set"}</p>
                {profile?.brand_voice && (
                  <p className="mt-2 line-clamp-2 max-w-md text-xs text-muted">
                    Voice: {profile.brand_voice}
                  </p>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setEditOpen(true)}
              className="rounded-full bg-brand-deep px-4 py-2 text-sm font-semibold text-white"
            >
              Edit business profile
            </button>
          </div>
        </section>

        <section className="rounded-[1.5rem] border border-line bg-surface p-6">
          <h2 className="font-display text-lg font-semibold text-brand-deep">Account</h2>
          <p className="mt-2 text-sm">{me?.user.full_name}</p>
          <p className="text-sm text-muted">{me?.user.email}</p>
          <PasswordChangeCard />
        </section>

        <section className="rounded-[1.5rem] border border-line bg-surface p-6 md:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="font-display text-lg font-semibold text-brand-deep">Billing</h2>
              <p className="mt-1 text-sm text-muted">
                14-day trial, then Paystack or Flutterwave (NGN).
              </p>
            </div>
            {subscription && (
              <div className="rounded-2xl bg-brand-deep px-4 py-3 text-white">
                <p className="text-xs uppercase tracking-wider text-white/60">Current</p>
                <p className="font-display text-lg font-bold capitalize">
                  {subscription.plan} · {subscription.status}
                </p>
                {subscription.days_remaining != null && subscription.status === "trialing" && (
                  <p className="text-xs text-accent">{subscription.days_remaining} days left</p>
                )}
              </div>
            )}
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            <ProviderChip
              active={provider === "paystack"}
              onClick={() => setProvider("paystack")}
              label="Paystack"
            />
            <ProviderChip
              active={provider === "flutterwave"}
              onClick={() => setProvider("flutterwave")}
              label="Flutterwave"
            />
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {plans.map((plan) => (
              <div
                key={plan.id}
                className="flex flex-col rounded-2xl border border-line bg-surface-soft/40 p-5"
              >
                <p className="font-display text-lg font-bold text-brand-deep">{plan.name}</p>
                <p className="mt-1 text-2xl font-bold text-brand">
                  ₦{plan.amount_naira.toLocaleString()}
                  <span className="text-sm font-medium text-muted">/mo</span>
                </p>
                <ul className="mt-4 flex-1 space-y-1.5 text-xs text-muted">
                  {plan.features.map((f) => (
                    <li key={f}>• {f}</li>
                  ))}
                </ul>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => checkout(plan.id)}
                  className="mt-5 rounded-full bg-brand-deep py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                >
                  Checkout with {provider}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => mockActivate(plan.id)}
                  className="mt-2 text-xs font-medium text-muted hover:text-brand"
                >
                  Activate mock (dev)
                </button>
              </div>
            ))}
          </div>

          {message && (
            <p className="mt-5 rounded-2xl border border-line bg-surface-soft/50 px-4 py-3 text-sm text-foreground/80">
              {message}
            </p>
          )}
        </section>

        <section className="rounded-[1.5rem] border border-dashed border-line bg-surface/60 p-6">
          <h2 className="font-display text-lg font-semibold text-brand-deep">Integrations</h2>
          <p className="mt-2 text-sm text-muted">
            WhatsApp Business, Instagram, and LinkedIn publishing land after live billing keys.
          </p>
        </section>
      </div>

      <AnimatePresence>
        {editOpen && tenantId && (
          <BusinessProfileDrawer
            tenantId={tenantId}
            profile={profile}
            onClose={() => setEditOpen(false)}
            onSaved={async () => {
              await refresh();
              setEditOpen(false);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function BusinessProfileDrawer({
  tenantId,
  profile,
  onClose,
  onSaved,
}: {
  tenantId: string;
  profile: Profile | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [businessName, setBusinessName] = useState(profile?.business_name || "");
  const [industry, setIndustry] = useState(profile?.industry || "");
  const [brandVoice, setBrandVoice] = useState(profile?.brand_voice || "");
  const [audience, setAudience] = useState(profile?.target_audience || "");
  const [goals, setGoals] = useState(profile?.goals || "");
  const [competitors, setCompetitors] = useState((profile?.competitors || []).join(", "));
  const [socials, setSocials] = useState<Record<string, string>>(
    parseSocialsMap(profile?.socials || null),
  );
  const [logoUrl, setLogoUrl] = useState(profile?.logo_url || null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useStudioModal(true);

  useEffect(() => {
    setMounted(true);
  }, []);

  async function onUpload(file: File | null) {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const updated = await api.uploadBusinessLogo(tenantId, file);
      setLogoUrl(updated.logo_url);
      setToast("Logo uploaded");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Logo upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.upsertBusinessProfile(tenantId, {
        business_name: businessName.trim(),
        industry: industry.trim() || null,
        brand_voice: brandVoice.trim() || null,
        target_audience: audience.trim() || null,
        goals: goals.trim() || null,
        competitors: parseTagList(competitors),
        socials: Object.keys(socials).length ? socials : null,
        logo_url: logoUrl,
        initialize_memory: true,
      });
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  if (!mounted) return null;

  return createPortal(
    <motion.div
      className="fixed inset-0 z-[200] flex justify-end"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-brand-deep/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.aside
        initial={{ x: 480 }}
        animate={{ x: 0 }}
        exit={{ x: 480 }}
        transition={{ type: "spring", stiffness: 320, damping: 32 }}
        className="relative z-10 flex h-[100dvh] w-full max-w-lg flex-col overflow-hidden border-l border-line bg-surface shadow-2xl"
      >
        <div className="shrink-0 border-b border-line bg-gradient-to-br from-brand-deep to-brand px-6 py-5 text-white">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-accent">
                Business profile
              </p>
              <h3 className="font-display mt-1 text-2xl font-bold">Edit brand memory</h3>
              <p className="mt-1 text-sm text-white/70">
                Updates feed AI marketing tone, audience, and visuals.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-white/20 px-3 py-1 text-xs"
            >
              Close
            </button>
          </div>
        </div>

        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-6 py-5 pb-8">
            <div className="flex items-center gap-4 rounded-2xl border border-line bg-surface-soft/40 p-4">
              <LogoAvatar name={businessName || "Brand"} logoUrl={logoUrl} size="lg" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                  Business logo
                </p>
                <p className="mt-1 text-xs text-muted">JPEG, PNG, WebP or GIF · max 2MB</p>
                <label className="mt-2 inline-flex cursor-pointer rounded-full bg-brand-deep px-3 py-1.5 text-xs font-semibold text-white">
                  {uploading ? "Uploading…" : "Upload logo"}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    className="hidden"
                    disabled={uploading || busy}
                    onChange={(e) => onUpload(e.target.files?.[0] || null)}
                  />
                </label>
              </div>
            </div>

            <Field label="Business name" value={businessName} onChange={setBusinessName} required />
            <Field label="Industry" value={industry} onChange={setIndustry} required />
            <Area
              label="Brand voice"
              value={brandVoice}
              onChange={setBrandVoice}
              placeholder="Warm, clear, confident…"
            />
            <AudiencePicker value={audience} onChange={setAudience} compact />
            <Area label="Goals" value={goals} onChange={setGoals} placeholder="What growth looks like…" />
            <CompetitorTags value={competitors} onChange={setCompetitors} compact />
            <SocialAccountsFields value={socials} onChange={setSocials} compact />

            {toast && <p className="text-sm font-medium text-brand">{toast}</p>}
            {error && <p className="text-sm text-danger">{error}</p>}
          </div>

          <div
            className="shrink-0 border-t border-line bg-surface px-6 pt-4 shadow-[0_-8px_24px_rgba(8,53,38,0.06)]"
            style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
          >
            <button
              type="submit"
              disabled={busy || uploading || businessName.trim().length < 2}
              className="w-full rounded-full bg-brand-deep py-3.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save business profile"}
            </button>
          </div>
        </form>
      </motion.aside>
    </motion.div>,
    document.body,
  );
}

function LogoAvatar({
  name,
  logoUrl,
  size = "md",
}: {
  name: string;
  logoUrl?: string | null;
  size?: "md" | "lg";
}) {
  const dim = size === "lg" ? "h-16 w-16" : "h-11 w-11";
  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoUrl}
        alt={`${name} logo`}
        className={`${dim} rounded-2xl border border-line object-cover`}
      />
    );
  }
  return (
    <div
      className={`${dim} flex items-center justify-center rounded-2xl border border-line bg-brand-deep font-display text-sm font-bold text-accent`}
    >
      {name.slice(0, 2).toUpperCase()}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  required,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="block text-xs font-semibold uppercase tracking-wider text-muted">
      {label}
      <input
        value={value}
        required={required}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1.5 w-full rounded-xl border border-line bg-white px-3 py-2.5 text-sm font-normal normal-case tracking-normal text-foreground outline-none focus:border-brand"
      />
    </label>
  );
}

function Area({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block text-xs font-semibold uppercase tracking-wider text-muted">
      {label}
      <textarea
        value={value}
        rows={3}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1.5 w-full rounded-xl border border-line bg-white px-3 py-2.5 text-sm font-normal normal-case tracking-normal text-foreground outline-none focus:border-brand"
      />
    </label>
  );
}

function PasswordChangeCard() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (newPassword !== confirm) {
      setErr("New passwords do not match");
      return;
    }
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await api.changePassword({
        current_password: currentPassword,
        new_password: newPassword,
      });
      setMsg(res.message);
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
      await api.logout().catch(() => undefined);
      window.setTimeout(() => router.push("/login"), 800);
    } catch (error) {
      setErr(error instanceof Error ? error.message : "Could not change password");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-5 space-y-3 border-t border-line pt-5">
      <h3 className="text-sm font-semibold text-brand-deep">Change password</h3>
      <input
        type="password"
        required
        placeholder="Current password"
        value={currentPassword}
        onChange={(e) => setCurrentPassword(e.target.value)}
        className="w-full rounded-xl border border-line bg-surface-soft/50 px-3 py-2.5 text-sm"
      />
      <input
        type="password"
        required
        minLength={10}
        placeholder="New password (min 10)"
        value={newPassword}
        onChange={(e) => setNewPassword(e.target.value)}
        className="w-full rounded-xl border border-line bg-surface-soft/50 px-3 py-2.5 text-sm"
      />
      <input
        type="password"
        required
        minLength={10}
        placeholder="Confirm new password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        className="w-full rounded-xl border border-line bg-surface-soft/50 px-3 py-2.5 text-sm"
      />
      {err && <p className="text-sm text-danger">{err}</p>}
      {msg && <p className="text-sm text-brand">{msg}</p>}
      <button
        type="submit"
        disabled={busy}
        className="rounded-full bg-brand-deep px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
      >
        {busy ? "Updating…" : "Update password"}
      </button>
    </form>
  );
}

function ProviderChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-4 py-1.5 text-xs font-semibold ${
        active ? "bg-brand-deep text-white" : "bg-surface-soft text-muted"
      }`}
    >
      {label}
    </button>
  );
}
