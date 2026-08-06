"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { api, type ContentPost, type MediaAsset } from "@/lib/api";
import { useStudioModal } from "@/hooks/use-studio-modal";

type Tab = "ai" | "upload" | "library";
type ImageSource = "none" | "logo" | "library";

type GraphicTemplate = {
  id: string;
  name: string;
  category: string;
  hint: string;
  preview: { bg: string; accent: string; mid: string };
  supports_image: boolean;
};

const AI_STAGES = [
  { pct: 8, label: "Neural Fabric writing on-image copy…" },
  { pct: 22, label: "Planning slides for this post…" },
  { pct: 40, label: "Image agent painting backgrounds (no text)…" },
  { pct: 58, label: "Composing perfect text onto graphics…" },
  { pct: 76, label: "Uploading to media library…" },
  { pct: 90, label: "Selecting all slides on this post…" },
  { pct: 97, label: "Attaching to this post…" },
];

export function PostMediaPicker({
  tenantId,
  post,
  open,
  onClose,
  onUpdated,
}: {
  tenantId: string;
  post: ContentPost;
  open: boolean;
  onClose: () => void;
  onUpdated: (post: ContentPost) => void;
}) {
  const [tab, setTab] = useState<Tab>("ai");
  const [library, setLibrary] = useState<MediaAsset[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [count, setCount] = useState<number | "auto">("auto");
  const [replace, setReplace] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "upload" | "ai_generated">("all");
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [designNotes, setDesignNotes] = useState<string[]>([]);
  const [templates, setTemplates] = useState<GraphicTemplate[]>([]);
  const [selectedTemplates, setSelectedTemplates] = useState<string[]>([]);
  const [imageSource, setImageSource] = useState<ImageSource>("none");
  const [embedMediaId, setEmbedMediaId] = useState<string | null>(null);
  const [onImageText, setOnImageText] = useState("");
  const [imagePrompt, setImagePrompt] = useState("");
  const [suggestBusy, setSuggestBusy] = useState<"text" | "image" | "both" | null>(null);
  const stageTimer = useRef<number | null>(null);
  const [mounted, setMounted] = useState(false);
  useStudioModal(open);

  useEffect(() => {
    setMounted(true);
  }, []);

  const loadLibrary = useCallback(async () => {
    const source = filter === "all" ? undefined : filter;
    setLibrary(await api.listMedia(tenantId, source));
  }, [tenantId, filter]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSelectedIds([]);
    setProgress(0);
    setProgressLabel("");
    setDesignNotes([]);
    setSelectedTemplates([]);
    setImageSource("none");
    setEmbedMediaId(null);
    setOnImageText("");
    setImagePrompt("");
    setSuggestBusy(null);
    loadLibrary().catch(() => setLibrary([]));
    api
      .graphicTemplates(tenantId)
      .then((res) => setTemplates(res.templates || []))
      .catch(() => setTemplates([]));
  }, [open, loadLibrary, tenantId]);

  useEffect(() => {
    return () => {
      if (stageTimer.current) window.clearInterval(stageTimer.current);
    };
  }, []);

  function toggleTemplate(id: string) {
    setSelectedTemplates((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 5) return prev;
      return [...prev, id];
    });
  }

  function startAiProgress() {
    let i = 0;
    const names = selectedTemplates
      .map((id) => templates.find((t) => t.id === id)?.name)
      .filter(Boolean);
    setProgress(AI_STAGES[0].pct);
    setProgressLabel(AI_STAGES[0].label);
    setDesignNotes([
      `Theme: ${post.theme}`,
      names.length ? `Designs: ${names.join(", ")}` : "Designs: rotating style pack",
      count === "auto" ? "Slide count: AI decides (1–5)" : `Slide count: ${count}`,
      imageSource === "logo"
        ? "Image: business logo"
        : imageSource === "library"
          ? "Image: library media"
          : "Image: none",
      onImageText.trim()
        ? `On-image text: ${onImageText.trim().slice(0, 80)}${onImageText.trim().length > 80 ? "…" : ""}`
        : "On-image text: AI writes from caption",
      imagePrompt.trim()
        ? `Visual direction: ${imagePrompt.trim().slice(0, 80)}${imagePrompt.trim().length > 80 ? "…" : ""}`
        : "Visual direction: from post + style pack",
    ]);
    if (stageTimer.current) window.clearInterval(stageTimer.current);
    stageTimer.current = window.setInterval(() => {
      i = Math.min(i + 1, AI_STAGES.length - 1);
      setProgress(AI_STAGES[i].pct);
      setProgressLabel(AI_STAGES[i].label);
      if (i >= AI_STAGES.length - 1 && stageTimer.current) {
        window.clearInterval(stageTimer.current);
        stageTimer.current = null;
      }
    }, 1200);
  }

  function stopProgress(finalLabel?: string) {
    if (stageTimer.current) {
      window.clearInterval(stageTimer.current);
      stageTimer.current = null;
    }
    if (finalLabel) {
      setProgress(100);
      setProgressLabel(finalLabel);
    }
  }

  async function runAi() {
    if (imageSource === "library" && !embedMediaId) {
      setError("Pick a library image to embed, or choose None / Logo.");
      return;
    }
    setBusy(true);
    setError(null);
    startAiProgress();
    try {
      const updated = await api.generatePostGraphics(tenantId, post.id, {
        count: count === "auto" ? undefined : count,
        // Explicit slide count always replaces so all N slides are the post media
        replace: count === "auto" ? replace : true,
        template_ids: selectedTemplates.length ? selectedTemplates : undefined,
        template_id: selectedTemplates.length === 1 ? selectedTemplates[0] : undefined,
        use_logo: imageSource === "logo",
        media_asset_id: imageSource === "library" && embedMediaId ? embedMediaId : undefined,
        engine: "auto",
        on_image_text: onImageText.trim() || undefined,
        image_prompt: imagePrompt.trim() || undefined,
        style_hint: imagePrompt.trim() || undefined,
      });
      stopProgress(
        `Attached ${updated.media_count || updated.media?.length || 0} graphic(s) to this post`,
      );
      const attachedIds = (updated.media || []).map((m) => m.id);
      setSelectedIds(attachedIds);
      setDesignNotes((prev) => [
        ...prev,
        `Selected ${attachedIds.length} slide(s) on this post`,
      ]);
      onUpdated(updated);
      window.setTimeout(() => onClose(), 450);
    } catch (err) {
      stopProgress();
      setProgress(0);
      setProgressLabel("");
      setError(err instanceof Error ? err.message : "AI graphics failed");
    } finally {
      setBusy(false);
    }
  }

  async function runSuggest(mode: "text" | "image" | "both") {
    setSuggestBusy(mode);
    setError(null);
    try {
      const notes = [onImageText.trim(), imagePrompt.trim()].filter(Boolean).join("\n") || undefined;
      const res = await api.suggestGraphicDirection(tenantId, post.id, {
        mode,
        notes,
      });
      if ((mode === "text" || mode === "both") && res.on_image_text) {
        setOnImageText(res.on_image_text);
      }
      if ((mode === "image" || mode === "both") && res.image_prompt) {
        setImagePrompt(res.image_prompt);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI suggestion failed");
    } finally {
      setSuggestBusy(null);
    }
  }

  async function runUpload(file: File | null) {
    if (!file) return;
    setBusy(true);
    setError(null);
    setProgress(2);
    setProgressLabel(`Preparing ${file.name}…`);
    setDesignNotes([`File: ${file.name}`, `Size: ${(file.size / 1024).toFixed(0)} KB`]);
    try {
      const asset = await api.uploadMedia(tenantId, file, undefined, (pct) => {
        setProgress(pct);
        setProgressLabel(pct < 90 ? `Uploading… ${pct}%` : "Processing on Cloudinary…");
      });
      setProgress(96);
      setProgressLabel("Attaching to this post…");
      const updated = await api.attachPostMedia(tenantId, post.id, [asset.id]);
      setProgress(100);
      setProgressLabel("Upload complete");
      onUpdated(updated);
      window.setTimeout(() => onClose(), 400);
    } catch (err) {
      setProgress(0);
      setProgressLabel("");
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function runAttach() {
    if (!selectedIds.length) return;
    setBusy(true);
    setError(null);
    setProgress(20);
    setProgressLabel("Attaching from library…");
    try {
      const updated = await api.attachPostMedia(tenantId, post.id, selectedIds);
      setProgress(100);
      setProgressLabel("Attached");
      onUpdated(updated);
      window.setTimeout(() => onClose(), 350);
    } catch (err) {
      setProgress(0);
      setProgressLabel("");
      setError(err instanceof Error ? err.message : "Attach failed");
    } finally {
      setBusy(false);
    }
  }

  function toggle(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= 5 ? prev : [...prev, id],
    );
  }

  const uploads = library.filter((m) => m.source === "upload");

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[200] flex items-end justify-center p-0 sm:items-center sm:p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <button
            type="button"
            aria-label="Close"
            className="absolute inset-0 bg-brand-deep/45 backdrop-blur-sm"
            onClick={() => {
              if (!busy) onClose();
            }}
          />
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            className="relative z-10 flex w-full max-w-2xl flex-col overflow-hidden rounded-t-[1.5rem] border border-line bg-surface shadow-2xl sm:rounded-[1.5rem]"
            style={{
              maxHeight: "calc(100dvh - env(safe-area-inset-bottom, 0px) - 0.5rem)",
              height: "min(90dvh, calc(100dvh - env(safe-area-inset-bottom, 0px) - 0.5rem))",
            }}
          >
            <div className="shrink-0 border-b border-line px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-brand">
                    Day {post.day_index} media
                  </p>
                  <h3 className="font-display mt-1 text-xl font-bold text-brand-deep">
                    Add graphics
                  </h3>
                  <p className="mt-1 hidden text-xs text-muted sm:block">
                    Optional text + image prompt guide Neural Fabric and Image Fabric together —
                    spelling stays correct because copy is composed on top. Picking 2–5 slides
                    attaches all of them to this post.
                  </p>
                  <p className="mt-1 text-xs text-muted sm:hidden">
                    Add optional text or image direction, then generate.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={onClose}
                  className="rounded-full border border-line px-3 py-1 text-xs disabled:opacity-50"
                >
                  Close
                </button>
              </div>
              {!busy && (
                <div className="mt-4 flex gap-2">
                  {(
                    [
                      ["ai", "AI generate"],
                      ["upload", "Upload"],
                      ["library", "From library"],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setTab(id)}
                      className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                        tab === id ? "bg-brand-deep text-white" : "bg-surface-soft text-muted"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4 [-webkit-overflow-scrolling:touch]">
              {error && <p className="mb-3 text-sm text-danger">{error}</p>}

              {(busy || progress > 0) && (
                <div className="mb-5 rounded-2xl border border-brand/20 bg-brand/5 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-brand-deep">
                      {progressLabel || "Working…"}
                    </p>
                    <span className="text-xs font-semibold text-brand">{Math.round(progress)}%</span>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-soft">
                    <motion.div
                      className="h-full rounded-full bg-brand"
                      initial={{ width: 0 }}
                      animate={{ width: `${progress}%` }}
                      transition={{ duration: 0.35 }}
                    />
                  </div>
                  {designNotes.length > 0 && (
                    <ul className="mt-3 space-y-1.5">
                      {designNotes.map((note) => (
                        <li key={note} className="flex items-start gap-2 text-xs text-muted">
                          <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
                          {note}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {!busy && tab === "ai" && (
                <div className="space-y-5">
                  <div className="rounded-2xl border border-brand/20 bg-brand/[0.04] p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wider text-brand">
                          Direction for AI
                        </p>
                        <p className="mt-1 text-[11px] text-muted">
                          Optional — guide on-image copy and the visual scene. Leave blank and AI
                          writes from this post’s caption.
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={!!suggestBusy}
                        onClick={() => runSuggest("both")}
                        className="rounded-full border border-brand/30 bg-white px-3 py-1.5 text-[11px] font-semibold text-brand disabled:opacity-50"
                      >
                        {suggestBusy === "both" ? "Writing…" : "Suggest both with AI"}
                      </button>
                    </div>

                    <div className="mt-4 space-y-3">
                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <label className="text-[11px] font-semibold text-brand-deep">
                            Text on graphic{" "}
                            <span className="font-normal text-muted">(optional)</span>
                          </label>
                          <button
                            type="button"
                            disabled={!!suggestBusy}
                            onClick={() => runSuggest("text")}
                            className="text-[11px] font-semibold text-brand disabled:opacity-50"
                          >
                            {suggestBusy === "text" ? "Writing…" : "Write with AI"}
                          </button>
                        </div>
                        <textarea
                          value={onImageText}
                          onChange={(e) => setOnImageText(e.target.value)}
                          rows={3}
                          maxLength={500}
                          placeholder={`Line 1: headline\nLine 2: supporting line\nLine 3: CTA (optional)`}
                          className="mt-1.5 w-full resize-none rounded-xl border border-line bg-white px-3 py-2.5 text-sm outline-none focus:border-brand"
                        />
                        <p className="mt-1 text-[10px] text-muted">
                          Neural Fabric draws this as real text so spelling stays correct.
                        </p>
                      </div>

                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <label className="text-[11px] font-semibold text-brand-deep">
                            Image prompt{" "}
                            <span className="font-normal text-muted">(optional)</span>
                          </label>
                          <button
                            type="button"
                            disabled={!!suggestBusy}
                            onClick={() => runSuggest("image")}
                            className="text-[11px] font-semibold text-brand disabled:opacity-50"
                          >
                            {suggestBusy === "image" ? "Writing…" : "Write with AI"}
                          </button>
                        </div>
                        <textarea
                          value={imagePrompt}
                          onChange={(e) => setImagePrompt(e.target.value)}
                          rows={3}
                          maxLength={1000}
                          placeholder="Describe the scene, mood, lighting — no words in the image (e.g. warm Lagos market stall at golden hour, shallow depth of field)"
                          className="mt-1.5 w-full resize-none rounded-xl border border-line bg-white px-3 py-2.5 text-sm outline-none focus:border-brand"
                        />
                        <p className="mt-1 text-[10px] text-muted">
                          Image AI paints the background only; your text is composed on top.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                        Design template
                        <span className="ml-1 font-normal normal-case tracking-normal text-[var(--ink-3)]">
                          (fallback if no image AI)
                        </span>
                      </p>
                      <span className="text-[11px] text-muted">
                        {selectedTemplates.length
                          ? `${selectedTemplates.length} selected (max 5)`
                          : "None = style pack mix"}
                      </span>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                      {templates.map((tpl) => {
                        const on = selectedTemplates.includes(tpl.id);
                        return (
                          <button
                            key={tpl.id}
                            type="button"
                            onClick={() => toggleTemplate(tpl.id)}
                            className={`overflow-hidden rounded-xl border text-left transition ${
                              on ? "border-brand ring-2 ring-brand/30" : "border-line"
                            }`}
                          >
                            <div
                              className="relative aspect-square p-2.5"
                              style={{
                                background: `linear-gradient(135deg, ${tpl.preview.bg}, ${tpl.preview.mid})`,
                              }}
                            >
                              <div
                                className="absolute bottom-2 left-2 right-2 h-2 rounded-full"
                                style={{ background: tpl.preview.accent }}
                              />
                              <div
                                className="mt-1 h-3 w-2/3 rounded"
                                style={{ background: tpl.preview.accent, opacity: 0.85 }}
                              />
                              <div
                                className="mt-1.5 h-2 w-1/2 rounded"
                                style={{ background: "#fff", opacity: 0.35 }}
                              />
                              {tpl.supports_image && (
                                <span className="absolute right-1.5 top-1.5 rounded bg-black/45 px-1.5 py-0.5 text-[9px] font-semibold text-white">
                                  IMG
                                </span>
                              )}
                              {on && (
                                <span className="absolute left-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-brand text-[10px] font-bold text-white">
                                  ✓
                                </span>
                              )}
                            </div>
                            <div className="px-2 py-1.5">
                              <p className="truncate text-[11px] font-semibold text-brand-deep">
                                {tpl.name}
                              </p>
                              <p className="truncate text-[10px] text-muted">{tpl.hint}</p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                      Image in design
                    </p>
                    <p className="mt-1 text-[11px] text-muted">
                      Templates marked IMG can embed your logo or a library photo.
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(
                        [
                          ["none", "No image"],
                          ["logo", "Business logo"],
                          ["library", "From library"],
                        ] as const
                      ).map(([id, label]) => (
                        <button
                          key={id}
                          type="button"
                          onClick={() => {
                            setImageSource(id);
                            if (id !== "library") setEmbedMediaId(null);
                          }}
                          className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                            imageSource === id
                              ? "bg-brand/15 text-brand"
                              : "border border-line text-muted"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    {imageSource === "library" && (
                      <div className="mt-3 grid max-h-36 grid-cols-4 gap-2 overflow-y-auto">
                        {uploads.length === 0 && (
                          <p className="col-span-4 text-xs text-muted">
                            No uploads yet — upload a photo first in Media or the Upload tab.
                          </p>
                        )}
                        {uploads.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => setEmbedMediaId(item.id)}
                            className={`overflow-hidden rounded-lg border ${
                              embedMediaId === item.id
                                ? "border-brand ring-2 ring-brand/30"
                                : "border-line"
                            }`}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={item.url}
                              alt={item.title || "Media"}
                              className="aspect-square w-full object-cover"
                            />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                      How many slides
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(["auto", 1, 2, 3, 4, 5] as const).map((n) => (
                        <button
                          key={String(n)}
                          type="button"
                          onClick={() => setCount(n)}
                          className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                            count === n
                              ? "bg-brand/15 text-brand"
                              : "border border-line text-muted"
                          }`}
                        >
                          {n === "auto"
                            ? selectedTemplates.length > 1
                              ? `Match templates (${selectedTemplates.length})`
                              : "AI decides"
                            : n}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              {!busy && tab === "upload" && (
                <div className="space-y-4">
                  <p className="text-sm text-muted">
                    Upload your own photo or design. It saves to Media Manager and attaches to this
                    day.
                  </p>
                  <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-surface-soft/40 px-6 py-12 text-center">
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif,image/svg+xml"
                      className="hidden"
                      onChange={(e) => runUpload(e.target.files?.[0] || null)}
                    />
                    <span className="text-sm font-semibold text-brand-deep">Choose image</span>
                    <span className="mt-1 text-xs text-muted">
                      JPEG, PNG, WebP, GIF, SVG · max 8MB
                    </span>
                  </label>
                </div>
              )}

              {!busy && tab === "library" && (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    {(["all", "upload", "ai_generated"] as const).map((f) => (
                      <button
                        key={f}
                        type="button"
                        onClick={() => setFilter(f)}
                        className={`rounded-full px-3 py-1 text-[11px] font-semibold capitalize ${
                          filter === f ? "bg-brand/15 text-brand" : "bg-surface-soft text-muted"
                        }`}
                      >
                        {f === "ai_generated" ? "AI" : f}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {library.length === 0 && (
                      <p className="col-span-3 py-8 text-center text-sm text-muted">
                        Library empty — upload or generate first.
                      </p>
                    )}
                    {library.map((item) => {
                      const on = selectedIds.includes(item.id);
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => toggle(item.id)}
                          className={`overflow-hidden rounded-xl border ${
                            on ? "border-brand ring-2 ring-brand/30" : "border-line"
                          }`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={item.url}
                            alt={item.title || "Media"}
                            className="aspect-square w-full object-cover"
                          />
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {!busy && tab === "ai" && (
              <div
                className="shrink-0 space-y-3 border-t border-line bg-surface px-5 pt-3"
                style={{
                  paddingBottom: "max(0.85rem, env(safe-area-inset-bottom, 0px))",
                }}
              >
                <label className="flex items-center gap-2 text-sm text-muted">
                  <input
                    type="checkbox"
                    checked={count === "auto" ? replace : true}
                    disabled={count !== "auto"}
                    onChange={(e) => setReplace(e.target.checked)}
                  />
                  {count === "auto"
                    ? "Replace current attachments on this post"
                    : `Replace & attach all ${count} generated slides to this post`}
                </label>
                <button
                  type="button"
                  disabled={!!suggestBusy}
                  onClick={runAi}
                  className="w-full rounded-full bg-brand-deep py-3.5 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {selectedTemplates.length
                    ? `Generate with ${selectedTemplates.length} design${selectedTemplates.length > 1 ? "s" : ""}`
                    : onImageText.trim() || imagePrompt.trim()
                      ? "Generate with your direction"
                      : "Generate with style pack"}
                </button>
              </div>
            )}

            {!busy && tab === "library" && (
              <div
                className="shrink-0 border-t border-line bg-surface px-5 pt-3"
                style={{
                  paddingBottom: "max(0.85rem, env(safe-area-inset-bottom, 0px))",
                }}
              >
                <button
                  type="button"
                  disabled={!selectedIds.length}
                  onClick={runAttach}
                  className="w-full rounded-full bg-brand-deep py-3.5 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {`Attach ${selectedIds.length || ""} selected`.trim()}
                </button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
