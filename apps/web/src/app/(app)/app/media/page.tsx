"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, type PanInfo } from "framer-motion";
import { useApp } from "@/components/app-shell";
import { MediaRedesignStudio } from "@/components/media-redesign-studio";
import { PageHero } from "@/components/page-hero";
import { useStudioModal } from "@/hooks/use-studio-modal";
import { api, type MediaAsset } from "@/lib/api";

const ease = [0.22, 1, 0.36, 1] as const;
const PAGE_SIZE = 18;

export default function MediaManagerPage() {
  const { tenantId, needsOnboarding } = useApp();
  const [items, setItems] = useState<MediaAsset[]>([]);
  const [filter, setFilter] = useState<"all" | "upload" | "ai_generated">("all");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [redesignAsset, setRedesignAsset] = useState<MediaAsset | null>(null);

  const reload = useCallback(async () => {
    if (!tenantId) return;
    const source = filter === "all" ? undefined : filter;
    setItems(await api.listMedia(tenantId, source));
  }, [tenantId, filter]);

  useEffect(() => {
    reload().catch(() => setItems([]));
  }, [reload]);

  useEffect(() => {
    setPage(1);
  }, [filter]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2500);
    return () => window.clearTimeout(t);
  }, [toast]);

  const counts = useMemo(
    () => ({
      all: items.length,
      upload: items.filter((i) => i.source === "upload").length,
      ai: items.filter((i) => i.source === "ai_generated").length,
    }),
    [items],
  );

  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return items.slice(start, start + PAGE_SIZE);
  }, [items, safePage]);

  async function onUpload(file: File | null) {
    if (!tenantId || !file) return;
    setBusy(true);
    setError(null);
    try {
      const asset = await api.uploadMedia(tenantId, file);
      setItems((prev) => [asset, ...prev]);
      setPage(1);
      setToast("Uploaded to your media library");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(asset: MediaAsset) {
    if (!tenantId) return;
    if (!window.confirm("Remove this from your media library? Posts that used it will detach it.")) {
      return;
    }
    setBusy(true);
    try {
      await api.deleteMedia(tenantId, asset.id);
      setItems((prev) => {
        const next = prev.filter((x) => x.id !== asset.id);
        setViewerIndex((idx) => {
          if (idx == null) return null;
          if (next.length === 0) return null;
          return Math.min(idx, next.length - 1);
        });
        return next;
      });
      setToast("Removed from library");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  function openViewer(item: MediaAsset) {
    const idx = items.findIndex((x) => x.id === item.id);
    if (idx >= 0) setViewerIndex(idx);
  }

  if (needsOnboarding) {
    return (
      <div className="rounded-[1.75rem] border border-dashed border-line px-6 py-14 text-center text-sm text-muted">
        Finish onboarding first, then build your brand media library.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHero
        eyebrow="Library"
        title="Media manager"
        description="Upload brand photos or reuse AI-generated graphics across posts. Attach anything here when a calendar day needs media — no AI required."
        action={
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-brand-deep px-5 py-2.5 text-sm font-semibold text-white shadow-[0_8px_24px_rgba(8,53,38,0.2)]">
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif,image/svg+xml"
              className="hidden"
              disabled={busy}
              onChange={(e) => onUpload(e.target.files?.[0] || null)}
            />
            {busy ? "Working…" : "Upload media"}
          </label>
        }
      />

      <div className="mt-6 flex flex-wrap items-center gap-2">
        {(["all", "upload", "ai_generated"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-semibold capitalize ${
              filter === f ? "bg-brand-deep text-white" : "bg-surface-soft text-muted"
            }`}
          >
            {f === "ai_generated" ? "AI generated" : f}
          </button>
        ))}
      </div>

      <div className="mt-5 grid grid-cols-3 gap-px overflow-hidden rounded-[1.25rem] border border-line/80 bg-line/80">
        <MiniStat label="In view" value={String(counts.all)} />
        <MiniStat label="Uploads" value={String(counts.upload)} />
        <MiniStat label="AI graphics" value={String(counts.ai)} />
      </div>

      {toast && (
        <p className="mt-4 rounded-2xl border border-brand/20 bg-brand/10 px-4 py-3 text-sm text-brand-deep">
          {toast}
        </p>
      )}
      {error && <p className="mt-4 text-sm text-danger">{error}</p>}

      {/* 3 mobile · 3 tablet · 6 desktop */}
      <div className="mt-6 grid grid-cols-3 gap-2 sm:gap-3 lg:grid-cols-6">
        {items.length === 0 && (
          <div className="col-span-full rounded-[1.75rem] border border-dashed border-line px-6 py-14 text-center text-sm text-muted">
            No media yet. Upload brand photos, or generate AI graphics from a calendar day — they land
            here for reuse.
          </div>
        )}
        {pageItems.map((item, i) => (
          <motion.button
            key={item.id}
            type="button"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(i * 0.02, 0.24), duration: 0.35, ease }}
            onClick={() => openViewer(item)}
            className="group overflow-hidden rounded-2xl border border-line bg-surface text-left transition hover:border-brand/35 hover:shadow-[0_10px_28px_rgba(8,53,38,0.08)]"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={item.url}
              alt={item.title || "Media"}
              className="aspect-square w-full object-cover transition duration-300 group-hover:scale-[1.03]"
            />
            <div className="px-2.5 py-2 sm:px-3 sm:py-2.5">
              <p className="truncate text-[11px] font-semibold text-brand-deep sm:text-sm">
                {item.title || item.filename || "Untitled"}
              </p>
              <p className="mt-0.5 truncate text-[10px] capitalize text-muted">
                {item.source === "ai_generated" ? "AI" : "Upload"}
                {item.role ? ` · ${item.role}` : ""}
              </p>
            </div>
          </motion.button>
        ))}
      </div>

      {items.length > 0 && (
        <div className="mt-6 flex flex-col items-center justify-between gap-3 sm:flex-row">
          <p className="text-xs text-muted">
            Showing {(safePage - 1) * PAGE_SIZE + 1}–
            {Math.min(safePage * PAGE_SIZE, items.length)} of {items.length}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={safePage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded-full border border-line bg-surface px-4 py-2 text-xs font-semibold text-brand-deep disabled:opacity-40"
            >
              Previous
            </button>
            <div className="flex items-center gap-1">
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter((p) => {
                  if (totalPages <= 5) return true;
                  return (
                    p === 1 ||
                    p === totalPages ||
                    Math.abs(p - safePage) <= 1
                  );
                })
                .reduce<(number | "…")[]>((acc, p, idx, arr) => {
                  if (idx > 0) {
                    const prev = arr[idx - 1];
                    if (typeof prev === "number" && p - prev > 1) acc.push("…");
                  }
                  acc.push(p);
                  return acc;
                }, [])
                .map((p, idx) =>
                  p === "…" ? (
                    <span key={`e-${idx}`} className="px-1 text-xs text-muted">
                      …
                    </span>
                  ) : (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPage(p)}
                      className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold ${
                        p === safePage
                          ? "bg-brand-deep text-white"
                          : "border border-line bg-surface text-brand-deep"
                      }`}
                    >
                      {p}
                    </button>
                  ),
                )}
            </div>
            <button
              type="button"
              disabled={safePage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="rounded-full border border-line bg-surface px-4 py-2 text-xs font-semibold text-brand-deep disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}

      <MediaLightbox
        items={items}
        index={viewerIndex}
        busy={busy}
        onClose={() => setViewerIndex(null)}
        onIndexChange={setViewerIndex}
        onDelete={onDelete}
        onRedesign={(asset) => setRedesignAsset(asset)}
      />

      {tenantId && (
        <MediaRedesignStudio
          tenantId={tenantId}
          asset={redesignAsset}
          open={!!redesignAsset}
          onClose={() => setRedesignAsset(null)}
          onCreated={(asset, mode) => {
            setItems((prev) => [asset, ...prev.filter((x) => x.id !== asset.id)]);
            setPage(1);
            setToast(
              mode === "fork"
                ? "AI copy created — original upload kept"
                : "New AI redesign saved to your library",
            );
            // Jump lightbox to the new asset
            setViewerIndex(0);
          }}
        />
      )}
    </div>
  );
}

function MediaLightbox({
  items,
  index,
  busy,
  onClose,
  onIndexChange,
  onDelete,
  onRedesign,
}: {
  items: MediaAsset[];
  index: number | null;
  busy: boolean;
  onClose: () => void;
  onIndexChange: (i: number) => void;
  onDelete: (asset: MediaAsset) => void;
  onRedesign: (asset: MediaAsset) => void;
}) {
  const open = index != null && items.length > 0;
  const [mounted, setMounted] = useState(false);
  useStudioModal(open);

  useEffect(() => {
    setMounted(true);
  }, []);

  const selected = index != null ? items[index] : null;
  const canPrev = index != null && index > 0;
  const canNext = index != null && index < items.length - 1;

  useEffect(() => {
    if (!open || index == null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && index! > 0) onIndexChange(index! - 1);
      if (e.key === "ArrowRight" && index! < items.length - 1) onIndexChange(index! + 1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, index, items.length, onClose, onIndexChange]);

  function onDragEnd(_: unknown, info: PanInfo) {
    if (index == null) return;
    if (info.offset.x < -60 && canNext) onIndexChange(index + 1);
    else if (info.offset.x > 60 && canPrev) onIndexChange(index - 1);
  }

  if (!mounted || !selected || index == null) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[200] flex flex-col bg-[#041c14]/92 backdrop-blur-md"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="flex items-center justify-between gap-3 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-6">
            <div className="min-w-0">
              <p className="truncate font-display text-base font-bold text-white sm:text-lg">
                {selected.title || selected.filename || "Media"}
              </p>
              <p className="text-[11px] text-white/55">
                {index + 1} / {items.length}
                {" · "}
                {selected.source === "ai_generated" ? "AI generated" : "Uploaded"}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs font-semibold text-white"
            >
              Close
            </button>
          </div>

          <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 sm:px-10">
            {canPrev && (
              <button
                type="button"
                aria-label="Previous"
                onClick={() => onIndexChange(index - 1)}
                className="absolute left-2 z-20 hidden h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white sm:flex lg:left-4"
              >
                ←
              </button>
            )}
            {canNext && (
              <button
                type="button"
                aria-label="Next"
                onClick={() => onIndexChange(index + 1)}
                className="absolute right-2 z-20 hidden h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white sm:flex lg:right-4"
              >
                →
              </button>
            )}

            <AnimatePresence mode="wait">
              <motion.div
                key={selected.id}
                drag="x"
                dragConstraints={{ left: 0, right: 0 }}
                dragElastic={0.2}
                onDragEnd={onDragEnd}
                initial={{ opacity: 0, x: 28 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -28 }}
                transition={{ duration: 0.28, ease }}
                className="flex max-h-full w-full max-w-4xl touch-pan-y items-center justify-center"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={selected.url}
                  alt={selected.title || "Media"}
                  className="max-h-[68vh] w-auto max-w-full select-none rounded-2xl object-contain shadow-2xl sm:max-h-[72vh]"
                  draggable={false}
                />
              </motion.div>
            </AnimatePresence>
          </div>

          <div
            className="space-y-3 border-t border-white/10 px-4 py-4 sm:px-6"
            style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
          >
            <div className="flex items-center justify-center gap-2 sm:hidden">
              <button
                type="button"
                disabled={!canPrev}
                onClick={() => onIndexChange(index - 1)}
                className="rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs font-semibold text-white disabled:opacity-35"
              >
                ← Prev
              </button>
              <button
                type="button"
                disabled={!canNext}
                onClick={() => onIndexChange(index + 1)}
                className="rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs font-semibold text-white disabled:opacity-35"
              >
                Next →
              </button>
            </div>

            <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => onRedesign(selected)}
                className="rounded-full bg-accent px-4 py-2.5 text-xs font-semibold text-accent-ink disabled:opacity-50 sm:py-2"
              >
                <span className="sm:hidden">
                  {selected.source === "upload" ? "AI improve" : "AI redesign"}
                </span>
                <span className="hidden sm:inline">
                  {selected.source === "upload" ? "Improve with AI (copy)" : "Redesign with AI"}
                </span>
              </button>
              <a
                href={selected.url}
                target="_blank"
                rel="noreferrer"
                className="rounded-full border border-white/20 bg-white/10 px-4 py-2.5 text-xs font-semibold text-white sm:py-2"
              >
                <span className="sm:hidden">Download</span>
                <span className="hidden sm:inline">Open / download</span>
              </a>
              <button
                type="button"
                disabled={busy}
                onClick={() => onDelete(selected)}
                className="rounded-full border border-red-300/40 bg-red-500/15 px-4 py-2.5 text-xs font-semibold text-red-200 disabled:opacity-50 sm:py-2"
              >
                Remove
              </button>
            </div>

            {/* Filmstrip — jump between nearby images */}
            <div className="mx-auto flex max-w-4xl gap-2 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch]">
              {items.map((item, i) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onIndexChange(i)}
                  className={`h-14 w-14 shrink-0 overflow-hidden rounded-xl border transition ${
                    i === index
                      ? "border-accent ring-2 ring-accent/50"
                      : "border-white/15 opacity-70 hover:opacity-100"
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={item.url} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface px-3 py-3.5 sm:px-4 sm:py-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">{label}</p>
      <p className="font-display mt-1 text-2xl font-bold tabular-nums text-brand-deep">{value}</p>
    </div>
  );
}
