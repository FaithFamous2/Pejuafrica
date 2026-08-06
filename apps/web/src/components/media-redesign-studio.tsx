"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { api, type MediaAsset } from "@/lib/api";
import { useStudioModal } from "@/hooks/use-studio-modal";

type ChatItem =
  | { id: string; kind: "system"; text: string }
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "assistant"; text: string; asset?: MediaAsset };

type IntentSuggestion = { id: string; label: string; prompt: string };

const DEFAULT_SUGGESTIONS: IntentSuggestion[] = [
  {
    id: "flyer",
    label: "Make a flyer",
    prompt: "Turn this into a bold marketing flyer for a product promo with a clear headline and CTA",
  },
  {
    id: "flyer_sale",
    label: "Sale flyer",
    prompt: "Make a sale flyer from this image for a weekend discount promo",
  },
  {
    id: "flyer_launch",
    label: "Launch flyer",
    prompt: "Make a grand opening / launch flyer from this image",
  },
  {
    id: "graphic",
    label: "Graphic design",
    prompt: "Convert this into a clean social graphic design poster",
  },
  {
    id: "enhance",
    label: "Enhance quality",
    prompt: "Enhance this image — sharper, richer color, keep the same subject",
  },
  {
    id: "colorful",
    label: "More colorful",
    prompt: "Make this more colorful and vibrant while keeping the same subject",
  },
  {
    id: "bw",
    label: "Black & white",
    prompt: "Convert this to a premium black and white look, keep the same subject",
  },
  {
    id: "background",
    label: "Change background",
    prompt: "Keep the main subject and change the background to a clean studio backdrop",
  },
];

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function detectClientIntent(text: string): string | undefined {
  const t = text.toLowerCase();
  if (/\bflyer|flyers|sale flyer|launch flyer\b/.test(t)) return "flyer";
  if (/\bgraphic|poster|design\b/.test(t)) return "graphic";
  if (/\bblack\s*and\s*white|b\s*&\s*w|grayscale|monochrome\b/.test(t)) return "bw";
  if (/\bbackground|backdrop\b/.test(t)) return "background";
  if (/\bcolorful|colourful|vibrant|saturat\b/.test(t)) return "recolor";
  if (/\benhance|improve|sharpen|better quality\b/.test(t)) return "enhance";
  return undefined;
}

export function MediaRedesignStudio({
  tenantId,
  asset,
  open,
  onClose,
  onCreated,
}: {
  tenantId: string;
  asset: MediaAsset | null;
  open: boolean;
  onClose: () => void;
  onCreated: (asset: MediaAsset, mode: string) => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [working, setWorking] = useState<MediaAsset | null>(null);
  const [prompt, setPrompt] = useState("");
  const [chat, setChat] = useState<ChatItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [suggestBusy, setSuggestBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<IntentSuggestion[]>(DEFAULT_SUGGESTIONS);
  const [activeIntent, setActiveIntent] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useStudioModal(open);

  const isUpload = working?.source === "upload";
  const mode = isUpload ? "fork" : "iterate";

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open || !asset) return;
    setWorking(asset);
    setPrompt("");
    setError(null);
    setProgress(0);
    setBusy(false);
    setSuggestBusy(false);
    setPreviewOpen(false);
    setActiveIntent(null);
    setSuggestions(DEFAULT_SUGGESTIONS);
    const upload = asset.source === "upload";
    setChat([
      {
        id: uid(),
        kind: "system",
        text: upload
          ? "We’ll analyse THIS image first, then transform it (flyer for an occasion, enhance, background…). Your original stays safe."
          : "We analyse the working image before each step — flyer (sale/launch/etc.), graphic, enhance, recolor, or new background. Text on flyers is proofread.",
      },
    ]);
    // Soft-focus input after open (desktop)
    window.setTimeout(() => {
      if (window.matchMedia("(min-width: 640px)").matches) {
        inputRef.current?.focus();
      }
    }, 280);
  }, [open, asset?.id]);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [chat, busy, progress]);

  async function improvePrompt() {
    if (!working) return;
    setSuggestBusy(true);
    setError(null);
    const hadNotes = Boolean(prompt.trim());
    try {
      const res = await api.suggestMediaRedesignPrompt(tenantId, working.id, {
        notes: prompt.trim() || undefined,
      });
      setPrompt(res.prompt);
      if (res.suggestions?.length) setSuggestions(res.suggestions);
      if (res.intent) setActiveIntent(res.intent);
      setChat((prev) => [
        ...prev,
        {
          id: uid(),
          kind: "assistant",
          text:
            res.message ||
            (hadNotes
              ? "Enhanced your prompt — edit if needed, then redesign."
              : "Draft prompt ready — edit it, then redesign."),
        },
      ]);
      inputRef.current?.focus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not improve prompt");
    } finally {
      setSuggestBusy(false);
    }
  }

  async function runRedesign() {
    if (!working || !prompt.trim()) {
      setError("Add a prompt describing what to redesign.");
      return;
    }
    setBusy(true);
    setError(null);
    setProgress(12);
    const userText = prompt.trim();
    setChat((prev) => [...prev, { id: uid(), kind: "user", text: userText }]);
    setPrompt("");

    const chatNotes = chat
      .filter((c): c is Extract<ChatItem, { kind: "user" }> => c.kind === "user")
      .slice(-4)
      .map((c) => c.text)
      .join("\n");

    const tick = window.setInterval(() => {
      setProgress((p) => Math.min(88, p + 6));
    }, 700);

    try {
      const intent = activeIntent || detectClientIntent(userText);
      const res = await api.redesignMedia(tenantId, working.id, {
        prompt: userText,
        chat_notes: chatNotes || undefined,
        intent,
      });
      setProgress(100);
      setWorking(res.asset);
      const overlayNote =
        res.overlay?.headline
          ? ` Text on image: “${res.overlay.headline}”${res.overlay.cta ? ` · ${res.overlay.cta}` : ""} (spell-checked).`
          : "";
      setChat((prev) => [
        ...prev,
        {
          id: uid(),
          kind: "assistant",
          text: [res.message, overlayNote].filter(Boolean).join(" "),
          asset: res.asset,
        },
      ]);
      if (res.intent) setActiveIntent(res.intent);
      onCreated(res.asset, res.mode);
    } catch (err) {
      setProgress(0);
      const msg = err instanceof Error ? err.message : "Redesign failed";
      setError(msg);
      setChat((prev) => [
        ...prev,
        { id: uid(), kind: "assistant", text: `Couldn’t redesign: ${msg}` },
      ]);
    } finally {
      window.clearInterval(tick);
      setBusy(false);
      window.setTimeout(() => setProgress(0), 600);
    }
  }

  if (!mounted || !working) return null;

  const redesignLabel = busy
    ? "Working…"
    : isUpload
      ? "Transform (keep original)"
      : "Transform image";

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[210] flex items-stretch justify-center sm:items-center sm:p-4 md:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <button
            type="button"
            aria-label="Close"
            className="absolute inset-0 bg-brand-deep/55 backdrop-blur-sm"
            onClick={() => {
              if (!busy) onClose();
            }}
          />

          <motion.div
            initial={{ opacity: 0, y: 32 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 18 }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
            className="relative z-10 flex h-[100dvh] w-full flex-col overflow-hidden border-line bg-surface shadow-2xl sm:h-auto sm:max-h-[min(900px,calc(100dvh-2rem))] sm:max-w-5xl sm:rounded-[1.5rem] sm:border lg:max-w-6xl"
            style={{
              paddingTop: "env(safe-area-inset-top, 0px)",
            }}
          >
            {/* Header */}
            <header className="shrink-0 border-b border-line px-4 py-3 sm:px-5 sm:py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-brand">
                      AI redesign
                    </p>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        mode === "fork"
                          ? "bg-accent/40 text-accent-ink"
                          : "bg-brand/15 text-brand"
                      }`}
                    >
                      {mode === "fork" ? "Keeps original" : "New AI version"}
                    </span>
                  </div>
                  <h3 className="font-display mt-1 truncate text-lg font-bold text-brand-deep sm:text-xl">
                    {working.title || working.filename || "Media"}
                  </h3>
                  <p className="mt-0.5 hidden text-xs text-muted sm:block">
                    Transforms THIS image — flyer, graphic, enhance, recolor, or new background.
                    On-image text is spell-checked by Neural Fabric.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={onClose}
                  className="shrink-0 rounded-full border border-line px-3.5 py-1.5 text-xs font-semibold text-brand-deep disabled:opacity-50"
                >
                  Close
                </button>
              </div>
            </header>

            {/* Body: mobile stack · desktop split */}
            <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,0.95fr)_minmax(0,1.15fr)]">
              {/* Preview pane */}
              <aside className="relative shrink-0 border-b border-line bg-[linear-gradient(160deg,#f4f7f5_0%,#e8efeb_100%)] md:border-b-0 md:border-r md:border-line">
                {/* Mobile compact strip */}
                <div className="flex items-center gap-3 px-4 py-3 md:hidden">
                  <button
                    type="button"
                    onClick={() => setPreviewOpen(true)}
                    className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-line bg-white shadow-sm"
                    aria-label="Enlarge preview"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={working.url}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                      Working image
                    </p>
                    <p className="mt-0.5 truncate text-sm font-semibold text-brand-deep">
                      {working.title || working.filename || "Current version"}
                    </p>
                    <button
                      type="button"
                      onClick={() => setPreviewOpen(true)}
                      className="mt-1 text-[11px] font-semibold text-brand"
                    >
                      Tap to enlarge
                    </button>
                  </div>
                </div>

                {/* Desktop / tablet large preview */}
                <div className="hidden h-full min-h-[280px] flex-col items-center justify-center gap-3 p-5 md:flex lg:p-7">
                  <div className="relative flex max-h-full w-full flex-1 items-center justify-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={working.url}
                      alt={working.title || "Working image"}
                      className="max-h-[min(62vh,560px)] w-auto max-w-full rounded-2xl object-contain shadow-[0_16px_40px_rgba(8,53,38,0.14)] ring-1 ring-black/5"
                    />
                  </div>
                  <p className="text-center text-[11px] text-muted">
                    Latest version shown here · results also appear in the chat
                  </p>
                </div>
              </aside>

              {/* Chat + composer */}
              <section className="flex min-h-0 flex-1 flex-col bg-surface">
                <div
                  ref={scrollRef}
                  className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-3 py-3 [-webkit-overflow-scrolling:touch] sm:px-4 sm:py-4"
                >
                  {chat.map((item) => (
                    <div
                      key={item.id}
                      className={`flex ${
                        item.kind === "user" ? "justify-end" : "justify-start"
                      }`}
                    >
                      <div
                        className={`max-w-[92%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed sm:max-w-[85%] sm:text-sm ${
                          item.kind === "user"
                            ? "rounded-br-md bg-brand-deep text-white"
                            : item.kind === "system"
                              ? "w-full max-w-none border border-brand/20 bg-brand/[0.06] text-brand-deep"
                              : "rounded-bl-md bg-surface-soft text-foreground ring-1 ring-line/70"
                        }`}
                      >
                        <p className="whitespace-pre-wrap">{item.text}</p>
                        {item.kind === "assistant" && item.asset && (
                          <button
                            type="button"
                            onClick={() => {
                              setWorking(item.asset!);
                              setPreviewOpen(true);
                            }}
                            className="mt-2.5 block w-full overflow-hidden rounded-xl border border-line/80 bg-white text-left transition hover:border-brand/40"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={item.asset.url}
                              alt="Redesign result"
                              className="aspect-square w-full max-h-48 object-cover sm:max-h-56"
                            />
                            <span className="block px-2.5 py-1.5 text-[11px] font-semibold text-brand">
                              Use this version · tap to preview
                            </span>
                          </button>
                        )}
                      </div>
                    </div>
                  ))}

                  {busy && (
                    <div className="rounded-2xl border border-brand/20 bg-brand/5 px-3.5 py-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-brand-deep">
                          Image Fabric redesigning…
                        </p>
                        <span className="text-[11px] font-semibold tabular-nums text-brand">
                          {Math.round(progress)}%
                        </span>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-soft">
                        <motion.div
                          className="h-full rounded-full bg-brand"
                          animate={{ width: `${progress}%` }}
                          transition={{ duration: 0.35 }}
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Composer — sticky bottom, keyboard-safe */}
                <div
                  className="shrink-0 border-t border-line bg-surface px-3 pt-3 sm:px-4"
                  style={{
                    paddingBottom:
                      "max(0.85rem, calc(env(safe-area-inset-bottom, 0px) + 0.35rem))",
                  }}
                >
                  {error && (
                    <p className="mb-2 rounded-xl bg-danger/10 px-3 py-2 text-xs text-danger">
                      {error}
                    </p>
                  )}

                  <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
                    What do you want to do?
                  </label>
                  <div className="mb-2.5 flex gap-1.5 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch] sm:flex-wrap sm:overflow-visible">
                    {suggestions.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          const mapped =
                            s.id === "colorful"
                              ? "recolor"
                              : s.id.startsWith("flyer")
                                ? "flyer"
                                : s.id;
                          setActiveIntent(mapped);
                          setPrompt(s.prompt);
                          inputRef.current?.focus();
                        }}
                        className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-semibold transition ${
                          activeIntent === s.id ||
                          (s.id.startsWith("flyer") && activeIntent === "flyer") ||
                          (s.id === "colorful" && activeIntent === "recolor")
                            ? "bg-brand-deep text-white"
                            : "border border-line bg-white text-muted hover:border-brand/40 hover:text-brand"
                        }`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>

                  <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
                    Your prompt
                  </label>
                  <textarea
                    ref={inputRef}
                    value={prompt}
                    onChange={(e) => {
                      setPrompt(e.target.value);
                      const detected = detectClientIntent(e.target.value);
                      if (detected) setActiveIntent(detected);
                    }}
                    rows={3}
                    disabled={busy}
                    placeholder="e.g. Make a flyer from this photo with headline Shop Lagos Fresh…"
                    className="w-full resize-none rounded-2xl border border-line bg-white px-3.5 py-3 text-sm leading-relaxed outline-none ring-brand/25 placeholder:text-muted/70 focus:border-brand focus:ring-2 disabled:opacity-60"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !busy) {
                        e.preventDefault();
                        runRedesign();
                      }
                    }}
                  />

                  <div className="mt-2.5 flex flex-col gap-2 sm:flex-row sm:items-center">
                    <button
                      type="button"
                      disabled={busy || suggestBusy}
                      onClick={improvePrompt}
                      className="order-2 rounded-full border border-brand/30 bg-brand/10 px-4 py-2.5 text-xs font-semibold text-brand disabled:opacity-50 sm:order-1"
                    >
                      {suggestBusy
                        ? "Working…"
                        : prompt.trim()
                          ? "Enhance my prompt"
                          : "Draft a prompt for me"}
                    </button>
                    <button
                      type="button"
                      disabled={busy || !prompt.trim()}
                      onClick={runRedesign}
                      className="order-1 w-full rounded-full bg-brand-deep py-3 text-sm font-semibold text-white disabled:opacity-50 sm:order-2 sm:ml-auto sm:w-auto sm:px-6 sm:py-2.5 sm:text-xs"
                    >
                      <span className="sm:hidden">
                        {busy
                          ? "Working…"
                          : isUpload
                            ? "Transform image (keep original)"
                            : "Transform this image"}
                      </span>
                      <span className="hidden sm:inline">{redesignLabel}</span>
                    </button>
                  </div>
                  <p className="mt-2 text-[10px] text-muted">
                    We edit your working image — not invent a random new scene.{" "}
                    <span className="hidden sm:inline">⌘/Ctrl + Enter to send.</span>
                  </p>
                </div>
              </section>
            </div>
          </motion.div>

          {/* Mobile full-screen image preview */}
          <AnimatePresence>
            {previewOpen && (
              <motion.div
                className="fixed inset-0 z-[220] flex flex-col bg-[#041c14]/95 md:hidden"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <div
                  className="flex items-center justify-between gap-3 px-4 py-3"
                  style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
                >
                  <p className="truncate text-sm font-semibold text-white">
                    {working.title || "Preview"}
                  </p>
                  <button
                    type="button"
                    onClick={() => setPreviewOpen(false)}
                    className="rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs font-semibold text-white"
                  >
                    Done
                  </button>
                </div>
                <div className="flex min-h-0 flex-1 items-center justify-center px-3 pb-6">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={working.url}
                    alt=""
                    className="max-h-full max-w-full rounded-2xl object-contain"
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
