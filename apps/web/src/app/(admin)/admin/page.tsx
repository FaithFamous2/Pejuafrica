"use client";

import Link from "next/link";
import { FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { api } from "@/lib/api";

type Stats = Awaited<ReturnType<typeof api.adminStats>>;
type Tenant = Awaited<ReturnType<typeof api.adminTenants>>[number];
type Usage = Awaited<ReturnType<typeof api.adminUsage>>[number];
type Prompt = Awaited<ReturnType<typeof api.adminListPrompts>>[number];
type Provider = Awaited<ReturnType<typeof api.adminListLlmProviders>>[number];
type Catalog = Awaited<ReturnType<typeof api.adminLlmCatalog>>[number];
type ImageProvider = Awaited<ReturnType<typeof api.adminListImageProviders>>[number];
type ImageCatalog = Awaited<ReturnType<typeof api.adminImageGenCatalog>>[number];
type Generation = Awaited<ReturnType<typeof api.adminGenerations>>[number];
type ProviderUsage = Awaited<ReturnType<typeof api.adminUsageByProvider>>[number];
type Activity = Awaited<ReturnType<typeof api.adminLlmActivity>>[number];
type SuccessMetrics = Awaited<ReturnType<typeof api.adminSuccessMetrics>>;

type ModuleId =
  | "command"
  | "ai"
  | "image"
  | "email"
  | "mediaAttr"
  | "generations"
  | "activity"
  | "media"
  | "tenants"
  | "usage"
  | "prompts"
  | "billing"
  | "flags"
  | "security"
  | "observability";

const ease = [0.22, 1, 0.36, 1] as const;

const NAV_GROUPS: {
  label: string;
  items: { id: ModuleId; code: string; label: string; hint: string; locked?: boolean }[];
}[] = [
  {
    label: "Command",
    items: [
      { id: "command", code: "01", label: "Mission Brief", hint: "Platform pulse" },
      { id: "ai", code: "02", label: "Neural Fabric", hint: "LLM providers" },
      { id: "image", code: "03", label: "Image Fabric", hint: "Text-to-image" },
      { id: "email", code: "04", label: "Email Fabric", hint: "Resend + Brevo" },
      { id: "media", code: "05", label: "Media", hint: "Cloudinary" },
      { id: "mediaAttr", code: "06", label: "Media Cost", hint: "Graphics + $ est." },
      { id: "generations", code: "07", label: "Attribution", hint: "Who wrote what" },
      { id: "activity", code: "08", label: "Activity Lab", hint: "Full platform log" },
    ],
  },
  {
    label: "Fleet",
    items: [
      { id: "tenants", code: "09", label: "Tenants", hint: "Org control" },
      { id: "usage", code: "10", label: "Telemetry", hint: "Token burn" },
      { id: "prompts", code: "11", label: "Prompt Lab", hint: "System prompts" },
    ],
  },
  {
    label: "Expand",
    items: [
      { id: "billing", code: "12", label: "Billing Ops", hint: "Soon", locked: true },
      { id: "flags", code: "13", label: "Feature Flags", hint: "Soon", locked: true },
      { id: "security", code: "14", label: "Security", hint: "Soon", locked: true },
      { id: "observability", code: "15", label: "Observability", hint: "Soon", locked: true },
    ],
  },
];

const MODULE_META: Record<
  ModuleId,
  { title: string; subtitle: string }
> = {
  command: {
    title: "Mission Brief",
    subtitle:
      "Wedge KPIs — time-to-first-campaign, approval rate, retention, WAU — plus fabric health.",
  },
  ai: {
    title: "Neural Fabric",
    subtitle: "Wire OpenAI, Groq, Gemini — priority failover keeps generation online.",
  },
  image: {
    title: "Image Fabric",
    subtitle:
      "Cloudflare Workers AI + Google AI Studio — text-to-image for marketing graphics.",
  },
  email: {
    title: "Email Fabric",
    subtitle: "Resend and Brevo for invites, resets, and transactional mail — priority failover.",
  },
  mediaAttr: {
    title: "Media Cost Lab",
    subtitle: "Every AI graphic with provider, model, and estimated USD cost.",
  },
  media: {
    title: "Media Fabric",
    subtitle: "Cloudinary cloud name, API key, and secret for logos and future assets.",
  },
  generations: {
    title: "Attribution Stream",
    subtitle: "Every campaign tagged with the model that authored it.",
  },
  activity: {
    title: "Activity Lab",
    subtitle: "Audit, LLM, image generations, and tenant events in one feed.",
  },
  tenants: {
    title: "Tenant Fleet",
    subtitle: "Suspend, reactivate, or step into any workspace.",
  },
  usage: {
    title: "Telemetry",
    subtitle: "Token burn by tenant and by neural provider.",
  },
  prompts: {
    title: "Prompt Lab",
    subtitle: "Platform prompt templates currently in rotation.",
  },
  billing: {
    title: "Billing Ops",
    subtitle: "Payment rails and subscription surgery — coming online next.",
  },
  flags: {
    title: "Feature Flags",
    subtitle: "Progressive rollout controls for wedge features.",
  },
  security: {
    title: "Security",
    subtitle: "Audit trails, session kill-switches, and access policy.",
  },
  observability: {
    title: "Observability",
    subtitle: "Latency, error budgets, and provider SLA dashboards.",
  },
};

export default function AdminPage() {
  const router = useRouter();
  const [module, setModule] = useState<ModuleId>("command");
  const [stats, setStats] = useState<Stats | null>(null);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [usage, setUsage] = useState<Usage[]>([]);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [catalog, setCatalog] = useState<Catalog[]>([]);
  const [imageProviders, setImageProviders] = useState<ImageProvider[]>([]);
  const [imageCatalog, setImageCatalog] = useState<ImageCatalog[]>([]);
  const [emailProviders, setEmailProviders] = useState<
    Awaited<ReturnType<typeof api.adminListEmailProviders>>
  >([]);
  const [mediaUsage, setMediaUsage] = useState<
    Awaited<ReturnType<typeof api.adminMediaUsage>>
  >([]);
  const [mediaSummary, setMediaSummary] = useState<
    Awaited<ReturnType<typeof api.adminMediaUsageSummary>> | null
  >(null);
  const [platformActivity, setPlatformActivity] = useState<
    Awaited<ReturnType<typeof api.adminPlatformActivity>>
  >([]);
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [providerUsage, setProviderUsage] = useState<ProviderUsage[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [successMetrics, setSuccessMetrics] = useState<SuccessMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [clock, setClock] = useState("");
  const [navOpen, setNavOpen] = useState(false);

  async function load() {
    const me = await api.me();
    if (!me.user.is_platform_admin) {
      router.replace("/app");
      return;
    }
    const [s, t, u, p, prov, cat, imgProv, imgCat, emailProv, mediaU, mediaS, platAct, gens, pu, act, sm] =
      await Promise.all([
        api.adminStats(),
        api.adminTenants(),
        api.adminUsage(),
        api.adminListPrompts(),
        api.adminListLlmProviders(),
        api.adminLlmCatalog(),
        api.adminListImageProviders(),
        api.adminImageGenCatalog(),
        api.adminListEmailProviders(),
        api.adminMediaUsage(),
        api.adminMediaUsageSummary(),
        api.adminPlatformActivity(),
        api.adminGenerations(),
        api.adminUsageByProvider(),
        api.adminLlmActivity(),
        api.adminSuccessMetrics(),
      ]);
    setStats(s);
    setTenants(t);
    setUsage(u);
    setPrompts(p);
    setProviders(prov);
    setCatalog(cat);
    setImageProviders(imgProv);
    setImageCatalog(imgCat);
    setEmailProviders(emailProv);
    setMediaUsage(mediaU);
    setMediaSummary(mediaS);
    setPlatformActivity(platAct);
    setGenerations(gens);
    setProviderUsage(pu);
    setActivity(act);
    setSuccessMetrics(sm);
  }

  useEffect(() => {
    load().catch(() => {
      setError("Super admin access required");
      router.replace("/login");
    });
  }, [router]);

  useEffect(() => {
    const tick = () =>
      setClock(
        new Date().toLocaleString("en-GB", {
          hour12: false,
          timeZoneName: "short",
        }),
      );
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  const activeProviders = useMemo(
    () => providers.filter((p) => p.is_active).length,
    [providers],
  );
  const activeImageProviders = useMemo(
    () => imageProviders.filter((p) => p.is_active).length,
    [imageProviders],
  );

  const meta = MODULE_META[module];

  if (!stats) {
    return (
      <div className="cp-shell cp-grid-bg flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 rounded-full border border-[var(--cp-phosphor)]/30 border-t-[var(--cp-phosphor)] cp-radar-ring" />
          <p className="cp-mono text-xs uppercase tracking-[0.28em] text-[var(--cp-phosphor)]">
            {error ?? "Booting control plane"}
          </p>
        </div>
      </div>
    );
  }

  function go(id: ModuleId, locked?: boolean) {
    if (locked) return;
    setModule(id);
    setNavOpen(false);
    setMessage(null);
  }

  return (
    <div className="cp-shell cp-grid-bg cp-scanline relative min-h-screen overflow-x-hidden">
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="cp-orb absolute -left-32 top-10 h-[28rem] w-[28rem] rounded-full bg-[var(--brand)]/25" />
        <div className="cp-orb absolute -right-20 bottom-0 h-[24rem] w-[24rem] rounded-full bg-[var(--cp-phosphor)]/15 [animation-delay:2s]" />
        <div className="absolute left-1/2 top-1/3 h-64 w-64 -translate-x-1/2 rounded-full border border-[var(--cp-phosphor)]/10 cp-radar-ring opacity-40" />
      </div>

      {/* Top HUD */}
      <header className="sticky top-0 z-40 border-b border-[var(--cp-edge)] bg-[rgba(2,8,6,0.82)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="cp-btn cp-btn-ghost lg:hidden"
              onClick={() => setNavOpen((v) => !v)}
            >
              Menu
            </button>
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/icon.jpeg"
                alt=""
                width={36}
                height={36}
                className="h-9 w-9 rounded-xl object-cover ring-1 ring-white/10"
              />
              <div>
                <p className="font-display text-lg font-bold tracking-tight sm:text-xl">
                  Peju<span className="text-[var(--cp-phosphor)]">Africa</span>
                </p>
                <p className="cp-mono text-[10px] uppercase tracking-[0.22em] text-[var(--cp-dim)]">
                  Control Plane · v0.5
                </p>
              </div>
            </div>
          </div>

          <div className="hidden items-center gap-6 md:flex">
            <HudChip
              led="var(--cp-phosphor)"
              label="Fabric"
              value={`${activeProviders} active`}
            />
            <HudChip
              led={stats.tenants > 0 ? "var(--cp-mint)" : "var(--cp-dim)"}
              label="Fleet"
              value={`${stats.tenants} tenants`}
            />
            <HudChip
              led="var(--cp-phosphor)"
              label="Burn"
              value={`${stats.total_tokens.toLocaleString()} tok`}
            />
          </div>

          <div className="flex items-center gap-3">
            <p className="cp-mono hidden text-[11px] text-[var(--cp-dim)] sm:block">{clock}</p>
            <Link href="/app" className="cp-btn cp-btn-ghost">
              Exit → App
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1600px]">
        {/* Side rail */}
        <aside
          className={`fixed inset-y-0 left-0 z-50 w-[280px] border-r border-[var(--cp-edge)] bg-[rgba(2,8,6,0.96)] px-3 py-5 backdrop-blur-xl transition-transform lg:sticky lg:top-[57px] lg:z-0 lg:h-[calc(100vh-57px)] lg:translate-x-0 lg:bg-transparent lg:backdrop-blur-none ${
            navOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="mb-4 flex items-center justify-between px-2 lg:hidden">
            <p className="cp-mono text-[10px] uppercase tracking-[0.2em] text-[var(--cp-dim)]">
              Modules
            </p>
            <button type="button" className="cp-btn cp-btn-ghost" onClick={() => setNavOpen(false)}>
              Close
            </button>
          </div>

          <nav className="space-y-6 overflow-y-auto pb-8 lg:h-full">
            {NAV_GROUPS.map((group) => (
              <div key={group.label}>
                <p className="cp-mono mb-2 px-3 text-[10px] uppercase tracking-[0.28em] text-[var(--cp-dim)]">
                  {group.label}
                </p>
                <div className="space-y-1">
                  {group.items.map((item) => {
                    const active = module === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        disabled={item.locked}
                        onClick={() => go(item.id, item.locked)}
                        className={`group relative flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                          active
                            ? "bg-[var(--cp-phosphor)] text-[var(--accent-ink)]"
                            : item.locked
                              ? "cursor-not-allowed opacity-40"
                              : "text-[#d7ebe0] hover:bg-white/[0.04]"
                        }`}
                      >
                        {active && (
                          <motion.span
                            layoutId="nav-glow"
                            className="absolute inset-0 rounded-xl bg-[var(--cp-phosphor)]"
                            transition={{ type: "spring", stiffness: 380, damping: 32 }}
                          />
                        )}
                        <span
                          className={`cp-mono relative z-10 mt-0.5 text-[10px] ${
                            active ? "text-[var(--accent-ink)]/70" : "text-[var(--cp-phosphor)]/70"
                          }`}
                        >
                          {item.code}
                        </span>
                        <span className="relative z-10 min-w-0">
                          <span className="block text-sm font-semibold leading-tight">
                            {item.label}
                          </span>
                          <span
                            className={`mt-0.5 block text-[11px] ${
                              active ? "text-[var(--accent-ink)]/65" : "text-[var(--cp-dim)]"
                            }`}
                          >
                            {item.hint}
                            {item.locked ? " · locked" : ""}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
        </aside>

        {navOpen && (
          <button
            type="button"
            aria-label="Close menu"
            className="fixed inset-0 z-40 bg-black/60 lg:hidden"
            onClick={() => setNavOpen(false)}
          />
        )}

        {/* Main stage */}
        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="cp-mono text-[10px] uppercase tracking-[0.3em] text-[var(--cp-phosphor)]">
                Module {NAV_GROUPS.flatMap((g) => g.items).find((i) => i.id === module)?.code}
              </p>
              <h1 className="font-display mt-2 text-3xl font-bold tracking-tight md:text-5xl">
                {meta.title}
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-[var(--cp-dim)] md:text-base">
                {meta.subtitle}
              </p>
            </div>
            <button
              type="button"
              onClick={() => load().catch(() => setMessage("Refresh failed"))}
              className="cp-btn cp-btn-ghost"
            >
              Sync data
            </button>
          </div>

          <AnimatePresence>
            {message && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="cp-panel mb-5 rounded-2xl px-4 py-3 text-sm text-[var(--cp-phosphor)]"
              >
                {message}
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence mode="wait">
            <motion.div
              key={module}
              initial={{ opacity: 0, y: 14, filter: "blur(4px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: -10, filter: "blur(4px)" }}
              transition={{ duration: 0.4, ease }}
            >
              {module === "command" && (
                <CommandBrief
                  stats={stats}
                  successMetrics={successMetrics}
                  activeProviders={activeProviders}
                  activeImageProviders={activeImageProviders}
                  generations={generations}
                  providers={providers}
                  onJump={go}
                />
              )}

              {module === "ai" && (
                <AiProvidersPanel
                  providers={providers}
                  catalog={catalog}
                  providerUsage={providerUsage}
                  busyId={busyId}
                  setBusyId={setBusyId}
                  setMessage={setMessage}
                  onChanged={async () => {
                    setProviders(await api.adminListLlmProviders());
                    setProviderUsage(await api.adminUsageByProvider());
                  }}
                />
              )}

              {module === "image" && (
                <ImageProvidersPanel
                  providers={imageProviders}
                  catalog={imageCatalog}
                  busyId={busyId}
                  setBusyId={setBusyId}
                  setMessage={setMessage}
                  onChanged={async () => {
                    setImageProviders(await api.adminListImageProviders());
                  }}
                />
              )}

              {module === "email" && (
                <EmailProvidersPanel
                  providers={emailProviders}
                  busyId={busyId}
                  setBusyId={setBusyId}
                  setMessage={setMessage}
                  onChanged={async () => {
                    setEmailProviders(await api.adminListEmailProviders());
                  }}
                />
              )}

              {module === "mediaAttr" && (
                <MediaCostPanel usage={mediaUsage} summary={mediaSummary} />
              )}

              {module === "media" && (
                <CloudinaryPanel setMessage={setMessage} />
              )}

              {module === "generations" && (
                <GenerationsPanel
                  generations={generations}
                  onInspectTenant={(tenantId) => {
                    setModule("tenants");
                    window.setTimeout(() => {
                      window.dispatchEvent(
                        new CustomEvent("peju-inspect-tenant", { detail: { tenantId } }),
                      );
                    }, 50);
                  }}
                />
              )}

              {module === "activity" && (
                <PlatformActivityPanel
                  items={platformActivity}
                  tenants={tenants}
                  onReload={async (tenantId?: string) => {
                    setPlatformActivity(await api.adminPlatformActivity(tenantId));
                  }}
                />
              )}

              {module === "tenants" && (
                <TenantsPanel
                  tenants={tenants}
                  busyId={busyId}
                  setBusyId={setBusyId}
                  setMessage={setMessage}
                  onRefresh={async () => {
                    setTenants(await api.adminTenants());
                    setStats(await api.adminStats());
                  }}
                  router={router}
                />
              )}

              {module === "usage" && (
                <div className="grid gap-5 lg:grid-cols-2">
                  <DataPanel title="Burn by tenant" code="TEN">
                    <OpsTable
                      headers={["Tenant", "Events", "Tokens"]}
                      rows={usage.map((u) => [
                        u.tenant_name,
                        String(u.events),
                        u.total_tokens.toLocaleString(),
                      ])}
                    />
                  </DataPanel>
                  <DataPanel title="Burn by provider" code="LLM">
                    <OpsTable
                      headers={["Provider", "Model", "Events", "Tokens"]}
                      rows={providerUsage.map((u) => [
                        u.provider,
                        u.model,
                        String(u.events),
                        u.total_tokens.toLocaleString(),
                      ])}
                    />
                  </DataPanel>
                </div>
              )}

              {module === "prompts" && <PromptsPanel prompts={prompts} />}

              {(module === "billing" ||
                module === "flags" ||
                module === "security" ||
                module === "observability") && <ComingOnline id={module} />}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}

function CommandBrief({
  stats,
  successMetrics,
  activeProviders,
  activeImageProviders,
  generations,
  providers,
  onJump,
}: {
  stats: Stats;
  successMetrics: SuccessMetrics | null;
  activeProviders: number;
  activeImageProviders: number;
  generations: Generation[];
  providers: Provider[];
  onJump: (id: ModuleId) => void;
}) {
  const metrics = [
    { label: "Tenants", value: stats.tenants, unit: "orgs" },
    { label: "Neural nodes", value: activeProviders, unit: "active" },
    { label: "Image nodes", value: activeImageProviders, unit: "active" },
    { label: "Token burn", value: stats.total_tokens, unit: "tok" },
    { label: "Campaigns", value: stats.campaigns, unit: "plans" },
    { label: "Users", value: stats.users, unit: "humans" },
    { label: "Trials", value: stats.trial_tenants, unit: "open" },
    { label: "Subs", value: stats.active_subscriptions, unit: "live" },
  ];

  const successCards = successMetrics
    ? [
        {
          label: "Time to first campaign",
          value:
            successMetrics.avg_time_to_first_campaign_minutes == null
              ? "—"
              : `${successMetrics.avg_time_to_first_campaign_minutes}m`,
          hint: successMetrics.time_to_first_campaign_under_10_min
            ? "On target (<10m)"
            : "Target <10 minutes",
          ok: successMetrics.time_to_first_campaign_under_10_min,
        },
        {
          label: "Monthly plan approval",
          value: `${successMetrics.approval_rate_pct}%`,
          hint: `Draft ${successMetrics.draft_posts} · Approved ${successMetrics.approved_posts}`,
          ok: successMetrics.approval_rate_pct >= 60,
        },
        {
          label: "Customer retention",
          value:
            successMetrics.customer_retention_pct == null
              ? "—"
              : `${successMetrics.customer_retention_pct}%`,
          hint: "Active last 7d among tenants 14d+",
          ok:
            successMetrics.customer_retention_pct != null &&
            successMetrics.customer_retention_pct >= 40,
        },
        {
          label: "Weekly active users",
          value: String(successMetrics.weekly_active_users),
          hint: "Workspaces with content activity",
          ok: successMetrics.weekly_active_users > 0,
        },
      ]
    : [];

  return (
    <div className="space-y-5">
      {successCards.length > 0 && (
        <DataPanel title="Wedge success metrics" code="KPI">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {successCards.map((m, i) => (
              <motion.div
                key={m.label}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05, duration: 0.35, ease }}
                className="rounded-xl border border-white/5 bg-black/25 px-3 py-3.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="cp-mono text-[10px] uppercase tracking-[0.18em] text-[var(--cp-dim)]">
                    {m.label}
                  </p>
                  <span
                    className={`cp-led ${
                      m.ok
                        ? "bg-[var(--cp-phosphor)] text-[var(--cp-phosphor)]"
                        : "bg-amber-400/80 text-amber-400/80"
                    }`}
                  />
                </div>
                <p className="font-display mt-2 text-2xl font-bold tracking-tight">{m.value}</p>
                <p className="mt-1 text-[11px] text-[var(--cp-dim)]">{m.hint}</p>
              </motion.div>
            ))}
          </div>
        </DataPanel>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((m, i) => (
          <motion.div
            key={m.label}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04, duration: 0.35, ease }}
            className="cp-panel rounded-2xl p-4 sm:p-5"
          >
            <div className="flex items-center justify-between">
              <p className="cp-mono text-[10px] uppercase tracking-[0.2em] text-[var(--cp-dim)]">
                {m.label}
              </p>
              <span className="cp-led bg-[var(--cp-phosphor)] text-[var(--cp-phosphor)]" />
            </div>
            <p className="font-display mt-3 text-3xl font-bold tracking-tight md:text-4xl">
              {m.value.toLocaleString()}
            </p>
            <p className="mt-1 text-xs text-[var(--cp-dim)]">{m.unit}</p>
          </motion.div>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <DataPanel title="Recent attribution" code="GEN">
          <div className="space-y-2">
            {generations.slice(0, 6).map((g) => (
              <div
                key={g.campaign_id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/5 bg-black/25 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{g.title}</p>
                  <p className="text-xs text-[var(--cp-dim)]">{g.tenant_name}</p>
                </div>
                <ProviderBadge provider={g.generation_provider} model={g.generation_model} />
              </div>
            ))}
            {generations.length === 0 && (
              <p className="py-8 text-center text-sm text-[var(--cp-dim)]">
                No generations yet — fabric is standing by.
              </p>
            )}
            <button type="button" onClick={() => onJump("generations")} className="cp-btn cp-btn-ghost mt-2">
              Open full stream →
            </button>
          </div>
        </DataPanel>

        <div className="space-y-5">
          <DataPanel title="Fabric status" code="AI">
            <div className="space-y-2">
              {providers.length === 0 && (
                <p className="text-sm text-[var(--cp-dim)]">
                  No providers wired. Jump to Neural Fabric to add OpenAI / Groq / Gemini.
                </p>
              )}
              {providers.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between gap-2 rounded-xl border border-white/5 bg-black/25 px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{p.name}</p>
                    <p className="cp-mono text-[10px] text-[var(--cp-dim)]">
                      P{p.priority} · {p.model}
                    </p>
                  </div>
                  <span
                    className={`cp-led ${
                      p.is_active
                        ? "bg-[var(--cp-phosphor)] text-[var(--cp-phosphor)]"
                        : "bg-white/30 text-white/30"
                    }`}
                  />
                </div>
              ))}
              <button type="button" onClick={() => onJump("ai")} className="cp-btn cp-btn-primary mt-2 w-full">
                Configure fabric
              </button>
            </div>
          </DataPanel>

          <DataPanel title="Expansion slots" code="XP">
            <div className="grid grid-cols-2 gap-2">
              {["Billing Ops", "Feature Flags", "Security", "Observability"].map((label) => (
                <div
                  key={label}
                  className="rounded-xl border border-dashed border-[var(--cp-edge)] px-3 py-4 text-center"
                >
                  <p className="text-xs font-semibold text-[var(--cp-dim)]">{label}</p>
                  <p className="cp-mono mt-1 text-[9px] uppercase tracking-widest text-[var(--cp-phosphor)]/60">
                    Slot ready
                  </p>
                </div>
              ))}
            </div>
          </DataPanel>
        </div>
      </div>
    </div>
  );
}

function AiProvidersPanel({
  providers,
  catalog,
  providerUsage,
  busyId,
  setBusyId,
  setMessage,
  onChanged,
}: {
  providers: Provider[];
  catalog: Catalog[];
  providerUsage: ProviderUsage[];
  busyId: string | null;
  setBusyId: (v: string | null) => void;
  setMessage: (v: string | null) => void;
  onChanged: () => Promise<void>;
}) {
  const [kind, setKind] = useState("openai");
  const selected = catalog.find((c) => c.kind === kind) || catalog[0];
  const [name, setName] = useState("OpenAI Production");
  const [model, setModel] = useState("gpt-4o-mini");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [priority, setPriority] = useState(100);

  useEffect(() => {
    if (!selected) return;
    setModel(selected.default_model);
    setBaseUrl(selected.default_base_url);
    setName(`${selected.label} Production`);
  }, [selected]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setBusyId("create");
    setMessage(null);
    try {
      await api.adminCreateLlmProvider({
        kind,
        name,
        model,
        base_url: baseUrl || undefined,
        api_key: apiKey,
        is_active: true,
        priority,
      });
      setApiKey("");
      setMessage(`${name} online and active in failover chain.`);
      await onChanged();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to add provider");
    } finally {
      setBusyId(null);
    }
  }

  const sorted = [...providers].sort((a, b) => a.priority - b.priority);

  return (
    <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
      <div className="space-y-4">
        <div className="cp-panel rounded-2xl p-4 sm:p-5">
          <p className="cp-mono text-[10px] uppercase tracking-[0.22em] text-[var(--cp-phosphor)]">
            Failover chain
          </p>
          <p className="mt-2 text-sm text-[var(--cp-dim)]">
            Active nodes are tried lowest priority first. If one fails, the next takes the request.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {sorted.filter((p) => p.is_active).length === 0 && (
              <span className="text-xs text-[var(--cp-dim)]">No active nodes — template fallback</span>
            )}
            {sorted
              .filter((p) => p.is_active)
              .map((p, i) => (
                <div key={p.id} className="flex items-center gap-2">
                  {i > 0 && <span className="text-[var(--cp-phosphor)]/40">→</span>}
                  <span className="rounded-lg border border-[var(--cp-edge-strong)] bg-black/40 px-2.5 py-1 text-xs font-semibold capitalize">
                    {p.kind}
                    <span className="ml-1 text-[var(--cp-dim)]">P{p.priority}</span>
                  </span>
                </div>
              ))}
          </div>
        </div>

        {sorted.map((p, idx) => (
          <motion.article
            key={p.id}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: idx * 0.05 }}
            className="cp-panel overflow-hidden rounded-2xl"
          >
            <div className="flex flex-wrap items-stretch">
              <div className="flex w-16 shrink-0 flex-col items-center justify-center border-r border-[var(--cp-edge)] bg-black/30 py-4">
                <p className="cp-mono text-[10px] text-[var(--cp-dim)]">PRI</p>
                <p className="font-display text-2xl font-bold text-[var(--cp-phosphor)]">
                  {p.priority}
                </p>
              </div>
              <div className="min-w-0 flex-1 p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-display text-lg font-semibold">{p.name}</h3>
                      <span className="cp-mono rounded border border-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-[var(--cp-dim)]">
                        {p.kind}
                      </span>
                      <StatusPill active={p.is_active} />
                    </div>
                    <p className="mt-1.5 text-sm text-[var(--cp-dim)]">
                      <span className="text-[#e8f5ec]">{p.model}</span>
                      <span className="mx-2 opacity-40">·</span>
                      key {p.api_key_masked}
                    </p>
                    {p.last_ok_at && (
                      <p className="cp-mono mt-2 text-[10px] text-[var(--cp-mint)]">
                        LAST OK {new Date(p.last_ok_at).toLocaleString()}
                      </p>
                    )}
                    {p.last_error && (
                      <p className="mt-2 line-clamp-2 text-xs text-[var(--cp-danger)]">
                        {p.last_error}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busyId === p.id}
                      className="cp-btn cp-btn-ghost"
                      onClick={async () => {
                        setBusyId(p.id);
                        try {
                          await api.adminTestLlmProvider(p.id);
                          setMessage(`${p.name} responded OK`);
                          await onChanged();
                        } catch (err) {
                          setMessage(err instanceof Error ? err.message : "Test failed");
                          await onChanged();
                        } finally {
                          setBusyId(null);
                        }
                      }}
                    >
                      Probe
                    </button>
                    <button
                      type="button"
                      disabled={busyId === p.id}
                      className="cp-btn cp-btn-ghost"
                      onClick={async () => {
                        setBusyId(p.id);
                        try {
                          await api.adminUpdateLlmProvider(p.id, { is_active: !p.is_active });
                          await onChanged();
                        } finally {
                          setBusyId(null);
                        }
                      }}
                    >
                      {p.is_active ? "Offline" : "Online"}
                    </button>
                    <button
                      type="button"
                      disabled={busyId === p.id}
                      className="cp-btn cp-btn-danger"
                      onClick={async () => {
                        if (!confirm(`Remove ${p.name} from fabric?`)) return;
                        setBusyId(p.id);
                        try {
                          await api.adminDeleteLlmProvider(p.id);
                          await onChanged();
                        } finally {
                          setBusyId(null);
                        }
                      }}
                    >
                      Purge
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </motion.article>
        ))}

        {providers.length === 0 && (
          <div className="cp-panel rounded-2xl border-dashed px-5 py-12 text-center">
            <p className="font-display text-xl font-semibold">Fabric empty</p>
            <p className="mt-2 text-sm text-[var(--cp-dim)]">
              Commission OpenAI, Groq, or Gemini on the right.
            </p>
          </div>
        )}
      </div>

      <div className="space-y-4">
        <form onSubmit={onCreate} className="cp-panel rounded-2xl p-5 sm:p-6">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-xl font-semibold">Commission node</h2>
            <span className="cp-led bg-[var(--cp-phosphor)] text-[var(--cp-phosphor)]" />
          </div>
          <div className="mt-5 space-y-3">
            <label className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--cp-dim)]">
              Provider class
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value)}
                className="cp-input"
              >
                {catalog.map((c) => (
                  <option key={c.kind} value={c.kind}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <Field label="Callsign" value={name} onChange={setName} required />
            <Field label="Model" value={model} onChange={setModel} required />
            <Field label="Endpoint" value={baseUrl} onChange={setBaseUrl} />
            <Field
              label="API credential"
              value={apiKey}
              onChange={setApiKey}
              type="password"
              required
              placeholder="sk-… / gsk_… / AIza…"
            />
            <Field
              label="Priority (1 = primary)"
              value={String(priority)}
              onChange={(v) => setPriority(Number(v) || 100)}
            />
            <button
              type="submit"
              disabled={busyId === "create"}
              className="cp-btn cp-btn-primary w-full py-3 text-xs"
            >
              {busyId === "create" ? "Wiring…" : "Bring online"}
            </button>
          </div>
        </form>

        <DataPanel title="Spend by model" code="TOK">
          <OpsTable
            headers={["Provider", "Model", "Tokens"]}
            rows={providerUsage.map((u) => [
              u.provider,
              u.model,
              u.total_tokens.toLocaleString(),
            ])}
          />
        </DataPanel>
      </div>
    </div>
  );
}

function ImageProvidersPanel({
  providers,
  catalog,
  busyId,
  setBusyId,
  setMessage,
  onChanged,
}: {
  providers: ImageProvider[];
  catalog: ImageCatalog[];
  busyId: string | null;
  setBusyId: (v: string | null) => void;
  setMessage: (v: string | null) => void;
  onChanged: () => Promise<void>;
}) {
  const [kind, setKind] = useState("cloudflare");
  const selected = catalog.find((c) => c.kind === kind) || catalog[0];
  const [name, setName] = useState("Cloudflare Workers AI");
  const [model, setModel] = useState("@cf/black-forest-labs/flux-1-schnell");
  const [accountId, setAccountId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [priority, setPriority] = useState(100);

  useEffect(() => {
    if (!selected) return;
    const first = selected.models?.[0];
    setModel(first?.id || "");
    setName(`${selected.label}`);
    if (!selected.needs_account_id) setAccountId("");
  }, [selected]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setBusyId("img-create");
    setMessage(null);
    try {
      await api.adminCreateImageProvider({
        kind,
        name,
        model,
        account_id: accountId || undefined,
        api_key: apiKey,
        is_active: true,
        priority,
      });
      setApiKey("");
      setMessage(`${name} online — tenant graphics will use text-to-image.`);
      await onChanged();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to add image provider");
    } finally {
      setBusyId(null);
    }
  }

  const sorted = [...providers].sort((a, b) => a.priority - b.priority);
  const models = selected?.models || [];

  return (
    <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
      <div className="space-y-4">
        <div className="cp-panel rounded-2xl p-4 sm:p-5">
          <p className="cp-mono text-[10px] uppercase tracking-[0.22em] text-[var(--cp-phosphor)]">
            Image agent
          </p>
          <p className="mt-2 text-sm text-[var(--cp-dim)]">
            Tries your configured model first, then cheap Cloudflare ladders (Schnell → Klein 4B →
            Lightning…). Graphic intents prefer Leonardo Phoenix/Lucid + DreamShaper. Partner models
            (GPT Image, Nano Banana, Seedream, Wan) appear in the catalog — only run when you add them
            as a provider so free neurons stay protected. Caps at 4 attempts per graphic.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {sorted.filter((p) => p.is_active).length === 0 && (
              <span className="text-xs text-[var(--cp-dim)]">
                No image AI — SVG template fallback
              </span>
            )}
            {sorted
              .filter((p) => p.is_active)
              .map((p, i) => (
                <div key={p.id} className="flex items-center gap-2">
                  {i > 0 && <span className="text-[var(--cp-phosphor)]/40">→</span>}
                  <span className="rounded-lg border border-[var(--cp-edge-strong)] bg-black/40 px-2.5 py-1 text-xs font-semibold">
                    {p.kind === "google_studio" ? "Google Studio" : "Cloudflare"}
                    <span className="ml-1 text-[var(--cp-dim)]">P{p.priority}</span>
                  </span>
                </div>
              ))}
          </div>
        </div>

        {sorted.map((p, idx) => (
          <motion.article
            key={p.id}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: idx * 0.05 }}
            className="cp-panel overflow-hidden rounded-2xl"
          >
            <div className="flex flex-wrap items-stretch">
              <div className="flex w-16 shrink-0 flex-col items-center justify-center border-r border-[var(--cp-edge)] bg-black/30 py-4">
                <p className="cp-mono text-[10px] text-[var(--cp-dim)]">PRI</p>
                <p className="font-display text-2xl font-bold text-[var(--cp-phosphor)]">
                  {p.priority}
                </p>
              </div>
              <div className="min-w-0 flex-1 p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-display text-lg font-semibold">{p.name}</h3>
                      <span className="cp-mono rounded border border-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-[var(--cp-dim)]">
                        {p.kind}
                      </span>
                      <StatusPill active={p.is_active} />
                    </div>
                    <p className="mt-1.5 break-all text-sm text-[var(--cp-dim)]">
                      <span className="text-[#e8f5ec]">{p.model}</span>
                      <span className="mx-2 opacity-40">·</span>
                      key {p.api_key_masked}
                    </p>
                    {p.account_id && (
                      <p className="cp-mono mt-1 text-[10px] text-[var(--cp-dim)]">
                        ACCOUNT {p.account_id}
                      </p>
                    )}
                    {p.last_ok_at && (
                      <p className="cp-mono mt-2 text-[10px] text-[var(--cp-mint)]">
                        LAST OK {new Date(p.last_ok_at).toLocaleString()}
                      </p>
                    )}
                    {p.last_error && (
                      <p className="mt-2 line-clamp-2 text-xs text-[var(--cp-danger)]">
                        {p.last_error}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busyId === p.id}
                      className="cp-btn cp-btn-ghost"
                      onClick={async () => {
                        setBusyId(p.id);
                        try {
                          const res = await api.adminTestImageProvider(p.id);
                          setMessage(
                            `${p.name} OK — generated ${res.bytes} bytes (${res.mime})`,
                          );
                          await onChanged();
                        } catch (err) {
                          setMessage(err instanceof Error ? err.message : "Test failed");
                          await onChanged();
                        } finally {
                          setBusyId(null);
                        }
                      }}
                    >
                      Probe
                    </button>
                    <button
                      type="button"
                      disabled={busyId === p.id}
                      className="cp-btn cp-btn-ghost"
                      onClick={async () => {
                        setBusyId(p.id);
                        try {
                          await api.adminUpdateImageProvider(p.id, {
                            is_active: !p.is_active,
                          });
                          await onChanged();
                        } finally {
                          setBusyId(null);
                        }
                      }}
                    >
                      {p.is_active ? "Offline" : "Online"}
                    </button>
                    <button
                      type="button"
                      disabled={busyId === p.id}
                      className="cp-btn cp-btn-danger"
                      onClick={async () => {
                        if (!confirm(`Remove ${p.name} from image fabric?`)) return;
                        setBusyId(p.id);
                        try {
                          await api.adminDeleteImageProvider(p.id);
                          await onChanged();
                        } finally {
                          setBusyId(null);
                        }
                      }}
                    >
                      Purge
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </motion.article>
        ))}

        {providers.length === 0 && (
          <div className="cp-panel rounded-2xl border-dashed px-5 py-12 text-center">
            <p className="font-display text-xl font-semibold">No image nodes</p>
            <p className="mt-2 text-sm text-[var(--cp-dim)]">
              Add Cloudflare Workers AI or Google AI Studio on the right.
            </p>
          </div>
        )}
      </div>

      <div className="space-y-4">
        <form onSubmit={onCreate} className="cp-panel rounded-2xl p-5 sm:p-6">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-xl font-semibold">Commission image node</h2>
            <span className="cp-led bg-[var(--cp-phosphor)] text-[var(--cp-phosphor)]" />
          </div>
          <p className="mt-2 text-xs text-[var(--cp-dim)]">
            Credentials stay encrypted. Tenants never see keys — only generated graphics.
          </p>
          <div className="mt-5 space-y-3">
            <label className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--cp-dim)]">
              Provider
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value)}
                className="cp-input"
              >
                {catalog.map((c) => (
                  <option key={c.kind} value={c.kind}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <Field label="Callsign" value={name} onChange={setName} required />
            <label className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--cp-dim)]">
              Text-to-image model
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="cp-input"
              >
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            {models.find((m) => m.id === model)?.hint && (
              <p className="text-[11px] text-[var(--cp-dim)]">
                {models.find((m) => m.id === model)?.hint}
              </p>
            )}
            {selected?.needs_account_id && (
              <Field
                label="Cloudflare Account ID"
                value={accountId}
                onChange={setAccountId}
                required
                placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              />
            )}
            <Field
              label={kind === "cloudflare" ? "Workers AI API token" : "Google AI Studio API key"}
              value={apiKey}
              onChange={setApiKey}
              type="password"
              required
              placeholder={kind === "cloudflare" ? "cf…" : "AIza…"}
            />
            <Field
              label="Priority (1 = primary)"
              value={String(priority)}
              onChange={(v) => setPriority(Number(v) || 100)}
            />
            <button
              type="submit"
              disabled={busyId === "img-create"}
              className="cp-btn cp-btn-primary w-full py-3 text-xs"
            >
              {busyId === "img-create" ? "Wiring…" : "Bring online"}
            </button>
          </div>
        </form>

        <DataPanel title="How the image agent works" code="AGENT">
          <ul className="space-y-2 text-sm text-[var(--cp-dim)]">
            <li>
              Add one Cloudflare node (full 32-char Account ID + token) — the agent can try multiple
              CF models with those same credentials.
            </li>
            <li>
              <span className="text-[#e8f5ec]">@cf/…</span> models use Workers AI path. Partner models
              (Nano Banana, GPT Image, Seedream…) use Cloudflare{" "}
              <span className="text-[#e8f5ec]">/ai/run</span> + Unified Billing — same account, token
              needs AI Gateway permission.
            </li>
            <li>
              Order by cost: Schnell → SDXL Lightning → Klein → … → FLUX.2 Dev last.
            </li>
            <li>
              If Cloudflare fails, it switches to Google AI Studio (if you added it), same ladder.
            </li>
            <li>Max 4 tries per graphic — protects free daily neurons / quota.</li>
            <li>
              <span className="text-[#e8f5ec]">Tip:</span> keep FLUX.1 Schnell as the configured
              model; the agent escalates automatically only when needed.
            </li>
          </ul>
        </DataPanel>
      </div>
    </div>
  );
}

function EmailProvidersPanel({
  providers,
  busyId,
  setBusyId,
  setMessage,
  onChanged,
}: {
  providers: Awaited<ReturnType<typeof api.adminListEmailProviders>>;
  busyId: string | null;
  setBusyId: (v: string | null) => void;
  setMessage: (v: string | null) => void;
  onChanged: () => Promise<void>;
}) {
  const [kind, setKind] = useState("resend");
  const [name, setName] = useState("Resend Primary");
  const [apiKey, setApiKey] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [fromName, setFromName] = useState("PejuAfrica");
  const [replyTo, setReplyTo] = useState("");
  const [priority, setPriority] = useState(100);
  const [testTo, setTestTo] = useState("");

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setBusyId("email-create");
    try {
      await api.adminCreateEmailProvider({
        kind,
        name,
        api_key: apiKey,
        from_email: fromEmail,
        from_name: fromName,
        reply_to: replyTo || undefined,
        priority,
      });
      setApiKey("");
      setMessage(`${name} online for transactional email.`);
      await onChanged();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to add email provider");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
      <div className="space-y-4">
        {providers.map((p) => (
          <article key={p.id} className="cp-panel rounded-2xl p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-display text-lg font-semibold">{p.name}</h3>
                <p className="mt-1 text-sm text-[var(--cp-dim)]">
                  {p.kind} · {p.from_name} &lt;{p.from_email}&gt; · key {p.api_key_masked}
                </p>
                {p.last_error && (
                  <p className="mt-2 text-xs text-[var(--cp-danger)]">{p.last_error}</p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="cp-btn cp-btn-ghost"
                  disabled={busyId === p.id || !testTo}
                  onClick={async () => {
                    setBusyId(p.id);
                    try {
                      await api.adminTestEmailProvider(p.id, testTo);
                      setMessage(`Test email sent via ${p.name}`);
                      await onChanged();
                    } catch (err) {
                      setMessage(err instanceof Error ? err.message : "Test failed");
                    } finally {
                      setBusyId(null);
                    }
                  }}
                >
                  Probe
                </button>
                <button
                  type="button"
                  className="cp-btn cp-btn-ghost"
                  onClick={async () => {
                    await api.adminUpdateEmailProvider(p.id, { is_active: !p.is_active });
                    await onChanged();
                  }}
                >
                  {p.is_active ? "Offline" : "Online"}
                </button>
                <button
                  type="button"
                  className="cp-btn cp-btn-danger"
                  onClick={async () => {
                    if (!confirm(`Remove ${p.name}?`)) return;
                    await api.adminDeleteEmailProvider(p.id);
                    await onChanged();
                  }}
                >
                  Purge
                </button>
              </div>
            </div>
          </article>
        ))}
        {providers.length === 0 && (
          <div className="cp-panel rounded-2xl border-dashed px-5 py-12 text-center text-sm text-[var(--cp-dim)]">
            No email nodes — invites will return a copyable link until Resend/Brevo is online.
          </div>
        )}
      </div>
      <form onSubmit={onCreate} className="cp-panel space-y-3 rounded-2xl p-5">
        <h2 className="font-display text-xl font-semibold">Commission email node</h2>
        <Field
          label="Test recipient (for Probe)"
          value={testTo}
          onChange={setTestTo}
          placeholder="you@company.com"
        />
        <label className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--cp-dim)]">
          Provider
          <select value={kind} onChange={(e) => setKind(e.target.value)} className="cp-input">
            <option value="resend">Resend</option>
            <option value="brevo">Brevo</option>
          </select>
        </label>
        <Field label="Callsign" value={name} onChange={setName} required />
        <Field label="From email" value={fromEmail} onChange={setFromEmail} required />
        <Field label="From name" value={fromName} onChange={setFromName} required />
        <Field label="Reply-to (optional)" value={replyTo} onChange={setReplyTo} />
        <Field
          label="API key"
          value={apiKey}
          onChange={setApiKey}
          type="password"
          required
          placeholder={kind === "resend" ? "re_…" : "xkeysib-…"}
        />
        <Field
          label="Priority (1 = primary)"
          value={String(priority)}
          onChange={(v) => setPriority(Number(v) || 100)}
        />
        <button type="submit" className="cp-btn cp-btn-primary w-full py-3 text-xs" disabled={busyId === "email-create"}>
          {busyId === "email-create" ? "Wiring…" : "Bring online"}
        </button>
      </form>
    </div>
  );
}

function MediaCostPanel({
  usage,
  summary,
}: {
  usage: Awaited<ReturnType<typeof api.adminMediaUsage>>;
  summary: Awaited<ReturnType<typeof api.adminMediaUsageSummary>> | null;
}) {
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="cp-panel rounded-2xl p-4">
          <p className="cp-mono text-[10px] text-[var(--cp-dim)]">EVENTS</p>
          <p className="font-display mt-2 text-3xl font-bold">{summary?.total_events ?? 0}</p>
        </div>
        <div className="cp-panel rounded-2xl p-4 sm:col-span-2">
          <p className="cp-mono text-[10px] text-[var(--cp-dim)]">EST. SPEND (USD)</p>
          <p className="font-display mt-2 text-3xl font-bold">
            ${summary?.total_estimated_cost_usd ?? "0"}
          </p>
        </div>
      </div>
      <DataPanel title="By model" code="COST">
        <OpsTable
          headers={["Provider", "Model", "Events", "Est. USD"]}
          rows={(summary?.by_model || []).map((r) => [
            r.provider,
            r.model,
            String(r.events),
            r.estimated_cost_usd,
          ])}
        />
      </DataPanel>
      <DataPanel title="Recent graphics" code="IMG">
        <div className="space-y-2">
          {usage.slice(0, 40).map((u) => (
            <div
              key={u.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-white/5 bg-black/25 px-3 py-2"
            >
              {u.media_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={u.media_url} alt="" className="h-12 w-12 rounded-lg object-cover" />
              ) : (
                <div className="h-12 w-12 rounded-lg bg-white/5" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {u.tenant_name || u.tenant_id} · {u.engine}
                </p>
                <p className="truncate text-xs text-[var(--cp-dim)]">
                  {u.image_provider}/{u.image_model} · ${u.estimated_cost_usd}
                </p>
              </div>
              <span className="cp-mono text-[10px] text-[var(--cp-dim)]">
                {new Date(u.created_at).toLocaleString()}
              </span>
            </div>
          ))}
          {usage.length === 0 && (
            <p className="py-8 text-center text-sm text-[var(--cp-dim)]">No image usage yet.</p>
          )}
        </div>
      </DataPanel>
    </div>
  );
}

function PlatformActivityPanel({
  items,
  tenants,
  onReload,
}: {
  items: Awaited<ReturnType<typeof api.adminPlatformActivity>>;
  tenants: Tenant[];
  onReload: (tenantId?: string) => Promise<void>;
}) {
  const [tenantId, setTenantId] = useState("");
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <select
          value={tenantId}
          onChange={(e) => {
            setTenantId(e.target.value);
            void onReload(e.target.value || undefined);
          }}
          className="cp-input max-w-xs"
        >
          <option value="">All tenants</option>
          {tenants.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>
      <DataPanel title="Unified feed" code="ACT">
        <div className="space-y-2">
          {items.map((ev) => (
            <div
              key={`${ev.source}-${ev.id}`}
              className="rounded-xl border border-white/5 bg-black/25 px-3 py-2.5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">{ev.title}</p>
                <span className="cp-mono text-[10px] uppercase text-[var(--cp-dim)]">
                  {ev.source}
                </span>
              </div>
              <p className="mt-1 text-xs text-[var(--cp-dim)]">
                {ev.event_type}
                {ev.created_at ? ` · ${new Date(ev.created_at).toLocaleString()}` : ""}
              </p>
            </div>
          ))}
          {items.length === 0 && (
            <p className="py-8 text-center text-sm text-[var(--cp-dim)]">No activity yet.</p>
          )}
        </div>
      </DataPanel>
    </div>
  );
}

function CloudinaryPanel({ setMessage }: { setMessage: (v: string | null) => void }) {
  const [cloudName, setCloudName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [folder, setFolder] = useState("pejuafrica");
  const [active, setActive] = useState(true);
  const [maskedKey, setMaskedKey] = useState("");
  const [maskedSecret, setMaskedSecret] = useState("");
  const [source, setSource] = useState("none");
  const [configured, setConfigured] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  async function load() {
    const cfg = await api.adminGetCloudinary();
    setCloudName(cfg.cloud_name || "");
    setFolder(cfg.folder_prefix || "pejuafrica");
    setActive(cfg.is_active);
    setMaskedKey(cfg.api_key_masked);
    setMaskedSecret(cfg.api_secret_masked);
    setSource(cfg.source);
    setConfigured(cfg.configured);
    setApiKey("");
    setApiSecret("");
    setLoaded(true);
  }

  useEffect(() => {
    load().catch((err) =>
      setMessage(err instanceof Error ? err.message : "Failed to load Cloudinary"),
    );
  }, [setMessage]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await api.adminUpdateCloudinary({
        cloud_name: cloudName.trim(),
        api_key: apiKey.trim() || undefined,
        api_secret: apiSecret.trim() || undefined,
        folder_prefix: folder.trim() || "pejuafrica",
        is_active: active,
      });
      setMessage("Cloudinary credentials saved.");
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await api.adminTestCloudinary();
      setMessage(`Cloudinary OK (${res.source}) — ${res.url}`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Test failed");
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) {
    return <p className="cp-mono text-xs text-[var(--cp-dim)]">Loading media fabric…</p>;
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
      <form onSubmit={save} className="cp-panel space-y-4 rounded-2xl p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-xl font-semibold">Cloudinary credentials</h2>
            <p className="mt-1 text-sm text-[var(--cp-dim)]">
              Keys are encrypted at rest. Leave key/secret blank to keep existing values.
            </p>
          </div>
          <span
            className={`cp-mono rounded-md border px-2 py-1 text-[10px] uppercase tracking-wider ${
              configured
                ? "border-[var(--cp-phosphor)]/40 text-[var(--cp-phosphor)]"
                : "border-white/20 text-[var(--cp-dim)]"
            }`}
          >
            {configured ? `live · ${source}` : "not configured"}
          </span>
        </div>

        <Field label="Cloud name" value={cloudName} onChange={setCloudName} required />
        <Field
          label={`API key ${maskedKey ? `(current ${maskedKey})` : ""}`}
          value={apiKey}
          onChange={setApiKey}
          placeholder="Paste new key only if rotating"
        />
        <Field
          label={`API secret ${maskedSecret ? `(current ${maskedSecret})` : ""}`}
          value={apiSecret}
          onChange={setApiSecret}
          type="password"
          placeholder="Paste new secret only if rotating"
        />
        <Field label="Folder prefix" value={folder} onChange={setFolder} />

        <label className="flex items-center gap-2 text-sm text-[#d7ebe0]">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            className="accent-[var(--cp-phosphor)]"
          />
          Active (use for logo uploads)
        </label>

        <div className="flex flex-wrap gap-2 pt-2">
          <button type="submit" disabled={busy} className="cp-btn cp-btn-primary px-5 py-2.5">
            {busy ? "Saving…" : "Save Cloudinary"}
          </button>
          <button
            type="button"
            disabled={busy || !configured}
            onClick={test}
            className="cp-btn cp-btn-ghost"
          >
            Test upload
          </button>
        </div>
      </form>

      <div className="space-y-4">
        <DataPanel title="How it works" code="CDN">
          <ul className="space-y-2 text-sm text-[var(--cp-dim)]">
            <li>Tenant logos upload to Cloudinary under `{folder}/tenants/…/logos`.</li>
            <li>Admin-saved credentials override env fallback.</li>
            <li>Future AI graphic assets can reuse this same media fabric.</li>
          </ul>
        </DataPanel>
        <DataPanel title="Security" code="SEC">
          <p className="text-sm text-[var(--cp-dim)]">
            API key and secret are Fernet-encrypted with `SECRET_KEY`. The UI only shows masked
            values after save.
          </p>
        </DataPanel>
      </div>
    </div>
  );
}

function ActivityPanel({
  activity,
  tenants,
  onReload,
}: {
  activity: Activity[];
  tenants: Tenant[];
  onReload: (tenantId?: string) => Promise<void>;
}) {
  const [filter, setFilter] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const filtered = filter ? activity.filter((a) => a.tenant_id === filter) : activity;
  const totalTokens = filtered.reduce((sum, a) => sum + (a.total_tokens || 0), 0);

  return (
    <div className="space-y-4">
      <div className="cp-panel flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4">
        <div>
          <p className="cp-mono text-[10px] uppercase tracking-[0.2em] text-[var(--cp-phosphor)]">
            Live trail
          </p>
          <p className="mt-1 text-sm text-[var(--cp-dim)]">
            {filtered.length} events · {totalTokens.toLocaleString()} tokens in view
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={filter}
            onChange={async (e) => {
              const v = e.target.value;
              setFilter(v);
              setLoading(true);
              try {
                await onReload(v || undefined);
              } finally {
                setLoading(false);
              }
            }}
            className="cp-input !mt-0 !w-auto min-w-[180px]"
          >
            <option value="">All tenants</option>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="cp-btn cp-btn-ghost"
            disabled={loading}
            onClick={async () => {
              setLoading(true);
              try {
                await onReload(filter || undefined);
              } finally {
                setLoading(false);
              }
            }}
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {filtered.length === 0 && (
          <div className="cp-panel rounded-2xl py-14 text-center text-sm text-[var(--cp-dim)]">
            No AI activity yet — generate or regenerate from a tenant app.
          </div>
        )}
        {filtered.map((a) => {
          const open = openId === a.id;
          return (
            <article key={a.id} className="cp-panel overflow-hidden rounded-2xl">
              <button
                type="button"
                onClick={() => setOpenId(open ? null : a.id)}
                className="flex w-full flex-wrap items-start justify-between gap-3 px-4 py-3.5 text-left"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="cp-mono text-[10px] uppercase tracking-wider text-[var(--cp-phosphor)]">
                      {a.action}
                    </span>
                    <span className="text-sm font-semibold">{a.tenant_name}</span>
                    {a.day_index != null && (
                      <span className="text-xs text-[var(--cp-dim)]">Day {a.day_index}</span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-[var(--cp-dim)]">
                    {a.user_name || a.user_email || "user"} · {a.provider}/{a.model}
                    {a.tone ? ` · ${a.tone}` : ""}
                    {a.occasion ? ` · ${a.occasion}` : ""}
                  </p>
                  {a.focus && (
                    <p className="mt-1 line-clamp-1 text-xs text-[#d7ebe0]">Focus: {a.focus}</p>
                  )}
                </div>
                <div className="text-right">
                  <p className="font-display text-lg font-bold text-[var(--cp-phosphor)]">
                    {a.total_tokens.toLocaleString()}
                  </p>
                  <p className="cp-mono text-[10px] text-[var(--cp-dim)]">
                    {new Date(a.created_at).toLocaleString()}
                  </p>
                </div>
              </button>
              {open && (
                <div className="space-y-3 border-t border-[var(--cp-edge)] bg-black/25 px-4 py-4 text-sm">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <MetaChip label="Prompt tok" value={String(a.prompt_tokens)} />
                    <MetaChip label="Completion tok" value={String(a.completion_tokens)} />
                    <MetaChip label="Total" value={String(a.total_tokens)} />
                  </div>
                  {a.prompt_excerpt && (
                    <div>
                      <p className="cp-mono text-[10px] uppercase tracking-wider text-[var(--cp-dim)]">
                        Prompt / brief
                      </p>
                      <pre className="mt-1 whitespace-pre-wrap rounded-xl border border-white/5 bg-black/40 p-3 text-xs text-[#cfe8d9]">
                        {a.prompt_excerpt}
                      </pre>
                    </div>
                  )}
                  {a.response_excerpt && (
                    <div>
                      <p className="cp-mono text-[10px] uppercase tracking-wider text-[var(--cp-dim)]">
                        Response excerpt
                      </p>
                      <pre className="mt-1 whitespace-pre-wrap rounded-xl border border-white/5 bg-black/40 p-3 text-xs text-[#d7ebe0]">
                        {a.response_excerpt}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}

function MetaChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/5 bg-black/30 px-3 py-2">
      <p className="cp-mono text-[9px] uppercase tracking-wider text-[var(--cp-dim)]">{label}</p>
      <p className="font-display text-lg font-bold">{value}</p>
    </div>
  );
}

function GenerationsPanel({
  generations,
  onInspectTenant,
}: {
  generations: Generation[];
  onInspectTenant: (tenantId: string) => void;
}) {
  return (
    <DataPanel title="Attribution stream" code="ATR" flush>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--cp-edge)] text-[var(--cp-dim)]">
              {["Campaign", "Tenant", "Provider", "Model", "Timestamp", ""].map((h) => (
                <th
                  key={h || "act"}
                  className="cp-mono px-4 py-3 text-[10px] font-medium uppercase tracking-[0.16em]"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {generations.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-14 text-center text-[var(--cp-dim)]">
                  Stream empty — generate a campaign to see attribution.
                </td>
              </tr>
            )}
            {generations.map((g) => (
              <tr
                key={g.campaign_id}
                className="border-b border-white/5 transition hover:bg-[var(--cp-phosphor)]/[0.04]"
              >
                <td className="px-4 py-3.5 font-medium">{g.title}</td>
                <td className="px-4 py-3.5 text-[var(--cp-dim)]">{g.tenant_name}</td>
                <td className="px-4 py-3.5">
                  <ProviderBadge provider={g.generation_provider} model={null} />
                </td>
                <td className="cp-mono px-4 py-3.5 text-xs text-[var(--cp-dim)]">
                  {g.generation_model || "—"}
                </td>
                <td className="cp-mono px-4 py-3.5 text-xs text-[var(--cp-dim)]">
                  {new Date(g.created_at).toLocaleString()}
                </td>
                <td className="px-4 py-3.5 text-right">
                  <button
                    type="button"
                    className="cp-btn cp-btn-ghost"
                    onClick={() => onInspectTenant(g.tenant_id)}
                  >
                    Inspect
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </DataPanel>
  );
}

function TenantsPanel({
  tenants,
  busyId,
  setBusyId,
  setMessage,
  onRefresh,
  router,
}: {
  tenants: Tenant[];
  busyId: string | null;
  setBusyId: (v: string | null) => void;
  setMessage: (v: string | null) => void;
  onRefresh: () => Promise<void>;
  router: ReturnType<typeof useRouter>;
}) {
  const [inspectId, setInspectId] = useState<string | null>(null);
  const [marketing, setMarketing] = useState<Awaited<
    ReturnType<typeof api.adminTenantMarketing>
  > | null>(null);
  const [loadingInspect, setLoadingInspect] = useState(false);
  const [activeCampaignId, setActiveCampaignId] = useState<string | null>(null);
  const [openPostId, setOpenPostId] = useState<string | null>(null);

  async function openInspect(tenantId: string) {
    setInspectId(tenantId);
    setLoadingInspect(true);
    setMarketing(null);
    setActiveCampaignId(null);
    setOpenPostId(null);
    try {
      const data = await api.adminTenantMarketing(tenantId);
      setMarketing(data);
      setActiveCampaignId(data.campaigns[0]?.id ?? null);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to load marketing");
      setInspectId(null);
    } finally {
      setLoadingInspect(false);
    }
  }

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ tenantId: string }>).detail;
      if (detail?.tenantId) openInspect(detail.tenantId);
    };
    window.addEventListener("peju-inspect-tenant", handler);
    return () => window.removeEventListener("peju-inspect-tenant", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeCampaign = marketing?.campaigns.find((c) => c.id === activeCampaignId) || null;
  const openPost = activeCampaign?.posts.find((p) => p.id === openPostId) || null;

  return (
    <>
      <div className="grid gap-3">
        {tenants.map((t, i) => (
          <motion.article
            key={t.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.03 }}
            className="cp-panel flex flex-wrap items-center justify-between gap-4 rounded-2xl p-4 sm:p-5"
          >
            <div className="flex items-center gap-4">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--cp-edge)] bg-black/40 font-display text-sm font-bold text-[var(--cp-phosphor)]">
                {t.name.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <p className="font-semibold">{t.name}</p>
                <p className="cp-mono text-[11px] text-[var(--cp-dim)]">
                  {t.slug}
                  {t.industry ? ` · ${t.industry}` : ""}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`cp-mono rounded-md border px-2 py-1 text-[10px] uppercase tracking-wider ${
                  t.status === "suspended"
                    ? "border-[var(--cp-danger)]/40 text-[var(--cp-danger)]"
                    : "border-[var(--cp-phosphor)]/30 text-[var(--cp-phosphor)]"
                }`}
              >
                {t.status}
              </span>
              <button
                type="button"
                className="cp-btn cp-btn-primary"
                onClick={() => openInspect(t.id)}
              >
                Marketing
              </button>
              <button
                type="button"
                disabled={busyId === t.id}
                className="cp-btn cp-btn-ghost"
                onClick={async () => {
                  setBusyId(t.id);
                  try {
                    const res = await api.adminImpersonate(t.id);
                    localStorage.setItem("peju_tenant_id", res.tenant_id);
                    router.push("/app");
                  } catch (err) {
                    setMessage(err instanceof Error ? err.message : "Failed");
                  } finally {
                    setBusyId(null);
                  }
                }}
              >
                Enter
              </button>
              <button
                type="button"
                disabled={busyId === t.id}
                className="cp-btn cp-btn-ghost"
                onClick={async () => {
                  setBusyId(t.id);
                  try {
                    await api.adminUpdateTenantStatus(
                      t.id,
                      t.status === "suspended" ? "active" : "suspended",
                    );
                    await onRefresh();
                  } finally {
                    setBusyId(null);
                  }
                }}
              >
                {t.status === "suspended" ? "Reactivate" : "Suspend"}
              </button>
            </div>
          </motion.article>
        ))}
        {tenants.length === 0 && (
          <div className="cp-panel rounded-2xl py-14 text-center text-sm text-[var(--cp-dim)]">
            No tenants in fleet yet.
          </div>
        )}
      </div>

      <AnimatePresence>
        {inspectId && (
          <motion.div
            className="fixed inset-0 z-[60] flex justify-end"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <button
              type="button"
              className="absolute inset-0 bg-black/70"
              aria-label="Close"
              onClick={() => setInspectId(null)}
            />
            <motion.aside
              initial={{ x: 520 }}
              animate={{ x: 0 }}
              exit={{ x: 520 }}
              transition={{ type: "spring", stiffness: 300, damping: 32 }}
              className="relative z-10 flex h-full w-full max-w-xl flex-col overflow-y-auto border-l border-[var(--cp-edge)] bg-[rgba(2,8,6,0.97)]"
            >
              <div className="border-b border-[var(--cp-edge)] px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="cp-mono text-[10px] uppercase tracking-[0.22em] text-[var(--cp-phosphor)]">
                      Tenant marketing intel
                    </p>
                    <h3 className="font-display mt-1 text-2xl font-bold">
                      {marketing?.tenant_name || "Loading…"}
                    </h3>
                    <p className="mt-1 text-sm text-[var(--cp-dim)]">
                      {marketing?.business_name || marketing?.tenant_slug}
                      {marketing?.industry ? ` · ${marketing.industry}` : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="cp-btn cp-btn-ghost"
                    onClick={() => setInspectId(null)}
                  >
                    Close
                  </button>
                </div>
              </div>

              <div className="flex-1 space-y-4 px-5 py-5">
                {loadingInspect && (
                  <p className="cp-mono text-xs text-[var(--cp-dim)]">Pulling campaigns…</p>
                )}

                {!loadingInspect && marketing && marketing.campaigns.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-[var(--cp-edge)] py-12 text-center text-sm text-[var(--cp-dim)]">
                    This tenant has not generated any AI marketing plans yet.
                  </div>
                )}

                {marketing && marketing.campaigns.length > 0 && (
                  <>
                    <div className="flex flex-wrap gap-2">
                      {marketing.campaigns.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => {
                            setActiveCampaignId(c.id);
                            setOpenPostId(null);
                          }}
                          className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                            activeCampaignId === c.id
                              ? "border-[var(--cp-phosphor)] bg-[var(--cp-phosphor)] text-[var(--accent-ink)]"
                              : "border-[var(--cp-edge)] text-[var(--cp-dim)]"
                          }`}
                        >
                          {c.month}/{c.year} · {c.post_count} posts
                        </button>
                      ))}
                    </div>

                    {activeCampaign && (
                      <div className="space-y-3">
                        <div className="cp-panel rounded-2xl p-4">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-display font-semibold">{activeCampaign.title}</p>
                            <ProviderBadge
                              provider={activeCampaign.generation_provider}
                              model={activeCampaign.generation_model}
                            />
                          </div>
                          <p className="mt-2 text-sm leading-relaxed text-[var(--cp-dim)]">
                            {activeCampaign.strategy_summary}
                          </p>
                        </div>

                        <div className="space-y-2">
                          {activeCampaign.posts.map((p) => (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() =>
                                setOpenPostId((id) => (id === p.id ? null : p.id))
                              }
                              className="w-full rounded-xl border border-white/5 bg-black/25 px-3 py-3 text-left transition hover:border-[var(--cp-edge-strong)]"
                            >
                              <div className="flex flex-wrap items-center gap-2 text-xs">
                                <span className="font-semibold text-[var(--cp-phosphor)]">
                                  Day {p.day_index}
                                </span>
                                <span className="capitalize text-[var(--cp-dim)]">{p.platform}</span>
                                <span className="text-[#d7ebe0]">{p.theme}</span>
                                <span className="ml-auto cp-mono uppercase tracking-wider text-[10px] text-[var(--cp-dim)]">
                                  {p.status}
                                </span>
                              </div>
                              {openPostId === p.id && (
                                <div className="mt-3 space-y-2 border-t border-white/5 pt-3 text-sm">
                                  <p className="whitespace-pre-wrap text-[#d7ebe0]">{p.caption}</p>
                                  {p.cta && (
                                    <p className="text-xs text-[var(--cp-phosphor)]">CTA: {p.cta}</p>
                                  )}
                                  {p.hashtags && (
                                    <p className="text-xs text-[var(--cp-dim)]">
                                      {(p.hashtags as string[]).join(" ")}
                                    </p>
                                  )}
                                  {p.graphic_prompt && (
                                    <p className="text-xs text-[var(--cp-dim)]">
                                      Graphic: {p.graphic_prompt}
                                    </p>
                                  )}
                                </div>
                              )}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>

              {openPost && (
                <div className="border-t border-[var(--cp-edge)] px-5 py-3 text-xs text-[var(--cp-dim)]">
                  Viewing day {openPost.day_index} · {openPost.theme}
                </div>
              )}
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function PromptsPanel({ prompts }: { prompts: Prompt[] }) {
  return (
    <div className="space-y-4">
      {prompts.map((p) => (
        <article key={p.id} className="cp-panel rounded-2xl p-5">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-display text-lg font-semibold">{p.name}</h3>
            <span className="cp-mono rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-[var(--cp-dim)]">
              {p.key}
            </span>
            <span className="cp-mono text-[10px] text-[var(--cp-phosphor)]">v{p.version}</span>
          </div>
          {p.description && (
            <p className="mt-2 text-sm text-[var(--cp-dim)]">{p.description}</p>
          )}
          <pre className="mt-4 overflow-x-auto rounded-xl border border-[var(--cp-edge)] bg-black/40 p-4 text-xs leading-relaxed text-[#cfe8d9]">
            {p.body}
          </pre>
        </article>
      ))}
      {prompts.length === 0 && (
        <div className="cp-panel rounded-2xl py-14 text-center text-sm text-[var(--cp-dim)]">
          No prompt templates seeded yet.
        </div>
      )}
    </div>
  );
}

function ComingOnline({ id }: { id: ModuleId }) {
  return (
    <div className="cp-panel relative overflow-hidden rounded-2xl px-6 py-16 text-center">
      <div className="pointer-events-none absolute inset-0 opacity-30">
        <div className="absolute left-1/2 top-1/2 h-40 w-40 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[var(--cp-phosphor)]/40 cp-radar-ring" />
      </div>
      <p className="cp-mono relative text-[10px] uppercase tracking-[0.3em] text-[var(--cp-phosphor)]">
        Module {id}
      </p>
      <h2 className="font-display relative mt-3 text-3xl font-bold">{MODULE_META[id].title}</h2>
      <p className="relative mx-auto mt-3 max-w-md text-sm text-[var(--cp-dim)]">
        {MODULE_META[id].subtitle} This bay is reserved — UI shell is ready for the next build.
      </p>
      <p className="cp-mono relative mt-6 text-[10px] uppercase tracking-[0.24em] text-[var(--cp-dim)]">
        Slot reserved · architecture expandable
      </p>
    </div>
  );
}

function HudChip({
  led,
  label,
  value,
}: {
  led: string;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="cp-led" style={{ background: led, color: led }} />
      <div>
        <p className="cp-mono text-[9px] uppercase tracking-[0.2em] text-[var(--cp-dim)]">{label}</p>
        <p className="text-xs font-semibold">{value}</p>
      </div>
    </div>
  );
}

function StatusPill({ active }: { active: boolean }) {
  return (
    <span
      className={`cp-mono rounded-md px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${
        active
          ? "bg-[var(--cp-phosphor)]/15 text-[var(--cp-phosphor)]"
          : "bg-white/10 text-white/45"
      }`}
    >
      {active ? "Live" : "Idle"}
    </span>
  );
}

function ProviderBadge({
  provider,
  model,
}: {
  provider: string | null | undefined;
  model?: string | null;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-[var(--cp-edge-strong)] bg-[var(--cp-phosphor)]/10 px-2 py-1 text-xs font-semibold capitalize text-[var(--cp-phosphor)]">
      <span className="cp-led !h-1.5 !w-1.5 bg-[var(--cp-phosphor)] text-[var(--cp-phosphor)]" />
      {provider || "template"}
      {model ? <span className="font-normal text-[var(--cp-dim)]">· {model}</span> : null}
    </span>
  );
}

function DataPanel({
  title,
  code,
  children,
  flush,
}: {
  title: string;
  code: string;
  children: ReactNode;
  flush?: boolean;
}) {
  return (
    <section className="cp-panel rounded-2xl">
      <div className="flex items-center justify-between border-b border-[var(--cp-edge)] px-4 py-3 sm:px-5">
        <h2 className="font-display text-base font-semibold sm:text-lg">{title}</h2>
        <span className="cp-mono text-[10px] tracking-[0.2em] text-[var(--cp-phosphor)]/70">
          {code}
        </span>
      </div>
      <div className={flush ? "" : "p-4 sm:p-5"}>{children}</div>
    </section>
  );
}

function OpsTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="text-[var(--cp-dim)]">
            {headers.map((h) => (
              <th
                key={h}
                className="cp-mono px-2 py-2 text-[10px] font-medium uppercase tracking-[0.14em]"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={headers.length} className="px-2 py-8 text-[var(--cp-dim)]">
                No signal yet
              </td>
            </tr>
          )}
          {rows.map((row, i) => (
            <tr key={i} className="border-t border-white/5">
              {row.map((cell, j) => (
                <td key={j} className="px-2 py-2.5 text-[#d7ebe0]">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  required,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--cp-dim)]">
      {label}
      <input
        type={type}
        value={value}
        required={required}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="cp-input font-normal normal-case tracking-normal"
      />
    </label>
  );
}
