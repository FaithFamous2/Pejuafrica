"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useApp } from "@/components/app-shell";
import { PageHero } from "@/components/page-hero";
import { PostMediaPicker } from "@/components/post-media-picker";
import { api, type ContentPost } from "@/lib/api";

const ease = [0.22, 1, 0.36, 1] as const;
const PAGE_SIZE = 10;

type StatusFilter = "all" | "draft" | "approved" | "published";
type PlatformFilter = "all" | "instagram" | "whatsapp" | "facebook" | "tiktok" | "linkedin";
type MediaFilter = "all" | "with_media" | "no_media";

type SmartIntent = {
  status?: StatusFilter;
  platform?: PlatformFilter;
  media?: MediaFilter;
  keywords: string[];
  summary: string;
};

const PLATFORMS: PlatformFilter[] = [
  "instagram",
  "whatsapp",
  "facebook",
  "tiktok",
  "linkedin",
];

function hasMedia(post: ContentPost) {
  return Boolean(
    (post.media && post.media.length > 0) ||
      (post.media_count && post.media_count > 0) ||
      post.graphic_url,
  );
}

/** Lightweight “AI filter” — understands plain English like “instagram drafts about sales”. */
function parseSmartFilter(raw: string): SmartIntent {
  const q = raw.trim().toLowerCase();
  const intent: SmartIntent = { keywords: [], summary: "" };
  if (!q) return intent;

  let working = q;

  if (/\b(drafts?|pending|awaiting)\b/.test(working)) {
    intent.status = "draft";
    working = working.replace(/\b(drafts?|pending|awaiting)\b/g, " ");
  } else if (/\b(approved|ready|okayed)\b/.test(working)) {
    intent.status = "approved";
    working = working.replace(/\b(approved|ready|okayed)\b/g, " ");
  } else if (/\b(published|posted|live)\b/.test(working)) {
    intent.status = "published";
    working = working.replace(/\b(published|posted|live)\b/g, " ");
  }

  for (const plat of PLATFORMS) {
    if (working.includes(plat) || (plat === "instagram" && /\big\b/.test(working))) {
      intent.platform = plat;
      working = working.replace(new RegExp(`\\b${plat}\\b`, "g"), " ");
      if (plat === "instagram") working = working.replace(/\big\b/g, " ");
      break;
    }
  }

  if (/\b(with|has|have)\s+(media|graphic|graphics|image|images|photo|photos)\b/.test(working)) {
    intent.media = "with_media";
    working = working.replace(
      /\b(with|has|have)\s+(media|graphic|graphics|image|images|photo|photos)\b/g,
      " ",
    );
  } else if (
    /\b(without|no|missing)\s+(media|graphic|graphics|image|images|photo|photos)\b/.test(working)
  ) {
    intent.media = "no_media";
    working = working.replace(
      /\b(without|no|missing)\s+(media|graphic|graphics|image|images|photo|photos)\b/g,
      " ",
    );
  }

  const stop = new Set([
    "show",
    "me",
    "find",
    "get",
    "posts",
    "post",
    "content",
    "about",
    "for",
    "the",
    "a",
    "an",
    "and",
    "or",
    "with",
    "that",
    "are",
    "is",
    "all",
    "my",
    "please",
  ]);
  intent.keywords = working
    .split(/[^a-z0-9#]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1 && !stop.has(t));

  const bits: string[] = [];
  if (intent.status && intent.status !== "all") bits.push(intent.status);
  if (intent.platform && intent.platform !== "all") bits.push(intent.platform);
  if (intent.media === "with_media") bits.push("with media");
  if (intent.media === "no_media") bits.push("no media");
  if (intent.keywords.length) bits.push(`“${intent.keywords.join(" ")}”`);
  intent.summary = bits.length ? bits.join(" · ") : "matched text search";

  return intent;
}

function applyFilters(
  posts: ContentPost[],
  status: StatusFilter,
  platform: PlatformFilter,
  media: MediaFilter,
  smart: SmartIntent | null,
  textQuery: string,
) {
  let list = posts;

  const statusF = smart?.status && smart.status !== "all" ? smart.status : status;
  const platformF = smart?.platform && smart.platform !== "all" ? smart.platform : platform;
  const mediaF = smart?.media && smart.media !== "all" ? smart.media : media;

  if (statusF !== "all") list = list.filter((p) => p.status === statusF);
  if (platformF !== "all") list = list.filter((p) => p.platform === platformF);
  if (mediaF === "with_media") list = list.filter(hasMedia);
  if (mediaF === "no_media") list = list.filter((p) => !hasMedia(p));

  const keywords =
    smart && smart.keywords.length > 0
      ? smart.keywords
      : textQuery
          .toLowerCase()
          .split(/[^a-z0-9#]+/)
          .filter((t) => t.length > 1);

  if (keywords.length) {
    list = list.filter((p) => {
      const hay = [
        p.caption,
        p.theme,
        p.cta || "",
        p.platform,
        p.status,
        ...(p.hashtags || []),
        p.graphic_prompt || "",
      ]
        .join(" ")
        .toLowerCase();
      return keywords.every((k) => hay.includes(k.toLowerCase()));
    });
  }

  return list;
}

export default function ContentLibraryPage() {
  const { tenantId } = useApp();
  const [posts, setPosts] = useState<ContentPost[]>([]);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [platform, setPlatform] = useState<PlatformFilter>("all");
  const [media, setMedia] = useState<MediaFilter>("all");
  const [search, setSearch] = useState("");
  const [smartQuery, setSmartQuery] = useState("");
  const [smartIntent, setSmartIntent] = useState<SmartIntent | null>(null);
  const [smartBusy, setSmartBusy] = useState(false);
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selected, setSelected] = useState<ContentPost | null>(null);
  const [mediaPost, setMediaPost] = useState<ContentPost | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!tenantId) return;
    setPosts(await api.listPosts(tenantId));
  }, [tenantId]);

  useEffect(() => {
    reload().catch(() => setPosts([]));
  }, [reload]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2500);
    return () => window.clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    setPage(1);
  }, [status, platform, media, search, smartIntent]);

  const counts = useMemo(
    () => ({
      all: posts.length,
      draft: posts.filter((p) => p.status === "draft").length,
      approved: posts.filter((p) => p.status === "approved").length,
      published: posts.filter((p) => p.status === "published").length,
    }),
    [posts],
  );

  const filtered = useMemo(
    () => applyFilters(posts, status, platform, media, smartIntent, search),
    [posts, status, platform, media, smartIntent, search],
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, safePage]);

  function runSmartFilter() {
    if (!smartQuery.trim()) {
      setSmartIntent(null);
      setToast("Cleared AI filter");
      return;
    }
    setSmartBusy(true);
    // Small delay so the UI feels like a thoughtful pass
    window.setTimeout(() => {
      const intent = parseSmartFilter(smartQuery);
      setSmartIntent(intent);
      // Mirror parsed chips into the manual filters for clarity
      if (intent.status) setStatus(intent.status);
      if (intent.platform) setPlatform(intent.platform);
      if (intent.media) setMedia(intent.media);
      if (intent.keywords.length) setSearch(intent.keywords.join(" "));
      setSmartBusy(false);
      setToast(`AI filter · ${intent.summary}`);
    }, 280);
  }

  function clearFilters() {
    setStatus("all");
    setPlatform("all");
    setMedia("all");
    setSearch("");
    setSmartQuery("");
    setSmartIntent(null);
    setPage(1);
  }

  function patch(p: ContentPost) {
    setPosts((prev) => prev.map((x) => (x.id === p.id ? p : x)));
    setSelected((cur) => (cur?.id === p.id ? p : cur));
    setMediaPost((cur) => (cur?.id === p.id ? p : cur));
  }

  async function approve(post: ContentPost) {
    if (!tenantId) return;
    setBusyId(post.id);
    setError(null);
    try {
      patch(await api.updatePostStatus(tenantId, post.id, "approved"));
      setToast(`Day ${post.day_index} approved`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approve failed");
    } finally {
      setBusyId(null);
    }
  }

  async function detachMedia(post: ContentPost, mediaId: string) {
    if (!tenantId) return;
    setBusyId(post.id);
    try {
      patch(await api.detachPostMedia(tenantId, post.id, mediaId));
      setToast("Media removed from post");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Detach failed");
    } finally {
      setBusyId(null);
    }
  }

  async function copyPack(post: ContentPost) {
    const pack = [
      post.caption,
      "",
      post.cta ? `CTA: ${post.cta}` : "",
      (post.hashtags || []).join(" "),
      post.graphic_prompt ? `\nGraphic idea: ${post.graphic_prompt}` : "",
      post.graphic_url ? `\nGraphic: ${post.graphic_url}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    await navigator.clipboard.writeText(pack);
    setToast("Caption + hashtags + CTA copied");
  }

  function shareWhatsApp(post: ContentPost) {
    const text = encodeURIComponent(
      `${post.caption}\n\n${(post.hashtags || []).join(" ")}${post.cta ? `\n\n${post.cta}` : ""}`,
    );
    window.open(`https://wa.me/?text=${text}`, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHero
        eyebrow="Library"
        title="Content library"
        description="Captions, hashtags, CTAs, graphics, approval, export, and share-ready packs."
      />

      <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-[1.25rem] border border-line/80 bg-line/80 sm:grid-cols-4">
        <MiniStat label="All" value={String(counts.all)} />
        <MiniStat label="Drafts" value={String(counts.draft)} />
        <MiniStat label="Approved" value={String(counts.approved)} />
        <MiniStat label="Published" value={String(counts.published)} />
      </div>

      {/* Smart AI filter */}
      <div className="mt-6 rounded-[1.35rem] border border-brand/20 bg-brand/[0.04] p-4 sm:p-5">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-brand">
              Smart filter
            </p>
            <p className="mt-1 text-xs text-muted">
              Ask in plain English — e.g. “instagram drafts about promo” or “posts with graphics”
            </p>
          </div>
          {(smartIntent || status !== "all" || platform !== "all" || media !== "all" || search) && (
            <button
              type="button"
              onClick={clearFilters}
              className="text-xs font-semibold text-muted hover:text-brand-deep"
            >
              Clear all
            </button>
          )}
        </div>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            value={smartQuery}
            onChange={(e) => setSmartQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") runSmartFilter();
            }}
            placeholder="Filter with AI… what do you want to see?"
            className="w-full rounded-full border border-line bg-white px-4 py-2.5 text-sm outline-none focus:border-brand"
          />
          <button
            type="button"
            disabled={smartBusy}
            onClick={runSmartFilter}
            className="shrink-0 rounded-full bg-brand-deep px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {smartBusy ? "Thinking…" : "Apply AI filter"}
          </button>
        </div>
        {smartIntent && (
          <p className="mt-2 text-xs font-medium text-brand-deep">
            Active · {smartIntent.summary}
          </p>
        )}
      </div>

      {/* Manual filters */}
      <div className="mt-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          {(["all", "draft", "approved", "published"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => {
                setStatus(f);
                setSmartIntent(null);
              }}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold capitalize ${
                status === f ? "bg-brand-deep text-white" : "bg-surface-soft text-muted"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {(["all", ...PLATFORMS] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => {
                setPlatform(f);
                setSmartIntent(null);
              }}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold capitalize ${
                platform === f ? "bg-brand/15 text-brand" : "border border-line text-muted"
              }`}
            >
              {f === "all" ? "All platforms" : f}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              ["all", "Any media"],
              ["with_media", "With graphics"],
              ["no_media", "No graphics"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setMedia(id);
                setSmartIntent(null);
              }}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold ${
                media === id ? "bg-accent/50 text-accent-ink" : "border border-line text-muted"
              }`}
            >
              {label}
            </button>
          ))}
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setSmartIntent(null);
            }}
            placeholder="Search caption, theme, hashtag…"
            className="min-w-[12rem] flex-1 rounded-full border border-line bg-white px-4 py-1.5 text-xs outline-none focus:border-brand sm:max-w-xs"
          />
        </div>
      </div>

      {toast && (
        <p className="mt-4 rounded-2xl border border-brand/20 bg-brand/10 px-4 py-3 text-sm text-brand-deep">
          {toast}
        </p>
      )}
      {error && <p className="mt-4 text-sm text-danger">{error}</p>}

      <p className="mt-5 text-xs text-muted">
        {filtered.length} result{filtered.length === 1 ? "" : "s"}
        {filtered.length !== posts.length ? ` · filtered from ${posts.length}` : ""}
      </p>

      <div className="mt-3 space-y-3">
        {pageItems.length === 0 && (
          <div className="rounded-[1.75rem] border border-dashed border-line px-6 py-14 text-center text-sm text-muted">
            {posts.length === 0
              ? "No posts yet. Generate a campaign from AI Marketing."
              : "No posts match these filters. Try clearing or asking AI differently."}
          </div>
        )}
        {pageItems.map((post, i) => (
          <motion.article
            key={post.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.02, duration: 0.4, ease }}
            className="rounded-2xl border border-line bg-surface p-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  <span className="font-semibold text-brand-deep">Day {post.day_index}</span>
                  <span>·</span>
                  <span className="capitalize">{post.platform}</span>
                  <span>·</span>
                  <span>{post.theme}</span>
                  <span className="rounded-full bg-surface-soft px-2 py-0.5 capitalize">
                    {post.status}
                  </span>
                </div>
                <p className="mt-3 line-clamp-3 whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
                  {post.caption}
                </p>
                {post.cta && (
                  <p className="mt-2 text-xs font-semibold text-brand">CTA: {post.cta}</p>
                )}
                <div className="mt-2 flex flex-wrap gap-2">
                  {(post.hashtags || []).slice(0, 8).map((tag) => (
                    <span key={tag} className="text-xs text-brand">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
              {(post.media && post.media.length > 0) || post.graphic_url ? (
                <div className="flex gap-1.5">
                  {(post.media && post.media.length > 0
                    ? post.media.slice(0, 3)
                    : post.graphic_url
                      ? [{ id: "legacy", url: post.graphic_url }]
                      : []
                  ).map((m) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={m.id}
                      src={m.url}
                      alt={`Day ${post.day_index} media`}
                      className="h-20 w-20 rounded-xl border border-line object-cover"
                    />
                  ))}
                  {(post.media_count || post.media?.length || 0) > 3 && (
                    <span className="flex h-20 w-12 items-center justify-center rounded-xl bg-surface-soft text-xs text-muted">
                      +{(post.media_count || post.media!.length) - 3}
                    </span>
                  )}
                </div>
              ) : null}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setSelected(post)}
                className="rounded-full border border-line px-3 py-1.5 text-xs font-semibold"
              >
                Open
              </button>
              <button
                type="button"
                onClick={() => copyPack(post)}
                className="rounded-full border border-line px-3 py-1.5 text-xs font-semibold"
              >
                Copy pack
              </button>
              <button
                type="button"
                onClick={() => setMediaPost(post)}
                className="rounded-full border border-accent/40 bg-accent/30 px-3 py-1.5 text-xs font-semibold text-accent-ink"
              >
                Media
                {(post.media_count || post.media?.length || 0) > 0
                  ? ` (${post.media_count || post.media?.length})`
                  : ""}
              </button>
              {post.status !== "approved" && (
                <button
                  type="button"
                  disabled={busyId === post.id}
                  onClick={() => approve(post)}
                  className="rounded-full bg-brand-deep px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                >
                  Approve
                </button>
              )}
              <button
                type="button"
                onClick={() => shareWhatsApp(post)}
                className="rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-muted"
              >
                WhatsApp share
              </button>
            </div>
          </motion.article>
        ))}
      </div>

      {filtered.length > 0 && (
        <div className="mt-6 flex flex-col items-center justify-between gap-3 sm:flex-row">
          <p className="text-xs text-muted">
            Showing {(safePage - 1) * PAGE_SIZE + 1}–
            {Math.min(safePage * PAGE_SIZE, filtered.length)} of {filtered.length}
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
                  return p === 1 || p === totalPages || Math.abs(p - safePage) <= 1;
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

      <AnimatePresence>
        {selected && tenantId && (
          <PostDetailDrawer
            post={selected}
            tenantId={tenantId}
            busy={busyId === selected.id}
            onClose={() => setSelected(null)}
            onApprove={() => approve(selected)}
            onMedia={() => setMediaPost(selected)}
            onDetach={(mediaId) => detachMedia(selected, mediaId)}
            onSaved={(p) => {
              patch(p);
              setToast("Post updated");
            }}
            onCopy={() => copyPack(selected)}
            onWhatsApp={() => shareWhatsApp(selected)}
          />
        )}
      </AnimatePresence>

      {tenantId && mediaPost && (
        <PostMediaPicker
          tenantId={tenantId}
          post={mediaPost}
          open={!!mediaPost}
          onClose={() => setMediaPost(null)}
          onUpdated={(p) => {
            patch(p);
            setToast(
              `Media updated for day ${p.day_index}${
                p.media_count ? ` · ${p.media_count} asset(s)` : ""
              }`,
            );
          }}
        />
      )}
    </div>
  );
}

function PostDetailDrawer({
  post,
  tenantId,
  busy,
  onClose,
  onApprove,
  onMedia,
  onDetach,
  onSaved,
  onCopy,
  onWhatsApp,
}: {
  post: ContentPost;
  tenantId: string;
  busy: boolean;
  onClose: () => void;
  onApprove: () => void;
  onMedia: () => void;
  onDetach: (mediaId: string) => void;
  onSaved: (post: ContentPost) => void;
  onCopy: () => void;
  onWhatsApp: () => void;
}) {
  const media = post.media?.length
    ? post.media
    : post.graphic_url
      ? [{ id: "legacy", url: post.graphic_url, source: "upload", created_at: "" }]
      : [];

  const [caption, setCaption] = useState(post.caption);
  const [cta, setCta] = useState(post.cta || "");
  const [hashtagsText, setHashtagsText] = useState((post.hashtags || []).join(" "));
  const [platform, setPlatform] = useState(post.platform);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  useEffect(() => {
    setCaption(post.caption);
    setCta(post.cta || "");
    setHashtagsText((post.hashtags || []).join(" "));
    setPlatform(post.platform);
  }, [post.id, post.caption, post.cta, post.hashtags, post.platform]);

  const dirty =
    caption !== post.caption ||
    cta !== (post.cta || "") ||
    hashtagsText.trim() !== (post.hashtags || []).join(" ");

  async function saveEdits() {
    setSaving(true);
    setEditError(null);
    try {
      const hashtags = hashtagsText
        .split(/[\s,]+/)
        .map((t) => t.trim())
        .filter(Boolean)
        .map((t) => (t.startsWith("#") ? t : `#${t}`));
      onSaved(
        await api.updatePost(tenantId, post.id, {
          caption,
          cta: cta || null,
          hashtags,
        }),
      );
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <motion.div
      className="fixed inset-0 z-50 flex justify-end"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-brand-deep/30 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <motion.aside
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", stiffness: 280, damping: 30 }}
        className="relative z-10 flex h-full w-full max-w-full flex-col overflow-y-auto border-l border-line bg-surface p-6 shadow-2xl sm:max-w-md md:max-w-xl lg:max-w-[36rem] md:p-8"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-brand">
              Day {post.day_index} · {post.theme}
            </p>
            <h3 className="font-display mt-1 text-2xl font-bold capitalize text-brand-deep md:text-3xl">
              {platform}
            </h3>
          </div>
          <button type="button" onClick={onClose} className="text-sm text-muted">
            Close
          </button>
        </div>

        <div className="mt-5 space-y-4 text-sm">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">Platform</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {(
                [
                  "instagram",
                  "whatsapp",
                  "facebook",
                  "tiktok",
                  "linkedin",
                  "twitter",
                ] as const
              ).map((p) => (
                <button
                  key={p}
                  type="button"
                  disabled={busy || saving}
                  onClick={async () => {
                    setPlatform(p);
                    if (p === post.platform) return;
                    setSaving(true);
                    try {
                      onSaved(await api.updatePost(tenantId, post.id, { platform: p }));
                    } catch (err) {
                      setPlatform(post.platform);
                      setEditError(err instanceof Error ? err.message : "Could not change platform");
                    } finally {
                      setSaving(false);
                    }
                  }}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold capitalize disabled:opacity-50 ${
                    platform === p
                      ? "bg-brand-deep text-white"
                      : "border border-line text-muted"
                  }`}
                >
                  {p === "twitter" ? "X / Twitter" : p}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">Caption</p>
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              rows={6}
              className="mt-2 w-full rounded-2xl border border-line bg-surface-soft/40 px-3.5 py-3 text-sm leading-relaxed outline-none ring-brand/30 focus:ring-2"
            />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">CTA</p>
            <input
              value={cta}
              onChange={(e) => setCta(e.target.value)}
              className="mt-2 w-full rounded-2xl border border-line bg-surface-soft/40 px-3.5 py-2.5 text-sm outline-none ring-brand/30 focus:ring-2"
            />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">Hashtags</p>
            <textarea
              value={hashtagsText}
              onChange={(e) => setHashtagsText(e.target.value)}
              rows={2}
              className="mt-2 w-full rounded-2xl border border-line bg-surface-soft/40 px-3.5 py-2.5 text-sm text-brand outline-none ring-brand/30 focus:ring-2"
            />
          </div>
          {dirty && (
            <button
              type="button"
              disabled={saving || busy}
              onClick={saveEdits}
              className="rounded-full bg-brand-deep px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save caption & hashtags"}
            </button>
          )}
          {editError && <p className="text-sm text-danger">{editError}</p>}
          <Block title="Graphic prompt" body={post.graphic_prompt || "—"} />
        </div>

        <div className="mt-5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">
              Media ({media.length})
            </p>
            <button
              type="button"
              onClick={onMedia}
              className="text-xs font-semibold text-brand hover:underline"
            >
              + Add more
            </button>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {media.map((m) => (
              <div key={m.id} className="relative overflow-hidden rounded-xl border border-line">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={m.url} alt="Post media" className="aspect-square w-full object-cover" />
                {m.id !== "legacy" && (
                  <button
                    type="button"
                    disabled={busy}
                    aria-label="Remove from post"
                    title="Remove from this post (keeps in Media library)"
                    onClick={() => onDetach(m.id)}
                    className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-sm font-bold text-white"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={onMedia}
              className="flex aspect-square items-center justify-center rounded-xl border border-dashed border-line text-2xl text-muted"
            >
              +
            </button>
          </div>
          <p className="mt-2 text-[11px] text-muted">
            × removes from this post only — library keeps the file.
          </p>
        </div>

        <div className="mt-auto space-y-2 pt-8">
          {post.status !== "approved" && (
            <button
              type="button"
              disabled={busy}
              onClick={onApprove}
              className="w-full rounded-full bg-brand-deep py-3 text-sm font-semibold text-white disabled:opacity-50"
            >
              Approve
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={onMedia}
            className="w-full rounded-full border border-accent/40 bg-accent/30 py-3 text-sm font-semibold text-accent-ink disabled:opacity-50"
          >
            Add media (AI / upload / library)
          </button>
          <button
            type="button"
            onClick={onCopy}
            className="w-full rounded-full border border-line py-2.5 text-sm font-medium"
          >
            Export / copy pack
          </button>
          <button
            type="button"
            onClick={onWhatsApp}
            className="w-full rounded-full border border-line py-2.5 text-sm font-medium text-muted"
          >
            Share via WhatsApp
          </button>
        </div>
      </motion.aside>
    </motion.div>
  );
}

function Block({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-muted">{title}</p>
      <p className="mt-2 whitespace-pre-wrap leading-relaxed text-foreground/90">{body}</p>
    </div>
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
