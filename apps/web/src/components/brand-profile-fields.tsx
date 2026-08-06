"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

const ease = [0.22, 1, 0.36, 1] as const;

export const AUDIENCE_OPTIONS = [
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

export const SOCIAL_FIELDS = [
  { key: "instagram", label: "Instagram", placeholder: "@yourbrand" },
  { key: "tiktok", label: "TikTok", placeholder: "@yourbrand" },
  { key: "facebook", label: "Facebook", placeholder: "Page name or URL" },
  { key: "whatsapp", label: "WhatsApp", placeholder: "+234…" },
  { key: "twitter", label: "X (Twitter)", placeholder: "@yourbrand" },
  { key: "linkedin", label: "LinkedIn", placeholder: "Company or profile URL" },
  { key: "youtube", label: "YouTube", placeholder: "@channel or URL" },
  { key: "website", label: "Website", placeholder: "https://…" },
] as const;

export function uniqueTags(tags: string[]): string[] {
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

export function parseTagList(raw: string): string[] {
  if (!(raw || "").trim()) return [];
  return uniqueTags(raw.split(/[,;·|\n]+/));
}

export function serializeTags(tags: string[]): string {
  return uniqueTags(tags).join(", ");
}

export function parseSocialsMap(raw: Record<string, string> | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw || {})) {
    if (v?.trim()) out[k.toLowerCase()] = v.trim();
  }
  return out;
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

export function AudiencePicker({
  value,
  onChange,
  required,
  compact,
}: {
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  compact?: boolean;
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
        <p
          className={
            compact
              ? "text-xs font-semibold uppercase tracking-wider text-muted"
              : "mb-1.5 text-sm font-medium text-brand-deep"
          }
        >
          Target audience{required ? <span className="text-danger"> *</span> : null}
        </p>
        {!compact && (
          <p className="text-xs text-muted">Select all that fit — you can pick more than one.</p>
        )}
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
              className={`rounded-full px-3 py-1.5 text-[11px] font-semibold transition ${
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
          className={`rounded-full px-3 py-1.5 text-[11px] font-semibold transition ${
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

export function CompetitorTags({
  value,
  onChange,
  compact,
}: {
  value: string;
  onChange: (v: string) => void;
  compact?: boolean;
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
        <p
          className={
            compact
              ? "text-xs font-semibold uppercase tracking-wider text-muted"
              : "mb-1.5 text-sm font-medium text-brand-deep"
          }
        >
          Competitors
        </p>
        {!compact && (
          <p className="text-xs text-muted">
            Type a name and press <span className="font-semibold">comma</span> or{" "}
            <span className="font-semibold">Enter</span> to add as a tag.
          </p>
        )}
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

export function SocialAccountsFields({
  value,
  onChange,
  compact,
}: {
  value: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
  compact?: boolean;
}) {
  function setField(key: string, next: string) {
    const copy = { ...value };
    if (next.trim()) copy[key] = next;
    else delete copy[key];
    onChange(copy);
  }

  return (
    <div className="space-y-3">
      <div>
        <p
          className={
            compact
              ? "text-xs font-semibold uppercase tracking-wider text-muted"
              : "mb-1.5 text-sm font-medium text-brand-deep"
          }
        >
          Social accounts
        </p>
        {!compact && (
          <p className="text-xs text-muted">Fill only what you use — leave the rest blank.</p>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {SOCIAL_FIELDS.map(({ key, label, placeholder }) => (
          <label key={key} className="block text-sm">
            <span
              className={
                compact
                  ? "mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted"
                  : "mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted"
              }
            >
              {label}
            </span>
            <input
              value={value[key] || ""}
              onChange={(e) => setField(key, e.target.value)}
              placeholder={placeholder}
              className="w-full rounded-xl border border-line bg-white px-3 py-2.5 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
          </label>
        ))}
      </div>
    </div>
  );
}
