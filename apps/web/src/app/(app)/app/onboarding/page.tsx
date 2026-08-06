"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { api } from "@/lib/api";
import { BrandLogo } from "@/components/brand-logo";

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

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [booting, setBooting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assistBusy, setAssistBusy] = useState(false);
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
            socials: profile.socials
              ? Object.entries(profile.socials)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join("\n")
              : "",
            goals: profile.goals || "",
          });
          if (profile.onboarding_completed && profile.memory_initialized) {
            router.replace("/app");
          }
        } catch {
          /* new tenant may not have profile yet */
        }
      })
      .catch(() => router.replace("/login"));
  }, [router]);

  const progress = useMemo(() => ((step + 1) / STEPS.length) * 100, [step]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function helpWithStep() {
    const tenantId = localStorage.getItem("peju_tenant_id");
    if (!tenantId) return;
    setAssistBusy(true);
    setError(null);
    try {
      const stepKey = STEPS[step].key;
      const res = await api.assistOnboardingStep(tenantId, {
        step: stepKey,
        business_name: form.business_name,
        industry: form.industry,
        brand_voice: form.brand_voice,
        target_audience: form.target_audience,
        competitors: form.competitors,
        socials: form.socials,
        goals: form.goals,
      });
      const s = res.suggestions || {};
      setForm((prev) => ({
        ...prev,
        industry: s.industry || prev.industry,
        brand_voice: s.brand_voice || prev.brand_voice,
        target_audience: s.target_audience || prev.target_audience,
        competitors: s.competitors || prev.competitors,
        goals: s.goals || prev.goals,
        socials: s.socials || prev.socials,
      }));
      setHelperText(res.helper_text || "Suggestions applied — edit anything that doesn’t feel right.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI assist failed");
    } finally {
      setAssistBusy(false);
    }
  }

  async function saveProfile(initializeMemory = false) {
    const tenantId = localStorage.getItem("peju_tenant_id");
    if (!tenantId) throw new Error("Missing tenant context");

    const socials: Record<string, string> = {};
    form.socials
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .forEach((line) => {
        const [k, ...rest] = line.split(":");
        if (k && rest.length) socials[k.trim().toLowerCase()] = rest.join(":").trim();
      });

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
      if (step === STEPS.length - 2) {
        setLoading(true);
        try {
          await saveProfile(false);
          setStep((s) => s + 1);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Could not save profile");
        } finally {
          setLoading(false);
        }
        return;
      }
      setStep((s) => s + 1);
      return;
    }

    setBooting(true);
    setLoading(true);
    try {
      await saveProfile(true);
      await new Promise((r) => setTimeout(r, 1400));
      router.push("/app");
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

            {step < STEPS.length - 1 ? (
              <div className="mt-5 flex flex-wrap items-center gap-3 rounded-2xl border border-accent/35 bg-accent/15 px-4 py-3">
                <p className="flex-1 text-sm text-accent-ink">
                  Not sure what to write? Peju can draft this step for you.
                </p>
                <button
                  type="button"
                  disabled={assistBusy || loading}
                  onClick={helpWithStep}
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
                  onClick={helpWithStep}
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
                  <Field
                    label="Industry"
                    value={form.industry}
                    onChange={(v) => update("industry", v)}
                    placeholder="Fashion boutique, Restaurant, Clinic…"
                    required
                  />
                </>
              )}
              {step === 1 && (
                <TextArea
                  label="Brand voice"
                  value={form.brand_voice}
                  onChange={(v) => update("brand_voice", v)}
                  placeholder="Warm, confident, local slang-friendly… Describe tone, words to use/avoid."
                  required
                />
              )}
              {step === 2 && (
                <>
                  <TextArea
                    label="Target audience"
                    value={form.target_audience}
                    onChange={(v) => update("target_audience", v)}
                    placeholder="Young professionals in Lagos, families near Yaba, etc."
                    required
                  />
                  <Field
                    label="Competitors (comma-separated)"
                    value={form.competitors}
                    onChange={(v) => update("competitors", v)}
                    placeholder="Brand A, Brand B"
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
                  <TextArea
                    label="Social accounts"
                    value={form.socials}
                    onChange={(v) => update("socials", v)}
                    placeholder={"instagram: @yourbrand\nwhatsapp: +234…\nfacebook: …"}
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
