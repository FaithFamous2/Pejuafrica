"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { api, type GenerationBrief } from "@/lib/api";
import { useStudioModal } from "@/hooks/use-studio-modal";

type Option = { id: string; label: string; hint: string };

export type PlanSchedule = { month: number; year: number };

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const emptyBrief = (): GenerationBrief => ({
  tone_id: "brand_default",
  occasion_id: "always_on",
  custom_tone: "",
  custom_occasion: "",
  focus: "",
  extra_notes: "",
  platform_override: "",
});

function currentSchedule(): PlanSchedule {
  const now = new Date();
  return { month: now.getMonth() + 1, year: now.getFullYear() };
}

export function GenerationBriefModal({
  open,
  mode,
  tenantId,
  title,
  subtitle,
  confirmLabel,
  busy,
  onClose,
  onConfirm,
}: {
  open: boolean;
  mode: "month" | "day";
  tenantId: string;
  title: string;
  subtitle: string;
  confirmLabel: string;
  busy?: boolean;
  onClose: () => void;
  onConfirm: (brief: GenerationBrief, schedule?: PlanSchedule) => void;
}) {
  const [tones, setTones] = useState<Option[]>([]);
  const [occasions, setOccasions] = useState<Option[]>([]);
  const [brief, setBrief] = useState<GenerationBrief>(emptyBrief());
  const [assisting, setAssisting] = useState(false);
  const [rough, setRough] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [schedule, setSchedule] = useState<PlanSchedule>(currentSchedule);
  useStudioModal(open);

  const yearOptions = useMemo(() => {
    const y = new Date().getFullYear();
    // Always present year + 4 ahead (5 selectable years). Rolls forward every year.
    return [y, y + 1, y + 2, y + 3, y + 4];
  }, []);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    setBrief(emptyBrief());
    setRough("");
    setError(null);
    setSchedule(currentSchedule());
    api
      .generationOptions(tenantId)
      .then((res) => {
        setTones(res.tones);
        setOccasions(res.occasions);
      })
      .catch(() => {
        setTones([
          { id: "brand_default", label: "Brand default", hint: "Use onboarding voice" },
          { id: "custom", label: "Custom tone", hint: "Paste your own" },
        ]);
        setOccasions([
          { id: "always_on", label: "Always-on brand", hint: "Normal rhythm" },
          { id: "custom", label: "Custom occasion", hint: "Describe your moment" },
        ]);
      });
  }, [open, tenantId]);

  async function assist() {
    setAssisting(true);
    setError(null);
    try {
      const res = await api.assistBrief(tenantId, {
        rough_notes: rough || brief.focus || "",
        scope: mode,
      });
      setBrief((b) => ({
        ...b,
        focus: res.focus || b.focus,
        tone_id: res.tone_suggestion || b.tone_id,
        occasion_id: res.occasion_suggestion || b.occasion_id,
        extra_notes: res.extra_notes || res.polished_brief || b.extra_notes,
      }));
      setRough(res.polished_brief || rough);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Assist failed");
    } finally {
      setAssisting(false);
    }
  }

  function cleanedBrief(): GenerationBrief {
    return {
      tone_id: brief.tone_id || "brand_default",
      occasion_id: brief.occasion_id || "always_on",
      custom_tone: brief.tone_id === "custom" ? brief.custom_tone || undefined : undefined,
      custom_occasion:
        brief.occasion_id === "custom" ? brief.custom_occasion || undefined : undefined,
      focus: brief.focus?.trim() || undefined,
      extra_notes: brief.extra_notes?.trim() || undefined,
      platform_override: brief.platform_override?.trim() || undefined,
    };
  }

  function submit() {
    onConfirm(cleanedBrief(), mode === "month" ? schedule : undefined);
  }

  function skipDefaults() {
    onConfirm({}, mode === "month" ? schedule : undefined);
  }

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[200] flex items-end justify-center sm:items-center sm:p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <button
            type="button"
            aria-label="Close"
            className="absolute inset-0 bg-brand-deep/45 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            className="relative z-10 flex w-full max-w-2xl flex-col overflow-hidden rounded-t-[1.75rem] border border-line bg-surface shadow-2xl sm:rounded-[1.75rem]"
            style={{
              maxHeight: "calc(100dvh - env(safe-area-inset-bottom, 0px) - 0.5rem)",
              height: "min(90dvh, calc(100dvh - env(safe-area-inset-bottom, 0px) - 0.5rem))",
            }}
          >
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-7 sm:py-7 [-webkit-overflow-scrolling:touch]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-brand">
                    Creative brief
                  </p>
                  <h2 className="font-display mt-1 text-2xl font-bold text-brand-deep">{title}</h2>
                  <p className="mt-1 text-sm text-muted">{subtitle}</p>
                </div>
                <button type="button" onClick={onClose} className="shrink-0 text-sm text-muted">
                  Close
                </button>
              </div>

              {mode === "month" && (
                <div className="mt-5 rounded-2xl border border-brand/20 bg-brand/[0.04] p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                    Plan for which month?
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    Pick any month in the year — Peju will build the calendar for that period.
                  </p>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {yearOptions.map((y) => (
                      <button
                        key={y}
                        type="button"
                        onClick={() => setSchedule((s) => ({ ...s, year: y }))}
                        className={`rounded-full px-3.5 py-1.5 text-xs font-bold ${
                          schedule.year === y
                            ? "bg-brand-deep text-white"
                            : "border border-line bg-white text-brand-deep"
                        }`}
                      >
                        {y}
                      </button>
                    ))}
                  </div>

                  <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {MONTHS.map((label, i) => {
                      const m = i + 1;
                      const active = schedule.month === m;
                      return (
                        <button
                          key={label}
                          type="button"
                          onClick={() => setSchedule((s) => ({ ...s, month: m }))}
                          className={`rounded-xl border px-2 py-2.5 text-center transition ${
                            active
                              ? "border-brand-deep bg-brand-deep text-white"
                              : "border-line bg-white text-brand-deep hover:border-brand/40"
                          }`}
                        >
                          <p className="text-xs font-bold sm:text-sm">{label.slice(0, 3)}</p>
                          <p
                            className={`mt-0.5 hidden text-[10px] sm:block ${
                              active ? "text-white/70" : "text-muted"
                            }`}
                          >
                            {label}
                          </p>
                        </button>
                      );
                    })}
                  </div>

                  <p className="mt-3 text-sm font-semibold text-brand-deep">
                    Generating for {MONTHS[schedule.month - 1]} {schedule.year}
                  </p>
                </div>
              )}

              <p className="mt-4 rounded-2xl border border-accent/30 bg-accent/15 px-4 py-3 text-xs text-accent-ink">
                Leave fields empty to regenerate from brand defaults. Fill tone, occasion, or focus
                when you want this run tailored.
              </p>

              <div className="mt-5 space-y-4">
                <FieldLabel label="Tone">
                  <div className="grid gap-2 sm:grid-cols-2">
                    {tones.map((t) => (
                      <Chip
                        key={t.id}
                        active={brief.tone_id === t.id}
                        title={t.label}
                        hint={t.hint}
                        onClick={() => setBrief((b) => ({ ...b, tone_id: t.id }))}
                      />
                    ))}
                  </div>
                  {brief.tone_id === "custom" && (
                    <textarea
                      value={brief.custom_tone || ""}
                      onChange={(e) => setBrief((b) => ({ ...b, custom_tone: e.target.value }))}
                      rows={3}
                      placeholder="e.g. Soft-spoken Lagos auntie energy — warm, practical, never pushy"
                      className="mt-2 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm outline-none focus:border-brand"
                    />
                  )}
                </FieldLabel>

                <FieldLabel label="Occasion / campaign moment">
                  <div className="grid gap-2 sm:grid-cols-2">
                    {occasions.map((o) => (
                      <Chip
                        key={o.id}
                        active={brief.occasion_id === o.id}
                        title={o.label}
                        hint={o.hint}
                        onClick={() => setBrief((b) => ({ ...b, occasion_id: o.id }))}
                      />
                    ))}
                  </div>
                  {brief.occasion_id === "custom" && (
                    <input
                      value={brief.custom_occasion || ""}
                      onChange={(e) =>
                        setBrief((b) => ({ ...b, custom_occasion: e.target.value }))
                      }
                      placeholder="e.g. 3-year anniversary with free consult week"
                      className="mt-2 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm outline-none focus:border-brand"
                    />
                  )}
                </FieldLabel>

                <FieldLabel label="What should this be about? (optional)">
                  <textarea
                    value={brief.focus || ""}
                    onChange={(e) => setBrief((b) => ({ ...b, focus: e.target.value }))}
                    rows={3}
                    placeholder={
                      mode === "month"
                        ? "e.g. Push our new skincare bundle to busy moms in Abuja, focus on WhatsApp orders"
                        : "e.g. Highlight yesterday’s 5-star review and invite walk-ins this weekend"
                    }
                    className="w-full rounded-xl border border-line bg-white px-3 py-2 text-sm outline-none focus:border-brand"
                  />
                </FieldLabel>

                <FieldLabel label="Extra creative notes (optional)">
                  <textarea
                    value={brief.extra_notes || ""}
                    onChange={(e) => setBrief((b) => ({ ...b, extra_notes: e.target.value }))}
                    rows={2}
                    placeholder="Hashtags to avoid, offer details, competitor angle, etc."
                    className="w-full rounded-xl border border-line bg-white px-3 py-2 text-sm outline-none focus:border-brand"
                  />
                </FieldLabel>

                {mode === "day" && (
                  <FieldLabel label="Platform override (optional)">
                    <select
                      value={brief.platform_override || ""}
                      onChange={(e) =>
                        setBrief((b) => ({ ...b, platform_override: e.target.value }))
                      }
                      className="w-full rounded-xl border border-line bg-white px-3 py-2 text-sm outline-none focus:border-brand"
                    >
                      <option value="">Keep current / AI choice</option>
                      <option value="instagram">Instagram</option>
                      <option value="whatsapp">WhatsApp</option>
                      <option value="facebook">Facebook</option>
                      <option value="tiktok">TikTok</option>
                    </select>
                  </FieldLabel>
                )}

                <div className="rounded-2xl border border-dashed border-line bg-surface-soft/50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                    AI can redraft your brief
                  </p>
                  <textarea
                    value={rough}
                    onChange={(e) => setRough(e.target.value)}
                    rows={2}
                    placeholder="Paste messy notes — Peju will tighten them into a usable brief"
                    className="mt-2 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm outline-none focus:border-brand"
                  />
                  <button
                    type="button"
                    disabled={assisting || busy}
                    onClick={assist}
                    className="mt-2 rounded-full border border-brand/30 bg-accent/40 px-4 py-2 text-xs font-bold text-accent-ink disabled:opacity-50"
                  >
                    {assisting ? "Redrafting…" : "Help me write the brief"}
                  </button>
                </div>

                {error && <p className="text-sm text-danger">{error}</p>}
              </div>
            </div>

            <div
              className="shrink-0 space-y-2 border-t border-line bg-surface px-5 pt-3 sm:flex sm:flex-row sm:gap-2 sm:space-y-0 sm:px-7"
              style={{
                paddingBottom: "max(0.85rem, env(safe-area-inset-bottom, 0px))",
              }}
            >
              <button
                type="button"
                disabled={busy}
                onClick={submit}
                className="w-full rounded-full bg-brand-deep py-3.5 text-sm font-semibold text-white disabled:opacity-50 sm:flex-1"
              >
                {busy
                  ? "Working…"
                  : mode === "month"
                    ? `${confirmLabel} · ${MONTHS[schedule.month - 1].slice(0, 3)} ${schedule.year}`
                    : confirmLabel}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={skipDefaults}
                className="w-full rounded-full border border-line px-4 py-3 text-sm font-medium text-muted disabled:opacity-50 sm:w-auto"
              >
                Skip — use brand defaults
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

function FieldLabel({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">{label}</p>
      {children}
    </div>
  );
}

function Chip({
  active,
  title,
  hint,
  onClick,
}: {
  active: boolean;
  title: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border px-3 py-2.5 text-left transition ${
        active
          ? "border-brand-deep bg-brand-deep text-white"
          : "border-line bg-white hover:border-brand/40"
      }`}
    >
      <p className="text-sm font-semibold">{title}</p>
      <p className={`mt-0.5 text-[11px] ${active ? "text-white/70" : "text-muted"}`}>{hint}</p>
    </button>
  );
}
