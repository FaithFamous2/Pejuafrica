"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { api } from "@/lib/api";
import { BrandLogo } from "@/components/brand-logo";
import { useApp } from "@/components/app-shell";

const ease = [0.22, 1, 0.36, 1] as const;

type FormState = {
  business_name: string;
  industry: string;
  brand_voice: string;
  target_audience: string;
  competitors: string;
  socials: string;
  goals: string;
};

const STEPS = [
  {
    key: "basics",
    title: "Your business",
    subtitle: "Who you are and what you sell.",
  },
  {
    key: "voice",
    title: "Brand voice",
    subtitle: "How Peju should sound when it writes for you.",
  },
  {
    key: "audience",
    title: "Audience & market",
    subtitle: "Who you want to reach — and who else is competing.",
  },
  {
    key: "presence",
    title: "Goals & socials",
    subtitle: "Where you show up and what success looks like.",
  },
  {
    key: "init",
    title: "Initialize AI memory",
    subtitle: "Peju builds a business memory layer from your profile.",
  },
] as const;

const INDUSTRY_OPTIONS = [
  "Fashion & Apparel",
  "Beauty & Cosmetics",
  "Restaurant & Food Service",
  "Cafe & Bakery",
  "Grocery & Retail",
  "E‑commerce / Online Store",
  "Healthcare & Clinic",
  "Pharmacy",
  "Education & Training",
  "Real Estate",
  "Construction & Trades",
  "Automotive",
  "Travel & Hospitality",
  "Events & Entertainment",
  "Agriculture & Agribusiness",
  "Fintech & Financial Services",
  "Technology & SaaS",
  "Marketing & Creative Agency",
  "Professional Services (Legal, Accounting)",
  "Logistics & Delivery",
  "Manufacturing",
  "Nonprofit & Community",
] as const;

const INDUSTRY_OTHER = "Other";

const AUDIENCE_OPTIONS = [
  "Young professionals",
  "University students",
  "Families with kids",
  "Parents & caregivers",
  "Women (18–35)",
  "Men (18–35)",
  "Working-class shoppers",
  "Middle / upper-income buyers",
  "Small business owners",
  "Corporate / office workers",
  "Tourists & visitors",
  "Religious / community groups",
  "Tech-savvy online shoppers",
  "WhatsApp-first customers",
  "Instagram / social buyers",
  "Local neighbourhood residents",
  "Diaspora / abroad shoppers",
] as const;

const SOCIAL_FIELDS = [
  { key: "instagram", label: "Instagram", placeholder: "@yourbrand" },
  { key: "tiktok", label: "TikTok", placeholder: "@yourbrand" },
  { key: "facebook", label: "Facebook", placeholder: "Page name or URL" },
  { key: "whatsapp", label: "WhatsApp", placeholder: "+234…" },
  { key: "twitter", label: "X (Twitter)", placeholder: "@yourbrand" },
  { key: "linkedin", label: "LinkedIn", placeholder: "Company or profile URL" },
  { key: "youtube", label: "YouTube", placeholder: "@channel or URL" },
  { key: "website", label: "Website", placeholder: "https://…" },
] as const;

function uniqueTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const t = raw.trim().replace(/\s+/g, " ");
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

function parseTagList(raw: string): string[] {
  if (!(raw || "").trim()) return [];
  return uniqueTags(raw.split(/[,;·|\n]+/));
}

function serializeTags(tags: string[]): string {
  return uniqueTags(tags).join(", ");
}

function parseSocialsText(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  (raw || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .forEach((line) => {
      const [k, ...rest] = line.split(":");
      if (k && rest.length) out[k.trim().toLowerCase()] = rest.join(":").trim();
    });
  return out;
}

function serializeSocials(map: Record<string, string>): string {
  return SOCIAL_FIELDS.map(({ key }) => {
    const v = (map[key] || "").trim();
    return v ? `${key}: ${v}` : "";
  })
    .filter(Boolean)
    .join("\n");
}

function resolveIndustryChoice(saved: string): { choice: string; other: string } {
  const value = saved.trim();
  if (!value) return { choice: "", other: "" };
  if ((INDUSTRY_OPTIONS as readonly string[]).includes(value)) {
    return { choice: value, other: "" };
  }
  return { choice: INDUSTRY_OTHER, other: value };
}

function resumeStepFromProfile(profile: {
  business_name?: string | null;
  industry?: string | null;
  brand_voice?: string | null;
  target_audience?: string | null;
  competitors?: string[] | null;
  socials?: Record<string, string> | null;
  goals?: string | null;
  onboarding_completed?: boolean;
  memory_initialized?: boolean;
}): number {
  if (!profile.memory_initialized && profile.onboarding_completed) return 4;
  if (!(profile.business_name || "").trim() || !(profile.industry || "").trim()) return 0;
  if (!(profile.brand_voice || "").trim()) return 1;
  if (!(profile.target_audience || "").trim()) return 2;
  const hasPresence =
    Boolean((profile.goals || "").trim()) ||
    Boolean(profile.competitors?.length) ||
    Boolean(profile.socials && Object.keys(profile.socials).length);
  if (!hasPresence || !profile.onboarding_completed) return 3;
  if (!profile.memory_initialized) return 4;
  return 0;
}

export default function OnboardingPage() {
  const router = useRouter();
  const { refresh } = useApp();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [booting, setBooting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assistBusy, setAssistBusy] = useState(false);
  const [assistMode, setAssistMode] = useState<"auto" | "draft" | "rewrite" | null>(null);
  const [helperText, setHelperText] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({
    business_name: "",
    industry: "",
    brand_voice: "",
    target_audience: "",
    competitors: "",
    socials: "",
    goals: "",
  });
  const [industryChoice, setIndustryChoice] = useState("");
  const [industryOther, setIndustryOther] = useState("");

  function applyIndustry(choice: string, other = industryOther) {
    setIndustryChoice(choice);
    if (choice === INDUSTRY_OTHER) {
      setIndustryOther(other);
      update("industry", other.trim());
    } else {
      setIndustryOther("");
      update("industry", choice);
    }
  }

  useEffect(() => {
    const tenantId = localStorage.getItem("peju_tenant_id");
    api
      .me(tenantId)
      .then(async (me) => {
        const tid = me.active_tenant?.id || me.memberships[0]?.tenant.id || tenantId;
        if (!tid) return;
        localStorage.setItem("peju_tenant_id", tid);
        try {
          const profile = await api.getBusinessProfile(tid);
          setForm({
            business_name: profile.business_name || "",
            industry: profile.industry || "",
            brand_voice: profile.brand_voice || "",
            target_audience: profile.target_audience || "",
            competitors: (profile.competitors || []).join(", "),
            socials: profile.socials ? serializeSocials(profile.socials) : "",
            goals: profile.goals || "",
          });
          const resolved = resolveIndustryChoice(profile.industry || "");
          setIndustryChoice(resolved.choice);
          setIndustryOther(resolved.other);
          if (profile.memory_initialized) {
            await refresh();
            router.replace("/app");
            return;
          }
          setStep(resumeStepFromProfile(profile));
        } catch {
          /* new tenant may not have profile yet */
        }
      })
      .catch(() => router.replace("/login"));
  }, [router, refresh]);

  const progress = useMemo(() => ((step + 1) / STEPS.length) * 100, [step]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function helpWithStep(mode: "auto" | "draft" | "rewrite" = "auto") {
    const tenantId = localStorage.getItem("peju_tenant_id");
    if (!tenantId) return;
    setAssistBusy(true);
    setAssistMode(mode);
    setError(null);
    try {
      const stepKey = STEPS[step].key;
      const res = await api.assistOnboardingStep(tenantId, {
        step: stepKey,
        mode: stepKey === "voice" || stepKey === "presence" ? mode : "auto",
        business_name: form.business_name,
        industry: form.industry,
        brand_voice: form.brand_voice,
        target_audience: form.target_audience,
        competitors: form.competitors,
        socials: form.socials,
        goals: form.goals,
      });
      const s = res.suggestions || {};
      setForm((prev) => {
        const nextIndustry = s.industry || prev.industry;
        const resolved = resolveIndustryChoice(nextIndustry);
        setIndustryChoice(resolved.choice);
        setIndustryOther(resolved.other);
        let nextSocials = prev.socials;
        if (s.socials) {
          // Merge AI social suggestions into existing fields without wiping filled ones
          const merged = { ...parseSocialsText(prev.socials), ...parseSocialsText(s.socials) };
          nextSocials = serializeSocials(merged);
        }
        return {
          ...prev,
          industry: nextIndustry,
          brand_voice: s.brand_voice != null && s.brand_voice !== "" ? s.brand_voice : prev.brand_voice,
          target_audience: s.target_audience
            ? serializeTags(parseTagList(s.target_audience))
            : prev.target_audience,
          competitors: s.competitors
            ? serializeTags(parseTagList(s.competitors))
            : prev.competitors,
          goals: s.goals != null && s.goals !== "" ? s.goals : prev.goals,
          socials: nextSocials,
        };
      });
      const via = res.source === "llm" ? "AI" : "Peju";
      setHelperText(
        res.helper_text ||
          (mode === "rewrite"
            ? `${via} reshaped your writing — edit anything that doesn’t feel right.`
            : `${via} drafted this — edit anything that doesn’t feel right.`),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI assist failed");
    } finally {
      setAssistBusy(false);
      setAssistMode(null);
    }
  }

  async function saveProfile(initializeMemory = false) {
    const tenantId = localStorage.getItem("peju_tenant_id");
    if (!tenantId) throw new Error("Missing tenant context");

    const socials = parseSocialsText(form.socials);

    return api.upsertBusinessProfile(tenantId, {
      business_name: form.business_name,
      industry: form.industry || null,
      brand_voice: form.brand_voice || null,
      target_audience: form.target_audience || null,
      competitors: form.competitors
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean),
      socials: Object.keys(socials).length ? socials : null,
      goals: form.goals || null,
      initialize_memory: initializeMemory,
    });
  }

  async function next() {
    setError(null);
    setHelperText(null);
    if (step < STEPS.length - 1) {
      // Persist every step so leaving mid-flow / new browser can resume
      setLoading(true);
      try {
        if (!form.business_name.trim()) {
          setError("Business name is required to continue.");
          return;
        }
        await saveProfile(false);
        setStep((s) => s + 1);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save profile");
      } finally {
        setLoading(false);
      }
      return;
    }

    setBooting(true);
    setLoading(true);
    try {
      await saveProfile(true);
      // Refresh app context so the onboarding gate sees memory_initialized
      await refresh();
      await new Promise((r) => setTimeout(r, 600));
      router.replace("/app");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Initialization failed");
      setBooting(false);
    } finally {
      setLoading(false);
    }
  }

  function back() {
    setError(null);
    setHelperText(null);
    setStep((s) => Math.max(0, s - 1));
  }

  const current = STEPS[step];

  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="peju-drift absolute -left-20 top-10 h-72 w-72 rounded-full bg-brand/15 blur-3xl" />
        <div className="peju-drift-slow absolute bottom-0 right-0 h-80 w-80 rounded-full bg-accent/25 blur-3xl" />
      </div>

      <header className="mx-auto flex max-w-3xl items-center justify-between px-6 py-6">
        <BrandLogo href="/app" variant="full" className="h-8" />
        <p className="text-sm text-muted">
          Step {step + 1} of {STEPS.length}
        </p>
      </header>

      <div className="mx-auto max-w-3xl px-6">
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-soft">
          <motion.div
            className="h-full rounded-full bg-brand"
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.45, ease }}
          />
        </div>
      </div>

      <main className="mx-auto max-w-3xl px-6 py-10">
        <AnimatePresence mode="wait">
          <motion.div
            key={current.key}
            initial={{ opacity: 0, x: 28 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -28 }}
            transition={{ duration: 0.4, ease }}
          >
            <h1 className="font-display text-3xl font-bold text-brand-deep md:text-4xl">
              {current.title}
            </h1>
            <p className="mt-2 text-muted">{current.subtitle}</p>

            {step === 1 ? (
              <div className="mt-5 space-y-3 rounded-2xl border border-accent/40 bg-gradient-to-br from-accent/20 via-accent/10 to-transparent px-4 py-4">
                <div>
                  <p className="text-sm font-semibold text-accent-ink">Stuck on brand voice?</p>
                  <p className="mt-1 text-sm text-accent-ink/80">
                    Let Peju write a starting voice from your business + industry, or polish what
                    you already typed.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={assistBusy || loading}
                    onClick={() => helpWithStep("draft")}
                    className="rounded-full bg-brand-deep px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    {assistBusy && assistMode === "draft"
                      ? "Writing…"
                      : "Write with AI"}
                  </button>
                  <button
                    type="button"
                    disabled={assistBusy || loading || !form.brand_voice.trim()}
                    onClick={() => helpWithStep("rewrite")}
                    className="rounded-full border border-brand-deep/20 bg-white px-4 py-2 text-xs font-semibold text-brand-deep disabled:opacity-50"
                  >
                    {assistBusy && assistMode === "rewrite"
                      ? "Improving…"
                      : "Improve what I wrote"}
                  </button>
                </div>
                {!form.brand_voice.trim() && (
                  <p className="text-[11px] text-muted">
                    Tip: type a few rough words (e.g. “friendly, simple, no slang”) then tap Improve —
                    or leave it blank and tap Write with AI.
                  </p>
                )}
              </div>
            ) : step === 3 ? (
              <div className="mt-5 space-y-3 rounded-2xl border border-accent/40 bg-gradient-to-br from-accent/20 via-accent/10 to-transparent px-4 py-4">
                <div>
                  <p className="text-sm font-semibold text-accent-ink">Need clearer business goals?</p>
                  <p className="mt-1 text-sm text-accent-ink/80">
                    Peju can draft goals from your business, or rewrite rough notes into measurable
                    targets.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={assistBusy || loading}
                    onClick={() => helpWithStep("draft")}
                    className="rounded-full bg-brand-deep px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    {assistBusy && assistMode === "draft" ? "Writing…" : "Write goals with AI"}
                  </button>
                  <button
                    type="button"
                    disabled={assistBusy || loading || !form.goals.trim()}
                    onClick={() => helpWithStep("rewrite")}
                    className="rounded-full border border-brand-deep/20 bg-white px-4 py-2 text-xs font-semibold text-brand-deep disabled:opacity-50"
                  >
                    {assistBusy && assistMode === "rewrite"
                      ? "Improving…"
                      : "Improve what I wrote"}
                  </button>
                </div>
              </div>
            ) : step < STEPS.length - 1 ? (
              <div className="mt-5 flex flex-wrap items-center gap-3 rounded-2xl border border-accent/35 bg-accent/15 px-4 py-3">
                <p className="flex-1 text-sm text-accent-ink">
                  Not sure what to write? Peju can draft this step for you.
                </p>
                <button
                  type="button"
                  disabled={assistBusy || loading}
                  onClick={() => helpWithStep("auto")}
                  className="rounded-full bg-brand-deep px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {assistBusy ? "Thinking…" : "Help me fill this"}
                </button>
              </div>
            ) : (
              <div className="mt-5 flex flex-wrap items-center gap-3 rounded-2xl border border-accent/35 bg-accent/15 px-4 py-3">
                <p className="flex-1 text-sm text-accent-ink">
                  Want a quick readiness check before initializing memory?
                </p>
                <button
                  type="button"
                  disabled={assistBusy || loading}
                  onClick={() => helpWithStep("auto")}
                  className="rounded-full bg-brand-deep px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {assistBusy ? "Thinking…" : "AI readiness check"}
                </button>
              </div>
            )}
            {helperText && (
              <p className="mt-3 text-sm text-brand">{helperText}</p>
            )}

            <div className="mt-8 space-y-4">
              {step === 0 && (
                <>
                  <Field
                    label="Business name"
                    value={form.business_name}
                    onChange={(v) => update("business_name", v)}
                    required
                  />
                  <IndustrySelect
                    choice={industryChoice}
                    other={industryOther}
                    onChoiceChange={(choice) => applyIndustry(choice)}
                    onOtherChange={(other) => applyIndustry(INDUSTRY_OTHER, other)}
                    required
                  />
                </>
              )}
              {step === 1 && (
                <TextArea
                  label="Brand voice"
                  value={form.brand_voice}
                  onChange={(v) => update("brand_voice", v)}
                  placeholder="e.g. Warm and simple — like a neighbour who knows the product. No stiff corporate talk…"
                  required
                />
              )}
              {step === 2 && (
                <>
                  <AudiencePicker
                    value={form.target_audience}
                    onChange={(v) => update("target_audience", v)}
                    required
                  />
                  <CompetitorTags
                    value={form.competitors}
                    onChange={(v) => update("competitors", v)}
                  />
                </>
              )}
              {step === 3 && (
                <>
                  <TextArea
                    label="Business goals"
                    value={form.goals}
                    onChange={(v) => update("goals", v)}
                    placeholder="More walk-ins, WhatsApp inquiries, brand awareness…"
                  />
                  <SocialAccountsFields
                    value={form.socials}
                    onChange={(v) => update("socials", v)}
                  />
                </>
              )}
              {step === 4 && (
                <div className="rounded-[1.75rem] border border-line bg-surface p-8">
                  {booting ? (
                    <div className="flex flex-col items-center py-6 text-center">
                      <motion.div
                        className="h-16 w-16 rounded-full border-4 border-brand/20 border-t-brand"
                        animate={{ rotate: 360 }}
                        transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                      />
                      <p className="font-display mt-6 text-xl font-bold text-brand-deep">
                        Building your business memory…
                      </p>
                      <p className="mt-2 max-w-sm text-sm text-muted">
                        Embedding brand voice, audience, and goals into Peju&apos;s AI layer.
                      </p>
                    </div>
                  ) : (
                    <div>
                      <p className="font-display text-xl font-bold text-brand-deep">
                        You&apos;re ready to initialize
                      </p>
                      <p className="mt-2 text-muted">
                        We&apos;ll save your profile and create the AI memory Peju uses for
                        marketing strategy and content.
                      </p>
                      <ul className="mt-5 space-y-2 text-sm text-muted">
                        <li>• Business: {form.business_name || "—"}</li>
                        <li>• Industry: {form.industry || "—"}</li>
                        <li>• Voice: {form.brand_voice ? "Set" : "Missing"}</li>
                        <li>• Audience: {form.target_audience ? "Set" : "Missing"}</li>
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        </AnimatePresence>

        {error && <p className="mt-4 text-sm text-danger">{error}</p>}

        <div className="mt-10 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={back}
            disabled={step === 0 || loading}
            className="rounded-full px-5 py-2.5 text-sm font-medium text-muted disabled:opacity-40"
          >
            Back
          </button>
          <motion.button
            type="button"
            onClick={next}
            disabled={loading || booting || !canContinue(step, form)}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="rounded-full bg-brand-deep px-7 py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {step === STEPS.length - 1
              ? loading
                ? "Initializing…"
                : "Initialize AI memory"
              : loading
                ? "Saving…"
                : "Continue"}
          </motion.button>
        </div>
      </main>
    </div>
  );
}

function canContinue(step: number, form: FormState) {
  if (step === 0) return Boolean(form.business_name.trim() && form.industry.trim());
  if (step === 1) return Boolean(form.brand_voice.trim());
  if (step === 2) return Boolean(form.target_audience.trim());
  return true;
}

function IndustrySelect({
  choice,
  other,
  onChoiceChange,
  onOtherChange,
  required,
}: {
  choice: string;
  other: string;
  onChoiceChange: (v: string) => void;
  onOtherChange: (v: string) => void;
  required?: boolean;
}) {
  const showOther = choice === INDUSTRY_OTHER;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const list = [...INDUSTRY_OPTIONS, INDUSTRY_OTHER];
  const label = choice || "Select your industry";

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="space-y-3" ref={rootRef}>
      <div className="block text-sm">
        <span className="mb-1.5 block font-medium text-brand-deep">
          Industry{required ? <span className="text-danger"> *</span> : null}
        </span>
        <div className="relative">
          <button
            type="button"
            aria-haspopup="listbox"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className={`group flex w-full items-center justify-between gap-3 rounded-2xl border bg-gradient-to-b from-white to-surface-soft/40 px-4 py-3.5 text-left shadow-[0_1px_0_rgba(8,53,38,0.04)] outline-none transition ${
              open
                ? "border-brand ring-2 ring-brand/20"
                : "border-line hover:border-brand/40 focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/20"
            }`}
          >
            <span className="min-w-0 flex-1">
              <span
                className={`block truncate text-[15px] font-medium ${
                  choice ? "text-brand-deep" : "text-muted"
                }`}
              >
                {label}
              </span>
              {choice && choice !== INDUSTRY_OTHER && (
                <span className="mt-0.5 block text-[11px] text-muted">Tap to change</span>
              )}
              {choice === INDUSTRY_OTHER && (
                <span className="mt-0.5 block text-[11px] text-muted">Custom industry</span>
              )}
            </span>
            <span
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-deep/5 text-brand transition ${
                open ? "rotate-180 bg-brand/10 text-brand" : "group-hover:bg-brand/10"
              }`}
              aria-hidden
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path
                  d="M4 6l4 4 4-4"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </button>

          {/* Hidden native select for required form semantics / a11y fallback */}
          <select
            tabIndex={-1}
            aria-hidden
            required={required}
            value={choice}
            onChange={(e) => onChoiceChange(e.target.value)}
            className="pointer-events-none absolute inset-0 h-px w-px opacity-0"
          >
            <option value="" disabled>
              Select your industry
            </option>
            {list.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>

          <AnimatePresence>
            {open && (
              <motion.ul
                role="listbox"
                initial={{ opacity: 0, y: -6, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.98 }}
                transition={{ duration: 0.18, ease }}
                className="absolute z-30 mt-2 max-h-64 w-full overflow-y-auto rounded-2xl border border-line/90 bg-white p-1.5 shadow-[0_18px_50px_rgba(8,53,38,0.14)] ring-1 ring-brand-deep/5"
              >
                {list.map((opt) => {
                  const selected = choice === opt;
                  const isOther = opt === INDUSTRY_OTHER;
                  return (
                    <li key={opt} role="option" aria-selected={selected}>
                      <button
                        type="button"
                        onClick={() => {
                          onChoiceChange(opt);
                          setOpen(false);
                        }}
                        className={`flex w-full items-center justify-between gap-2 rounded-xl px-3.5 py-2.5 text-left text-sm transition ${
                          selected
                            ? "bg-brand-deep text-white"
                            : "text-brand-deep hover:bg-surface-soft"
                        }`}
                      >
                        <span className="font-medium">{opt}</span>
                        {isOther && !selected && (
                          <span className="rounded-full bg-accent/70 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent-ink">
                            Custom
                          </span>
                        )}
                        {selected && (
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                            <path
                              d="M3.5 8.5l3 3 6-6.5"
                              stroke="currentColor"
                              strokeWidth="1.8"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        )}
                      </button>
                    </li>
                  );
                })}
              </motion.ul>
            )}
          </AnimatePresence>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {showOther && (
          <motion.label
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease }}
            className="block overflow-hidden text-sm"
          >
            <span className="mb-1.5 block font-medium text-brand-deep">
              Tell us your industry <span className="text-danger">*</span>
            </span>
            <input
              value={other}
              autoFocus
              onChange={(e) => onOtherChange(e.target.value)}
              placeholder="e.g. Solar installation, Laundry service…"
              required
              className="w-full rounded-2xl border border-line bg-gradient-to-b from-white to-surface-soft/40 px-4 py-3.5 text-[15px] font-medium text-brand-deep outline-none transition placeholder:font-normal placeholder:text-muted focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
          </motion.label>
        )}
      </AnimatePresence>
    </div>
  );
}

function TagPill({
  label,
  onRemove,
  tone = "brand",
}: {
  label: string;
  onRemove: () => void;
  tone?: "brand" | "soft";
}) {
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ${
        tone === "brand"
          ? "bg-brand-deep text-white"
          : "bg-surface-soft text-brand-deep ring-1 ring-line"
      }`}
    >
      <span className="truncate">{label}</span>
      <button
        type="button"
        onClick={onRemove}
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-sm leading-none ${
          tone === "brand" ? "bg-white/15 hover:bg-white/25" : "bg-brand-deep/10 hover:bg-brand-deep/15"
        }`}
        aria-label={`Remove ${label}`}
      >
        ×
      </button>
    </span>
  );
}

function AudiencePicker({
  value,
  onChange,
  required,
}: {
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
}) {
  const selected = useMemo(() => parseTagList(value), [value]);
  const [otherText, setOtherText] = useState("");
  const [showOther, setShowOther] = useState(false);

  function setTags(next: string[]) {
    onChange(serializeTags(next));
  }

  function toggleOption(opt: string) {
    if (selected.some((t) => t.toLowerCase() === opt.toLowerCase())) {
      setTags(selected.filter((t) => t.toLowerCase() !== opt.toLowerCase()));
    } else {
      setTags([...selected, opt]);
    }
  }

  function addOther() {
    const tag = otherText.trim();
    if (!tag) return;
    setTags([...selected, tag]);
    setOtherText("");
    setShowOther(false);
  }

  const presetSet = new Set(AUDIENCE_OPTIONS.map((o) => o.toLowerCase()));
  const customSelected = selected.filter((t) => !presetSet.has(t.toLowerCase()));

  return (
    <div className="space-y-3">
      <div>
        <p className="mb-1.5 text-sm font-medium text-brand-deep">
          Target audience{required ? <span className="text-danger"> *</span> : null}
        </p>
        <p className="text-xs text-muted">Select all that fit — you can pick more than one.</p>
      </div>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-2 rounded-2xl border border-line/80 bg-white/70 p-3">
          {selected.map((tag) => (
            <TagPill
              key={tag}
              label={tag}
              onRemove={() => setTags(selected.filter((t) => t !== tag))}
            />
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {AUDIENCE_OPTIONS.map((opt) => {
          const on = selected.some((t) => t.toLowerCase() === opt.toLowerCase());
          return (
            <button
              key={opt}
              type="button"
              onClick={() => toggleOption(opt)}
              className={`rounded-full px-3.5 py-2 text-xs font-semibold transition ${
                on
                  ? "bg-brand-deep text-white shadow-sm"
                  : "border border-line bg-white text-brand-deep hover:border-brand/40 hover:bg-surface-soft"
              }`}
            >
              {opt}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setShowOther((v) => !v)}
          className={`rounded-full px-3.5 py-2 text-xs font-semibold transition ${
            showOther || customSelected.length
              ? "bg-accent text-accent-ink"
              : "border border-dashed border-brand/35 bg-accent/20 text-accent-ink hover:bg-accent/35"
          }`}
        >
          Other…
        </button>
      </div>

      <AnimatePresence initial={false}>
        {showOther && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease }}
            className="overflow-hidden"
          >
            <div className="flex flex-col gap-2 rounded-2xl border border-accent/40 bg-accent/10 p-3 sm:flex-row sm:items-center">
              <input
                value={otherText}
                onChange={(e) => setOtherText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addOther();
                  }
                }}
                placeholder="e.g. Brides in Abuja, church youth…"
                className="min-w-0 flex-1 rounded-xl border border-line bg-white px-3.5 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
              />
              <button
                type="button"
                onClick={addOther}
                disabled={!otherText.trim()}
                className="rounded-full bg-brand-deep px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-50"
              >
                Add tag
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function CompetitorTags({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const tags = useMemo(() => parseTagList(value), [value]);
  const [draft, setDraft] = useState("");

  function setTags(next: string[]) {
    onChange(serializeTags(next));
  }

  function commitDraft() {
    const pieces = parseTagList(draft);
    if (!pieces.length) return;
    setTags([...tags, ...pieces]);
    setDraft("");
  }

  return (
    <div className="space-y-2">
      <div>
        <p className="mb-1.5 text-sm font-medium text-brand-deep">Competitors</p>
        <p className="text-xs text-muted">
          Type a name and press <span className="font-semibold">comma</span> or{" "}
          <span className="font-semibold">Enter</span> to add as a tag.
        </p>
      </div>

      <div className="rounded-2xl border border-line bg-gradient-to-b from-white to-surface-soft/40 px-3 py-3 focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20">
        <div className="flex flex-wrap items-center gap-2">
          {tags.map((tag) => (
            <TagPill
              key={tag}
              label={tag}
              tone="soft"
              onRemove={() => setTags(tags.filter((t) => t !== tag))}
            />
          ))}
          <input
            value={draft}
            onChange={(e) => {
              const next = e.target.value;
              if (next.includes(",")) {
                const [head, ...rest] = next.split(",");
                const toAdd = parseTagList(head);
                const leftover = rest.join(",");
                if (toAdd.length) setTags([...tags, ...toAdd]);
                setDraft(leftover.replace(/^\s+/, ""));
                return;
              }
              setDraft(next);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitDraft();
              }
              if (e.key === "Backspace" && !draft && tags.length) {
                setTags(tags.slice(0, -1));
              }
            }}
            onBlur={() => {
              if (draft.trim()) commitDraft();
            }}
            placeholder={tags.length ? "Add another…" : "e.g. Boutique Ada, Shoprite…"}
            className="min-w-[10rem] flex-1 bg-transparent py-1.5 text-sm outline-none placeholder:text-muted"
          />
        </div>
      </div>
    </div>
  );
}

function SocialAccountsFields({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const map = useMemo(() => parseSocialsText(value), [value]);

  function setField(key: string, next: string) {
    onChange(serializeSocials({ ...map, [key]: next }));
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="mb-1.5 text-sm font-medium text-brand-deep">Social accounts</p>
        <p className="text-xs text-muted">Fill only what you use — leave the rest blank.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {SOCIAL_FIELDS.map(({ key, label, placeholder }) => (
          <label key={key} className="block text-sm">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted">
              {label}
            </span>
            <input
              value={map[key] || ""}
              onChange={(e) => setField(key, e.target.value)}
              placeholder={placeholder}
              className="w-full rounded-2xl border border-line bg-gradient-to-b from-white to-surface-soft/40 px-4 py-3 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
          </label>
        ))}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1.5 block font-medium">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className="w-full rounded-2xl border border-line bg-surface px-4 py-3 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
      />
    </label>
  );
}

function TextArea({
  label,
  value,
  onChange,
  placeholder,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1.5 block font-medium">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        rows={5}
        className="w-full resize-y rounded-2xl border border-line bg-surface px-4 py-3 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
      />
    </label>
  );
}
