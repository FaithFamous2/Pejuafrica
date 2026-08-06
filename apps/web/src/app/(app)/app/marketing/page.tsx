"use client";

import Link from "next/link";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useApp } from "@/components/app-shell";
import { GenerationBriefModal, type PlanSchedule } from "@/components/generation-brief-modal";
import { PageHero } from "@/components/page-hero";
import { PostMediaPicker } from "@/components/post-media-picker";
import { api, type Campaign, type ContentPost, type GenerationBrief } from "@/lib/api";

const ease = [0.22, 1, 0.36, 1] as const;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
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

export default function MarketingPage() {
  const { tenantId, needsOnboarding, profile } = useApp();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [active, setActive] = useState<Campaign | null>(null);
  const [selectedPost, setSelectedPost] = useState<ContentPost | null>(null);
  const [generating, setGenerating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [view, setView] = useState<"month" | "list">("month");
  const [showGenerateBrief, setShowGenerateBrief] = useState(false);
  const [regenTarget, setRegenTarget] = useState<ContentPost | null>(null);
  const [mediaPost, setMediaPost] = useState<ContentPost | null>(null);
  const [streamStatus, setStreamStatus] = useState<string | null>(null);
  const [streamingPostId, setStreamingPostId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!tenantId) return;
    const list = await api.listCampaigns(tenantId);
    setCampaigns(list);
    if (list[0]) {
      const full = await api.getCampaign(tenantId, list[0].id);
      setActive(full);
    } else {
      setActive(null);
    }
  }, [tenantId]);

  useEffect(() => {
    load().catch(() => setCampaigns([]));
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(t);
  }, [toast]);

  async function generate(brief: GenerationBrief = {}, schedule?: PlanSchedule) {
    if (!tenantId) return;
    setError(null);
    setGenerating(true);
    setShowGenerateBrief(false);
    try {
      const campaign = await api.generateCampaign(tenantId, {
        brief,
        month: schedule?.month,
        year: schedule?.year,
      });
      setCampaigns((prev) => [campaign, ...prev]);
      setActive(campaign);
      setView("month");
      const label =
        schedule != null
          ? `${MONTHS[schedule.month - 1]} ${schedule.year}`
          : `${MONTHS[campaign.month - 1]} ${campaign.year}`;
      setToast(`${label} plan ready`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  }

  function patchPost(p: ContentPost) {
    setSelectedPost(p);
    setMediaPost((cur) => (cur && cur.id === p.id ? p : cur));
    setActive((prev) =>
      prev
        ? { ...prev, posts: prev.posts.map((x) => (x.id === p.id ? p : x)) }
        : prev,
    );
  }

  async function approvePost(post: ContentPost) {
    if (!tenantId) return;
    setBusyId(post.id);
    try {
      const updated = await api.updatePostStatus(tenantId, post.id, "approved");
      patchPost(updated);
      setToast(`Day ${updated.day_index} approved`);
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
      patchPost(await api.detachPostMedia(tenantId, post.id, mediaId));
      setToast("Media removed from post");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Detach failed");
    } finally {
      setBusyId(null);
    }
  }

  function copyPack(post: ContentPost) {
    const pack = [
      post.caption,
      "",
      post.cta ? `CTA: ${post.cta}` : "",
      (post.hashtags || []).join(" "),
      post.graphic_url ? `Graphic: ${post.graphic_url}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    void navigator.clipboard.writeText(pack);
    setToast("Caption + hashtags + CTA copied");
  }

  function shareWhatsApp(post: ContentPost) {
    const text = encodeURIComponent(
      `${post.caption}\n\n${(post.hashtags || []).join(" ")}${post.cta ? `\n\n${post.cta}` : ""}`,
    );
    window.open(`https://wa.me/?text=${text}`, "_blank", "noopener,noreferrer");
  }

  async function regeneratePost(post: ContentPost, brief: GenerationBrief = {}) {
    if (!tenantId) return;
    setBusyId(post.id);
    setStreamingPostId(post.id);
    setStreamStatus("Starting rewrite…");
    setError(null);
    setRegenTarget(null);
    setSelectedPost(post);
    // Clear caption for typing effect
    patchPost({ ...post, caption: "", cta: "", hashtags: [] });
    setSelectedPost({ ...post, caption: "", cta: "", hashtags: [] });
    try {
      await api.regeneratePostStream(tenantId, post.id, brief, {
        onStatus: (message) => setStreamStatus(message),
        onCaption: (text) => {
          setSelectedPost((cur) => (cur && cur.id === post.id ? { ...cur, caption: text } : cur));
          setActive((prev) =>
            prev
              ? {
                  ...prev,
                  posts: prev.posts.map((x) =>
                    x.id === post.id ? { ...x, caption: text } : x,
                  ),
                }
              : prev,
          );
        },
        onCta: (text) => {
          setSelectedPost((cur) => (cur && cur.id === post.id ? { ...cur, cta: text } : cur));
        },
        onHashtags: (tags) => {
          setSelectedPost((cur) =>
            cur && cur.id === post.id ? { ...cur, hashtags: tags } : cur,
          );
        },
        onDone: (updated) => {
          patchPost(updated);
          setSelectedPost(updated);
          setToast(`Day ${updated.day_index} regenerated`);
          setStreamStatus(null);
        },
        onError: (message) => {
          setError(message);
          setStreamStatus(null);
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Regenerate failed");
      setStreamStatus(null);
      // reload original
      try {
        const full = await api.getCampaign(tenantId, post.campaign_id);
        setActive(full);
        const restored = full.posts.find((p) => p.id === post.id);
        if (restored) setSelectedPost(restored);
      } catch {
        /* ignore */
      }
    } finally {
      setBusyId(null);
      setStreamingPostId(null);
      setStreamStatus(null);
    }
  }

  const postsByDay = useMemo(() => {
    const map = new Map<number, ContentPost>();
    active?.posts.forEach((p) => {
      const day = new Date(p.scheduled_date).getUTCDate();
      map.set(day, p);
    });
    return map;
  }, [active]);

  const daysInMonth = active ? new Date(active.year, active.month, 0).getDate() : 31;

  const counts = useMemo(() => {
    const posts = active?.posts || [];
    return {
      total: posts.length,
      approved: posts.filter((p) => p.status === "approved").length,
      draft: posts.filter((p) => p.status === "draft").length,
    };
  }, [active]);

  return (
    <div className="mk-cal mx-auto max-w-6xl">
      <PageHero
        eyebrow="AI Marketing"
        title="Content Calendar"
        description={
          <>
            Review, approve, and regenerate daily posts for{" "}
            <span className="font-medium text-foreground">
              {profile?.business_name || "your business"}
            </span>
            .
            {active?.generation_provider && (
              <p className="mt-2 text-xs text-muted">
                Plan by{" "}
                <span className="font-semibold capitalize text-brand">
                  {active.generation_provider}
                </span>
                {active.generation_model ? ` · ${active.generation_model}` : ""}
              </p>
            )}
          </>
        }
        action={
          <motion.button
            onClick={() => setShowGenerateBrief(true)}
            disabled={generating || needsOnboarding}
            whileHover={{ scale: needsOnboarding ? 1 : 1.02 }}
            whileTap={{ scale: needsOnboarding ? 1 : 0.98 }}
            className="rounded-full bg-brand-deep px-6 py-3 text-sm font-semibold text-white shadow-[0_8px_24px_rgba(8,53,38,0.2)] disabled:opacity-50"
          >
            {generating ? "Generating…" : "Generate 30-day plan"}
          </motion.button>
        }
      />

      {needsOnboarding && (
        <div className="mt-6 rounded-2xl border border-accent/40 bg-accent/20 px-5 py-4 text-sm text-accent-ink">
          Finish onboarding first so Peju can write in your brand voice.{" "}
          <Link href="/app/onboarding" className="font-semibold underline">
            Continue setup
          </Link>
        </div>
      )}

      {error && <p className="mt-4 text-sm text-danger">{error}</p>}

      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-4 rounded-2xl border border-brand/20 bg-brand/10 px-4 py-3 text-sm font-medium text-brand-deep"
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {generating && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-6 flex items-center gap-4 rounded-[1.5rem] border border-line bg-surface px-5 py-4"
          >
            <motion.div
              className="h-10 w-10 rounded-full border-2 border-brand/20 border-t-brand"
              animate={{ rotate: 360 }}
              transition={{ duration: 0.9, repeat: Infinity, ease: "linear" }}
            />
            <div>
              <p className="font-display font-semibold text-brand-deep">
                Crafting strategy + calendar
              </p>
              <p className="text-sm text-muted">Using your business memory…</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {!active && !generating && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mt-10 rounded-[1.75rem] border border-dashed border-line bg-surface/60 px-6 py-16 text-center"
        >
          <p className="font-display text-2xl font-bold text-brand-deep">No campaigns yet</p>
          <p className="mx-auto mt-2 max-w-md text-muted">
            Generate a month of posts, then approve or rewrite any day from the calendar.
          </p>
        </motion.div>
      )}

      {active && (
        <div className="mt-8 space-y-5">
          <div className="overflow-hidden rounded-[1.75rem] border border-line bg-surface">
            <div className="relative border-b border-line bg-gradient-to-br from-brand-deep via-[#0a4a34] to-brand px-6 py-6 text-white md:px-8">
              <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-accent/20 blur-2xl" />
              <div className="relative flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-accent">
                    Active campaign
                  </p>
                  <h2 className="font-display mt-1 text-2xl font-bold md:text-3xl">
                    {MONTHS[active.month - 1]} {active.year}
                  </h2>
                  <p className="mt-1 text-sm text-white/70">{active.title}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      if (!tenantId || !active) return;
                      const md = await api.exportCampaignMarkdown(tenantId, active.id);
                      const blob = new Blob([md], { type: "text/markdown" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `peju-campaign-${active.month}-${active.year}.md`;
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                    className="rounded-full border border-white/25 bg-white/10 px-3.5 py-1.5 text-xs font-semibold backdrop-blur"
                  >
                    Export
                  </button>
                  <Toggle active={view === "month"} onClick={() => setView("month")} dark>
                    Calendar
                  </Toggle>
                  <Toggle active={view === "list"} onClick={() => setView("list")} dark>
                    List
                  </Toggle>
                </div>
              </div>
              <p className="relative mt-4 max-w-3xl text-sm leading-relaxed text-white/80">
                {active.strategy_summary}
              </p>
              <div className="relative mt-5 grid grid-cols-3 gap-2 sm:max-w-md">
                <StatChip label="Posts" value={counts.total} />
                <StatChip label="Approved" value={counts.approved} />
                <StatChip label="Drafts" value={counts.draft} />
              </div>
            </div>

            {view === "month" ? (
              <div className="p-4 md:p-6">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <h3 className="font-display text-lg font-semibold text-brand-deep">
                    Interactive month grid
                  </h3>
                  <div className="flex flex-wrap gap-3 text-[11px] text-muted">
                    <Legend color="#d6f56a" label="Has post" />
                    <Legend color="#117a4f" label="Approved" />
                    <Legend color="#9aa89f" label="Draft" />
                  </div>
                </div>

                <div className="grid grid-cols-7 gap-1.5 text-center text-[10px] font-semibold uppercase tracking-wide text-muted sm:gap-2 sm:text-xs">
                  {WEEKDAYS.map((d) => (
                    <div key={d} className="py-1">
                      {d}
                    </div>
                  ))}
                </div>

                <div className="mt-1 grid grid-cols-7 gap-1.5 sm:gap-2">
                  {calendarCells(active.year, active.month, daysInMonth).map((cell, idx) => {
                    if (!cell) return <div key={`e-${idx}`} className="min-h-[5.5rem]" />;
                    const post = postsByDay.get(cell);
                    const selected = selectedPost?.id === post?.id;
                    const approved = post?.status === "approved";
                    return (
                      <motion.div
                        key={cell}
                        whileHover={post ? { scale: 1.02 } : undefined}
                        whileTap={post ? { scale: 0.98 } : undefined}
                        className={`mk-day p-2 text-left ${post ? "has-post cursor-pointer" : "opacity-40"} ${
                          approved ? "approved" : ""
                        } ${selected ? "selected" : ""}`}
                        onClick={() => post && setSelectedPost(post)}
                        onKeyDown={(e) => {
                          if (post && (e.key === "Enter" || e.key === " ")) {
                            e.preventDefault();
                            setSelectedPost(post);
                          }
                        }}
                        role={post ? "button" : undefined}
                        tabIndex={post ? 0 : undefined}
                      >
                        <div className="flex items-start justify-between gap-1">
                          <p className="font-display text-sm font-bold text-brand-deep">{cell}</p>
                          {post && (
                            <span
                              className="mk-status-dot mt-1"
                              style={{
                                background: approved ? "#117a4f" : "#9aa89f",
                                color: approved ? "#117a4f" : "#9aa89f",
                              }}
                            />
                          )}
                        </div>
                        {post && (
                          <>
                            <p className="mt-1.5 line-clamp-2 text-[10px] font-semibold leading-snug text-brand-deep/90 sm:text-[11px]">
                              {post.theme}
                            </p>
                            <p className="mt-1 text-[9px] capitalize text-muted sm:text-[10px]">
                              {post.platform}
                            </p>
                            <div className="mt-2 hidden gap-1 sm:flex">
                              <button
                                type="button"
                                disabled={busyId === post.id || approved}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (!approved) approvePost(post);
                                }}
                                className={`rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide disabled:opacity-70 ${
                                  approved
                                    ? "bg-brand/15 text-brand"
                                    : "bg-brand-deep text-white hover:bg-brand"
                                }`}
                              >
                                {approved ? "OK" : "Approve"}
                              </button>
                            </div>
                          </>
                        )}
                      </motion.div>
                    );
                  })}
                </div>
                <p className="mt-4 text-center text-xs text-muted md:text-left">
                  Click any day to open the post · Approve or regenerate from the panel
                </p>
              </div>
            ) : (
              <div className="space-y-2 p-4 md:p-6">
                {active.posts.map((post, i) => (
                  <motion.button
                    key={post.id}
                    type="button"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.015 }}
                    onClick={() => setSelectedPost(post)}
                    className="flex w-full items-start justify-between gap-3 rounded-2xl border border-line bg-gradient-to-r from-white to-surface-soft/50 px-4 py-4 text-left transition hover:border-brand/35"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                        <span className="font-display font-bold text-brand-deep">
                          Day {post.day_index}
                        </span>
                        <span className="capitalize">{post.platform}</span>
                        <span>{post.theme}</span>
                      </div>
                      <p className="mt-2 line-clamp-2 text-sm text-foreground/90">{post.caption}</p>
                    </div>
                    <StatusBadge status={post.status} />
                  </motion.button>
                ))}
              </div>
            )}
          </div>

          {campaigns.length > 1 && (
            <div>
              <h3 className="font-display text-sm font-semibold text-muted">Earlier campaigns</h3>
              <div className="mt-2 flex flex-wrap gap-2">
                {campaigns.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={async () => {
                      if (!tenantId) return;
                      setActive(await api.getCampaign(tenantId, c.id));
                      setSelectedPost(null);
                    }}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
                      active?.id === c.id
                        ? "border-brand-deep bg-brand-deep text-white"
                        : "border-line text-muted hover:text-brand-deep"
                    }`}
                  >
                    {MONTHS[c.month - 1].slice(0, 3)} {c.year}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <AnimatePresence>
        {selectedPost && tenantId && (
          <PostDrawer
            post={selectedPost}
            tenantId={tenantId}
            busy={busyId === selectedPost.id}
            streaming={streamingPostId === selectedPost.id}
            streamStatus={streamStatus}
            onClose={() => {
              if (streamingPostId === selectedPost.id) return;
              setSelectedPost(null);
            }}
            onApprove={() => approvePost(selectedPost)}
            onGenerateGraphic={() => setMediaPost(selectedPost)}
            onDetachMedia={(mediaId) => detachMedia(selectedPost, mediaId)}
            onSaved={(p) => {
              patchPost(p);
              setToast("Post updated");
            }}
            onCopyPack={() => copyPack(selectedPost)}
            onWhatsApp={() => shareWhatsApp(selectedPost)}
            onDraft={async () => {
              setBusyId(selectedPost.id);
              try {
                patchPost(await api.updatePostStatus(tenantId, selectedPost.id, "draft"));
                setToast("Moved back to draft");
              } finally {
                setBusyId(null);
              }
            }}
            onRegenerate={() => setRegenTarget(selectedPost)}
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
            patchPost(p);
            setToast(
              `Media updated for day ${p.day_index}${
                p.media_count ? ` · ${p.media_count} asset(s)` : ""
              }`,
            );
          }}
        />
      )}

      {tenantId && (
        <>
          <GenerationBriefModal
            open={showGenerateBrief}
            mode="month"
            tenantId={tenantId}
            title="Generate a marketing plan"
            subtitle="Choose the month and year, then optionally shape tone & focus — or skip to use brand defaults."
            confirmLabel="Generate plan"
            busy={generating}
            onClose={() => setShowGenerateBrief(false)}
            onConfirm={generate}
          />
          <GenerationBriefModal
            open={!!regenTarget}
            mode="day"
            tenantId={tenantId}
            title={regenTarget ? `Regenerate day ${regenTarget.day_index}` : "Regenerate day"}
            subtitle="Optional tone, occasion, or focus. Empty fields still regenerate from brand memory."
            confirmLabel="Regenerate this day"
            busy={!!regenTarget && busyId === regenTarget.id}
            onClose={() => setRegenTarget(null)}
            onConfirm={(brief) => regenTarget && regeneratePost(regenTarget, brief)}
          />
        </>
      )}

      {generating && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-brand-deep/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-[1.5rem] border border-line bg-surface p-6 shadow-2xl">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-brand">
              Generating plan
            </p>
            <h3 className="font-display mt-2 text-2xl font-bold text-brand-deep">
              Writing your 30-day captions…
            </h3>
            <p className="mt-2 text-sm text-muted">
              Peju is drafting strategy, themes, and daily copy. This stays open until the calendar
              is ready.
            </p>
            <div className="mt-5 h-2 overflow-hidden rounded-full bg-surface-soft">
              <motion.div
                className="h-full rounded-full bg-brand"
                initial={{ width: "8%" }}
                animate={{ width: ["12%", "55%", "78%", "92%"] }}
                transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
              />
            </div>
            <div className="mt-4 space-y-2 font-mono text-xs text-brand-deep/80">
              <TypingLine text="Opening brand memory…" delay={0} />
              <TypingLine text="Planning content pillars…" delay={0.8} />
              <TypingLine text="Drafting captions day by day…" delay={1.6} />
              <TypingLine text="Adding hashtags & CTAs…" delay={2.4} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TypingLine({ text, delay }: { text: string; delay: number }) {
  return (
    <motion.p
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay, duration: 0.4 }}
      className="flex items-center gap-2"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-brand" />
      {text}
      <motion.span
        animate={{ opacity: [0, 1, 0] }}
        transition={{ delay: delay + 0.4, duration: 1.1, repeat: Infinity }}
        className="inline-block h-3 w-0.5 bg-brand"
      />
    </motion.p>
  );
}

const PLATFORMS = [
  { id: "instagram", label: "Instagram" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "facebook", label: "Facebook" },
  { id: "tiktok", label: "TikTok" },
  { id: "linkedin", label: "LinkedIn" },
  { id: "twitter", label: "X / Twitter" },
] as const;

function PostDrawer({
  post,
  tenantId,
  busy,
  streaming,
  streamStatus,
  onClose,
  onApprove,
  onDraft,
  onRegenerate,
  onGenerateGraphic,
  onDetachMedia,
  onSaved,
  onCopyPack,
  onWhatsApp,
}: {
  post: ContentPost;
  tenantId: string;
  busy: boolean;
  streaming?: boolean;
  streamStatus?: string | null;
  onClose: () => void;
  onApprove: () => void;
  onDraft: () => void;
  onRegenerate: () => void;
  onGenerateGraphic: () => void;
  onDetachMedia: (mediaId: string) => void;
  onSaved: (post: ContentPost) => void;
  onCopyPack: () => void;
  onWhatsApp: () => void;
}) {
  const approved = post.status === "approved";
  const media = post.media?.length
    ? post.media
    : post.graphic_url
      ? [{ id: "legacy", url: post.graphic_url }]
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
    setEditError(null);
  }, [post.id, post.caption, post.cta, post.hashtags, post.platform]);

  const dirty =
    caption !== post.caption ||
    cta !== (post.cta || "") ||
    hashtagsText.trim() !== (post.hashtags || []).join(" ") ||
    platform !== post.platform;

  async function saveEdits() {
    setSaving(true);
    setEditError(null);
    try {
      const hashtags = hashtagsText
        .split(/[\s,]+/)
        .map((t) => t.trim())
        .filter(Boolean)
        .map((t) => (t.startsWith("#") ? t : `#${t}`));
      const updated = await api.updatePost(tenantId, post.id, {
        caption,
        cta: cta || null,
        hashtags,
        platform,
      });
      onSaved(updated);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  async function savePlatformOnly(next: string) {
    setPlatform(next);
    if (next === post.platform) return;
    setSaving(true);
    setEditError(null);
    try {
      const updated = await api.updatePost(tenantId, post.id, { platform: next });
      onSaved(updated);
    } catch (err) {
      setPlatform(post.platform);
      setEditError(err instanceof Error ? err.message : "Could not change platform");
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
        className="absolute inset-0 bg-brand-deep/30 backdrop-blur-[2px] md:bg-brand-deep/25"
        onClick={onClose}
      />
      <motion.aside
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", stiffness: 280, damping: 30 }}
        className="relative z-10 flex h-full w-full max-w-full flex-col overflow-y-auto border-l border-line bg-surface shadow-2xl sm:max-w-md md:max-w-xl lg:max-w-[36rem]"
      >
        <div className="border-b border-line bg-gradient-to-br from-brand-deep to-brand px-6 py-5 text-white md:px-8 md:py-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-accent">
                Day {post.day_index} · {new Date(post.scheduled_date).toUTCString().slice(0, 16)}
              </p>
              <h3 className="font-display mt-1 text-2xl font-bold capitalize md:text-3xl">
                {platform}
              </h3>
              <p className="mt-1 text-sm text-white/75">{post.theme}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={!!streaming}
              className="rounded-full border border-white/20 px-3 py-1 text-xs disabled:opacity-50"
            >
              Close
            </button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <StatusBadge status={post.status} light />
            {streaming && (
              <span className="rounded-full bg-accent/90 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-accent-ink">
                Writing…
              </span>
            )}
          </div>
        </div>

        <div className="space-y-5 px-6 py-5 text-sm md:px-8">
          {streaming && (
            <div className="rounded-2xl border border-brand/25 bg-brand/5 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 animate-pulse rounded-full bg-brand" />
                <p className="text-sm font-semibold text-brand-deep">
                  {streamStatus || "AI is drafting…"}
                </p>
              </div>
              <p className="mt-1 text-xs text-muted">
                Caption is typing in live — platform stays as you set it.
              </p>
            </div>
          )}

          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">
              Platform
            </p>
            <p className="mt-1 text-[11px] text-muted">
              Change where this post is for — caption & hashtags stay the same.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {PLATFORMS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  disabled={busy || streaming || saving}
                  onClick={() => savePlatformOnly(p.id)}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${
                    platform === p.id
                      ? "bg-brand-deep text-white"
                      : "border border-line text-muted hover:border-brand/40"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">Caption</p>
              <span className="text-[10px] text-muted">
                {streaming ? "Streaming" : "Editable"}
              </span>
            </div>
            <div className="relative mt-2">
              <textarea
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                rows={6}
                readOnly={!!streaming}
                className={`w-full rounded-2xl border border-line bg-surface-soft/40 px-3.5 py-3 text-sm leading-relaxed text-foreground outline-none ring-brand/30 focus:ring-2 ${
                  streaming ? "border-brand/40" : ""
                }`}
              />
              {streaming && (
                <span className="pointer-events-none absolute bottom-3 right-3 inline-block h-4 w-0.5 animate-pulse bg-brand" />
              )}
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">CTA</p>
            <input
              value={cta}
              onChange={(e) => setCta(e.target.value)}
              readOnly={!!streaming}
              placeholder="Add a call to action…"
              className="mt-2 w-full rounded-2xl border border-line bg-surface-soft/40 px-3.5 py-2.5 text-sm outline-none ring-brand/30 focus:ring-2"
            />
          </div>

          <div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">Hashtags</p>
              <span className="text-[10px] text-muted">Space or comma separated</span>
            </div>
            <textarea
              value={hashtagsText}
              onChange={(e) => setHashtagsText(e.target.value)}
              readOnly={!!streaming}
              rows={2}
              placeholder="#lagos #fashion #shop"
              className="mt-2 w-full rounded-2xl border border-line bg-surface-soft/40 px-3.5 py-2.5 text-sm text-brand-deep outline-none ring-brand/30 focus:ring-2"
            />
          </div>

          {dirty && !streaming && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={saving || busy}
                onClick={saveEdits}
                className="rounded-full bg-brand-deep px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save caption & hashtags"}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  setCaption(post.caption);
                  setCta(post.cta || "");
                  setHashtagsText((post.hashtags || []).join(" "));
                  setPlatform(post.platform);
                }}
                className="rounded-full border border-line px-3 py-2 text-xs text-muted"
              >
                Reset
              </button>
            </div>
          )}
          {editError && <p className="text-sm text-danger">{editError}</p>}

          <Block title="Graphic prompt" body={post.graphic_prompt || "—"} />

          <div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                Media ({media.length})
              </p>
              <button
                type="button"
                disabled={busy || streaming}
                onClick={onGenerateGraphic}
                className="text-xs font-semibold text-brand hover:underline disabled:opacity-50"
              >
                + Add more
              </button>
            </div>
            {media.length === 0 ? (
              <button
                type="button"
                disabled={busy || streaming}
                onClick={onGenerateGraphic}
                className="mt-2 w-full rounded-2xl border border-dashed border-line px-4 py-8 text-sm text-muted hover:border-brand/40 hover:text-brand disabled:opacity-50"
              >
                No media yet — AI generate, upload, or pick from library
              </button>
            ) : (
              <div className="mt-2 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                {media.map((m) => (
                  <div
                    key={m.id}
                    className="group relative overflow-hidden rounded-xl border border-line bg-surface-soft"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={m.url}
                      alt={`Day ${post.day_index} media`}
                      className="aspect-square w-full object-cover"
                    />
                    {m.id !== "legacy" && (
                      <button
                        type="button"
                        disabled={busy || streaming}
                        aria-label="Remove from post"
                        title="Remove from this post (keeps in Media library)"
                        onClick={() => onDetachMedia(m.id)}
                        className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-sm font-bold text-white shadow-md transition hover:bg-danger disabled:opacity-50 md:opacity-90"
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  disabled={busy || streaming}
                  onClick={onGenerateGraphic}
                  className="flex aspect-square items-center justify-center rounded-xl border border-dashed border-line text-2xl text-muted transition hover:border-brand/40 hover:text-brand disabled:opacity-50"
                  aria-label="Add media"
                >
                  +
                </button>
              </div>
            )}
            <p className="mt-2 text-[11px] text-muted">
              × removes from this post only — your Media library keeps the file.
            </p>
          </div>
        </div>

        <div className="mt-auto space-y-2 border-t border-line bg-surface-soft/40 px-6 py-5 md:px-8">
          <button
            type="button"
            disabled={busy || approved || streaming}
            onClick={onApprove}
            className="w-full rounded-full bg-brand-deep py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Working…" : approved ? "Already approved" : "Approve this day"}
          </button>
          <button
            type="button"
            disabled={busy || streaming}
            onClick={onGenerateGraphic}
            className="w-full rounded-full border border-brand/30 bg-accent/40 py-3 text-sm font-semibold text-accent-ink disabled:opacity-50"
          >
            Add media (AI / upload / library)
          </button>
          <button
            type="button"
            disabled={busy || streaming}
            onClick={onRegenerate}
            className="w-full rounded-full border border-brand/30 py-3 text-sm font-semibold text-brand-deep disabled:opacity-50"
          >
            {streaming ? "Writing caption…" : busy ? "Rewriting…" : "Regenerate caption with AI"}
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={streaming}
              onClick={onCopyPack}
              className="rounded-full border border-line py-2.5 text-sm font-medium text-muted disabled:opacity-50"
            >
              Export / copy
            </button>
            <button
              type="button"
              disabled={streaming}
              onClick={onWhatsApp}
              className="rounded-full border border-line py-2.5 text-sm font-medium text-muted disabled:opacity-50"
            >
              WhatsApp
            </button>
          </div>
          <button
            type="button"
            disabled={busy || streaming}
            onClick={onDraft}
            className="w-full rounded-full border border-line py-2.5 text-sm font-medium text-muted disabled:opacity-50"
          >
            Keep as draft
          </button>
        </div>
      </motion.aside>
    </motion.div>
  );
}

function StatChip({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-white/15 bg-white/10 px-3 py-2 backdrop-blur">
      <p className="text-[9px] uppercase tracking-wider text-white/60">{label}</p>
      <p className="font-display text-xl font-bold">{value}</p>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-2 w-2 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

function StatusBadge({ status, light }: { status: string; light?: boolean }) {
  const approved = status === "approved";
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${
        light
          ? approved
            ? "bg-accent text-accent-ink"
            : "bg-white/15 text-white"
          : approved
            ? "bg-brand/15 text-brand"
            : "bg-surface-soft text-muted"
      }`}
    >
      {status}
    </span>
  );
}

function Toggle({
  active,
  onClick,
  children,
  dark,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  dark?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3.5 py-1.5 text-xs font-semibold ${
        dark
          ? active
            ? "bg-accent text-accent-ink"
            : "bg-white/10 text-white/80"
          : active
            ? "bg-brand-deep text-white"
            : "bg-surface-soft text-muted"
      }`}
    >
      {children}
    </button>
  );
}

function calendarCells(year: number, month: number, daysInMonth: number) {
  const firstDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const cells: (number | null)[] = Array(firstDow).fill(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  return cells;
}

function Block({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-muted">{title}</p>
      <p className="mt-2 whitespace-pre-wrap leading-relaxed text-foreground/90">{body}</p>
    </div>
  );
}
