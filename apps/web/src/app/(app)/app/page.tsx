"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useApp } from "@/components/app-shell";
import { IconSpark } from "@/components/nav-icons";
import { api, type ContentPost } from "@/lib/api";

const ease = [0.22, 1, 0.36, 1] as const;

type Activity = Awaited<ReturnType<typeof api.activity>>;
type Overview = Awaited<ReturnType<typeof api.marketingOverview>>;
type Subscription = Awaited<ReturnType<typeof api.getSubscription>>;

export default function AppDashboardPage() {
  const { me, profile, tenantId, tenantName, needsOnboarding } = useApp();
  const [activity, setActivity] = useState<Activity>([]);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    api.activity(tenantId).then(setActivity).catch(() => setActivity([]));
    api
      .marketingOverview(tenantId)
      .then(setOverview)
      .catch(() =>
        setOverview({
          campaigns: 0,
          draft_posts: 0,
          approved_posts: 0,
          published_posts: 0,
          latest_campaign: null,
          upcoming_posts: [],
          approval_queue: [],
        }),
      );
    api.getSubscription(tenantId).then(setSubscription).catch(() => setSubscription(null));
  }, [tenantId]);

  const firstName = me?.user.full_name?.split(" ")[0] ?? "there";
  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    return "Good evening";
  }, []);

  const progress = needsOnboarding
    ? 35
    : overview && overview.campaigns > 0
      ? Math.min(
          100,
          55 +
            Math.round(
              (overview.approved_posts / Math.max(overview.draft_posts + overview.approved_posts, 1)) *
                45,
            ),
        )
      : 55;

  const approvalRate = overview
    ? Math.round(
        (overview.approved_posts /
          Math.max(
            overview.draft_posts + overview.approved_posts + overview.published_posts,
            1,
          )) *
          100,
      )
    : null;

  return (
    <div className="mx-auto max-w-6xl">
      {/* Hero — one composition */}
      <motion.section
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.65, ease }}
        className="studio-hero relative overflow-hidden rounded-[1.75rem] px-5 py-7 text-white sm:px-8 sm:py-9 md:rounded-[2rem] md:px-10 md:py-11"
      >
        <div className="peju-drift pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-accent/20 blur-3xl" />
        <div className="peju-drift-slow pointer-events-none absolute -bottom-24 left-1/4 h-48 w-48 rounded-full bg-white/10 blur-3xl" />

        <div className="relative flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-accent">
              {tenantName}
            </p>
            <h1 className="font-display mt-3 text-[2rem] font-extrabold leading-[1.05] tracking-tight sm:text-4xl md:text-5xl">
              {greeting}, {firstName}
            </h1>
            <p className="mt-3 max-w-lg text-sm leading-relaxed text-white/65 sm:text-base">
              Your AI marketing department is ready — generate a month of content, approve drafts,
              and keep your brand moving.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Link
                href={needsOnboarding ? "/app/onboarding" : "/app/marketing"}
                className="inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-sm font-bold text-accent-ink shadow-[0_0_32px_var(--glow)] transition hover:scale-[1.02]"
              >
                <IconSpark className="h-4 w-4" />
                {needsOnboarding
                  ? "Finish setup"
                  : overview?.campaigns
                    ? "Open campaign"
                    : "Generate 30-day plan"}
              </Link>
              <Link
                href="/app/content"
                className="inline-flex rounded-full border border-white/20 bg-white/5 px-5 py-2.5 text-sm font-semibold text-white/90 backdrop-blur transition hover:bg-white/10"
              >
                Review drafts
                {overview && overview.draft_posts > 0 && (
                  <span className="ml-2 rounded-full bg-accent/30 px-2 py-0.5 text-[11px] font-bold text-accent">
                    {overview.draft_posts}
                  </span>
                )}
              </Link>
            </div>
          </div>

          <div className="relative w-full max-w-xs shrink-0 lg:text-right">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45">
              Workspace pulse
            </p>
            <p className="font-display mt-2 text-5xl font-bold tabular-nums text-white md:text-6xl">
              {progress}
              <span className="text-2xl text-accent">%</span>
            </p>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/15">
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-accent to-white"
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.9, ease, delay: 0.15 }}
              />
            </div>
            <p className="mt-2 text-xs text-white/50">
              {needsOnboarding
                ? "Complete onboarding to unlock generation"
                : overview?.campaigns
                  ? "Campaign live — keep approving"
                  : "Ready for your first plan"}
            </p>
            {subscription && (
              <p className="mt-3 text-xs font-medium capitalize text-white/70">
                {subscription.plan}
                {subscription.status === "trialing" && subscription.days_remaining != null
                  ? ` · ${subscription.days_remaining}d trial`
                  : ""}
              </p>
            )}
          </div>
        </div>
      </motion.section>

      {/* Metrics — one row, not a card dashboard */}
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08, duration: 0.5, ease }}
        className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-[1.35rem] border border-line/80 bg-line/80 sm:grid-cols-4"
      >
        <Metric label="Campaigns" value={String(overview?.campaigns ?? 0)} />
        <Metric label="Awaiting" value={String(overview?.draft_posts ?? 0)} highlight />
        <Metric label="Approved" value={String(overview?.approved_posts ?? 0)} />
        <Metric label="Approval rate" value={approvalRate != null ? `${approvalRate}%` : "—"} />
      </motion.div>

      {needsOnboarding ? (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.12, duration: 0.45, ease }}
          className="mt-6 overflow-hidden rounded-[1.5rem] border border-accent/40 bg-accent/20 px-5 py-6 sm:px-7"
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-display text-xl font-bold text-brand-deep">Complete your brand memory</p>
              <p className="mt-1 max-w-lg text-sm text-muted">
                Voice, audience, and goals unlock captions that sound like {tenantName}.
              </p>
            </div>
            <Link
              href="/app/onboarding"
              className="inline-flex shrink-0 rounded-full bg-brand-deep px-5 py-2.5 text-sm font-bold text-white"
            >
              Continue onboarding
            </Link>
          </div>
        </motion.div>
      ) : (
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.12, duration: 0.45, ease }}
          className="mt-8"
        >
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2 className="font-display text-xl font-bold text-brand-deep sm:text-2xl">
                Move your marketing
              </h2>
              <p className="mt-1 text-sm text-muted">One clear next step for today.</p>
            </div>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
            <Link
              href="/app/marketing"
              className="group relative overflow-hidden rounded-[1.5rem] bg-brand-deep px-6 py-7 text-white sm:px-8"
            >
              <div className="peju-drift pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-accent/25 blur-2xl" />
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
                Primary
              </p>
              <h3 className="font-display mt-2 text-2xl font-bold sm:text-3xl">
                {overview?.campaigns ? "Continue your plan" : "Launch a 30-day campaign"}
              </h3>
              <p className="mt-2 max-w-md text-sm text-white/65">
                Strategy, calendar, captions, hashtags & graphics for{" "}
                {profile?.industry || "your industry"}.
              </p>
              <span className="mt-6 inline-flex items-center gap-2 text-sm font-bold text-accent transition group-hover:gap-3">
                Open AI Marketing <span aria-hidden>→</span>
              </span>
            </Link>

            <div className="studio-glass rounded-[1.5rem] px-6 py-6">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
                Brand
              </p>
              <p className="font-display mt-2 text-xl font-bold text-brand-deep">
                {profile?.business_name}
              </p>
              <p className="mt-0.5 text-sm text-muted">{profile?.industry}</p>
              <p className="mt-4 line-clamp-4 text-sm leading-relaxed text-foreground/80">
                {profile?.brand_voice || "Brand voice saved during onboarding."}
              </p>
              <Link
                href="/app/settings"
                className="mt-5 inline-flex text-sm font-semibold text-brand hover:underline"
              >
                Edit profile
              </Link>
            </div>
          </div>
        </motion.section>
      )}

      {/* Queues */}
      <div className="mt-10 grid gap-8 lg:grid-cols-2">
        <Queue
          title="Needs approval"
          href="/app/content"
          action="Open library"
          empty="No drafts waiting. Generate a campaign to fill your queue."
          items={overview?.approval_queue || []}
        />
        <Queue
          title="Coming up"
          href="/app/marketing"
          action="Calendar"
          empty="Nothing scheduled yet. Your next posts will appear here."
          items={overview?.upcoming_posts || []}
          showDate
        />
      </div>

      {/* Activity + shortcuts */}
      <div className="mt-10 grid gap-8 lg:grid-cols-[1.2fr_0.8fr]">
        <section>
          <h2 className="font-display text-xl font-bold text-brand-deep">Recent activity</h2>
          <ul className="mt-4 space-y-0 divide-y divide-line/80 border-y border-line/80">
            {activity.length === 0 && (
              <li className="py-8 text-sm text-muted">
                Generation, approvals, and billing events will show here.
              </li>
            )}
            {activity.slice(0, 6).map((item, i) => (
              <motion.li
                key={item.id}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.03 * i, duration: 0.35, ease }}
                className="flex items-start justify-between gap-4 py-3.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-brand-deep">{item.title}</p>
                  <p className="mt-0.5 text-xs text-muted">{item.event_type}</p>
                </div>
                <time className="shrink-0 text-[11px] tabular-nums text-muted">
                  {new Date(item.created_at).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
              </motion.li>
            ))}
          </ul>
        </section>

        <section>
          <h2 className="font-display text-xl font-bold text-brand-deep">Shortcuts</h2>
          <div className="mt-4 space-y-2">
            <Shortcut href="/app/marketing" title="Create 30-day plan" body="AI strategy + calendar" />
            <Shortcut
              href="/app/content"
              title="Approve drafts"
              body={`${overview?.draft_posts ?? 0} waiting`}
            />
            <Shortcut href="/app/media" title="Media library" body="Uploads & AI graphics" />
            <Shortcut href="/app/settings" title="Billing & profile" body="Trial, Paystack, Flutterwave" />
          </div>
        </section>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className={`bg-surface px-4 py-4 sm:px-5 sm:py-5 ${highlight ? "bg-accent/15" : ""}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">{label}</p>
      <p className="font-display mt-1.5 text-2xl font-bold tabular-nums text-brand-deep sm:text-3xl">
        {value}
      </p>
    </div>
  );
}

function Queue({
  title,
  href,
  action,
  empty,
  items,
  showDate,
}: {
  title: string;
  href: string;
  action: string;
  empty: string;
  items: ContentPost[];
  showDate?: boolean;
}) {
  return (
    <section>
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-xl font-bold text-brand-deep">{title}</h2>
        <Link href={href} className="text-sm font-semibold text-brand hover:underline">
          {action}
        </Link>
      </div>
      <div className="mt-4 space-y-3">
        {items.length === 0 ? (
          <p className="rounded-[1.25rem] border border-dashed border-line px-4 py-10 text-center text-sm text-muted">
            {empty}
          </p>
        ) : (
          items.map((post, i) => (
            <motion.div
              key={post.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04, duration: 0.35, ease }}
              className="studio-glass rounded-[1.15rem] px-4 py-3.5"
            >
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium text-muted">
                <span className="rounded-md bg-brand/10 px-1.5 py-0.5 font-bold text-brand">
                  Day {post.day_index}
                </span>
                <span className="capitalize">{post.platform}</span>
                <span className="text-line">·</span>
                <span>{post.theme}</span>
                {showDate && (
                  <>
                    <span className="text-line">·</span>
                    <span>{new Date(post.scheduled_date).toLocaleDateString()}</span>
                  </>
                )}
              </div>
              <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-foreground/85">
                {post.caption}
              </p>
            </motion.div>
          ))
        )}
      </div>
    </section>
  );
}

function Shortcut({ href, title, body }: { href: string; title: string; body: string }) {
  return (
    <Link
      href={href}
      className="group flex items-center justify-between gap-3 rounded-[1.15rem] border border-transparent px-3.5 py-3.5 transition hover:border-line hover:bg-surface/80"
    >
      <div>
        <p className="text-sm font-semibold text-brand-deep">{title}</p>
        <p className="text-xs text-muted">{body}</p>
      </div>
      <span className="text-muted transition group-hover:translate-x-0.5 group-hover:text-brand" aria-hidden>
        →
      </span>
    </Link>
  );
}
