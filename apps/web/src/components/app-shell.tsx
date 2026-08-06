"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "@/lib/api";
import { BrandLogo, BrandLockup } from "@/components/brand-logo";
import {
  IconClose,
  IconContent,
  IconMarketing,
  IconMedia,
  IconMenu,
  IconOverview,
  IconSettings,
  IconSpark,
  IconTeam,
} from "@/components/nav-icons";

type Me = Awaited<ReturnType<typeof api.me>>;
type Profile = Awaited<ReturnType<typeof api.getBusinessProfile>>;

type AppContextValue = {
  me: Me | null;
  profile: Profile | null;
  tenantId: string | null;
  tenantName: string;
  loading: boolean;
  needsOnboarding: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
};

const AppContext = createContext<AppContextValue | null>(null);

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppShell");
  return ctx;
}

type NavItem = {
  href: string;
  label: string;
  short: string;
  Icon: ComponentType<{ className?: string }>;
  primary?: boolean;
};

const NAV: NavItem[] = [
  { href: "/app", label: "Overview", short: "Home", Icon: IconOverview },
  {
    href: "/app/marketing",
    label: "AI Marketing",
    short: "Create",
    Icon: IconMarketing,
    primary: true,
  },
  { href: "/app/content", label: "Content", short: "Drafts", Icon: IconContent },
  { href: "/app/media", label: "Media", short: "Media", Icon: IconMedia },
  { href: "/app/team", label: "Team", short: "Team", Icon: IconTeam },
  { href: "/app/settings", label: "Settings", short: "Settings", Icon: IconSettings },
];

const TAB_BAR: {
  href: string;
  label: string;
  Icon: ComponentType<{ className?: string }>;
  create?: boolean;
}[] = [
  { href: "/app", label: "Home", Icon: IconOverview },
  { href: "/app/content", label: "Drafts", Icon: IconContent },
  { href: "/app/marketing", label: "Create", Icon: IconSpark, create: true },
  { href: "/app/media", label: "Media", Icon: IconMedia },
  { href: "/app/settings", label: "Settings", Icon: IconSettings },
];

function isActive(pathname: string | null, href: string) {
  if (href === "/app") return pathname === "/app";
  return Boolean(pathname?.startsWith(href));
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const stored = localStorage.getItem("peju_tenant_id");
    const data = await api.me(stored);
    const tid = data.active_tenant?.id || data.memberships[0]?.tenant.id || stored;
    if (!tid) throw new Error("No tenant");
    localStorage.setItem("peju_tenant_id", tid);
    setMe(data);
    setTenantId(tid);
    try {
      setProfile(await api.getBusinessProfile(tid));
    } catch {
      setProfile(null);
    }
  }, []);

  useEffect(() => {
    refresh()
      .catch(() => router.replace("/login"))
      .finally(() => setLoading(false));
  }, [refresh, router]);

  const logout = useCallback(async () => {
    await api.logout();
    localStorage.removeItem("peju_tenant_id");
    router.push("/login");
  }, [router]);

  const tenantName =
    me?.active_tenant?.name || me?.memberships[0]?.tenant.name || "Workspace";

  // Memory init is the real "finished onboarding" flag (set only on final step)
  const needsOnboarding = !profile || !profile.memory_initialized;

  const value = useMemo(
    () => ({
      me,
      profile,
      tenantId,
      tenantName,
      loading,
      needsOnboarding,
      refresh,
      logout,
    }),
    [me, profile, tenantId, tenantName, loading, needsOnboarding, refresh, logout],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { me, tenantName, loading, logout, needsOnboarding, tenantId, profile } = useApp();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [trialDays, setTrialDays] = useState<number | null>(null);

  const isOnboarding = pathname?.startsWith("/app/onboarding");

  // Incomplete onboarding → always resume setup (any browser / return visit)
  useEffect(() => {
    if (loading || !me) return;
    if (needsOnboarding && !isOnboarding) {
      router.replace("/app/onboarding");
    }
  }, [loading, me, needsOnboarding, isOnboarding, router]);

  useEffect(() => {
    if (!tenantId || isOnboarding) return;
    api
      .getSubscription(tenantId)
      .then((s) => {
        if (s.status === "trialing") setTrialDays(s.days_remaining);
        else setTrialDays(null);
      })
      .catch(() => setTrialDays(null));
  }, [tenantId, isOnboarding]);

  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!drawerOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [drawerOpen]);

  if (loading || !me) {
    return (
      <div className="studio-shell flex min-h-screen items-center justify-center">
        <div className="relative">
          <motion.div
            className="h-14 w-14 rounded-full border-2 border-brand/15 border-t-brand"
            animate={{ rotate: 360 }}
            transition={{ duration: 0.85, repeat: Infinity, ease: "linear" }}
          />
          <motion.div
            className="absolute inset-2 rounded-full bg-accent/40 blur-md"
            animate={{ opacity: [0.35, 0.7, 0.35] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
          />
        </div>
      </div>
    );
  }

  // While redirecting incomplete users, keep the studio spinner (avoid flashing app chrome)
  if (needsOnboarding && !isOnboarding) {
    return (
      <div className="studio-shell flex min-h-screen items-center justify-center">
        <p className="text-sm text-white/70">Taking you to finish setup…</p>
      </div>
    );
  }

  if (isOnboarding) {
    return <>{children}</>;
  }

  const initials = (me.user.full_name || me.user.email || "P")
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="studio-shell relative min-h-screen lg:flex">
      {/* Desktop sidebar — flush left, full viewport height */}
      <aside className="studio-sidebar sticky top-0 z-30 hidden h-screen w-[292px] shrink-0 flex-col px-4 py-6 lg:flex">
        <div className="px-1">
          <BrandLockup href="/app" tone="dark" />
          <div className="studio-sidebar-chip mt-5 rounded-2xl px-3.5 py-3.5">
            <p className="chip-label text-[10px] font-bold uppercase tracking-[0.2em]">
              Workspace
            </p>
            <p className="mt-1.5 truncate font-display text-base font-bold text-white">
              {tenantName}
            </p>
            {profile?.industry && (
              <p className="chip-muted mt-0.5 truncate text-xs">{profile.industry}</p>
            )}
          </div>
        </div>

        <nav className="mt-8 flex flex-1 flex-col gap-1.5 overflow-y-auto px-0.5" aria-label="Main">
          <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.2em] text-white/35">
            Navigate
          </p>
          {NAV.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`studio-nav-link flex items-center gap-3 rounded-2xl px-3 py-3 text-[14px] font-semibold ${
                  active ? "is-active" : ""
                }`}
              >
                <span className="studio-nav-icon flex h-9 w-9 shrink-0 items-center justify-center rounded-xl">
                  <item.Icon className="h-5 w-5" />
                </span>
                <span className="truncate">{item.label}</span>
                {item.primary && (
                  <span
                    className={`ml-auto rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
                      active ? "bg-brand-deep text-accent" : "bg-accent/15 text-accent"
                    }`}
                  >
                    AI
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto space-y-3 px-0.5 pb-1">
          {trialDays != null && (
            <Link href="/app/settings" className="studio-sidebar-trial block rounded-2xl px-3.5 py-3.5">
              <p className="trial-label text-[10px] font-bold uppercase tracking-[0.16em]">
                Trial active
              </p>
              <p className="mt-1 text-sm font-bold text-white">{trialDays} days remaining</p>
            </Link>
          )}
          {needsOnboarding && (
            <Link
              href="/app/onboarding"
              className="flex items-center justify-between rounded-2xl bg-accent px-3.5 py-3 text-sm font-bold text-accent-ink"
            >
              Finish setup
              <span aria-hidden>→</span>
            </Link>
          )}
          <div className="studio-sidebar-account rounded-2xl p-3.5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-xs font-bold text-accent-ink">
                {initials}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-white">{me.user.full_name}</p>
                <p className="acct-muted truncate text-xs">{me.user.email}</p>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-3 border-t border-white/10 pt-3">
              {me.user.is_platform_admin && (
                <Link href="/admin" className="text-xs font-bold text-accent hover:underline">
                  Admin
                </Link>
              )}
              <button
                type="button"
                onClick={logout}
                className="acct-action ml-auto text-xs font-bold"
              >
                Log out
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* Main column — fills remaining screen */}
      <div className="relative z-0 flex min-h-screen min-w-0 flex-1 flex-col">
        {/* Mobile top */}
        <header className="studio-mobile-top sticky top-0 z-30 px-4 py-3 lg:hidden">
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="studio-menu-btn flex h-11 w-11 items-center justify-center rounded-2xl"
              aria-label="Open menu"
            >
              <IconMenu className="h-5 w-5" />
            </button>
            <div className="flex min-w-0 flex-1 flex-col items-center">
              <BrandLogo href="/app" variant="mark" className="h-8 w-8" />
              <p className="mt-1 max-w-[160px] truncate text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
                {tenantName}
              </p>
            </div>
            <div className="flex h-11 w-11 items-center justify-center">
              {trialDays != null ? (
                <span className="rounded-full bg-accent px-2 py-1 text-[10px] font-bold text-accent-ink">
                  {trialDays}d
                </span>
              ) : (
                <span className="h-2 w-2 rounded-full bg-brand" />
              )}
            </div>
          </div>
        </header>

        {/* Desktop top */}
        <header className="studio-desktop-top sticky top-0 z-20 hidden px-8 py-3.5 lg:block">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-brand">
                Marketing studio
              </p>
              <p className="mt-0.5 text-sm text-muted">
                Plan · create · approve · publish for African SMEs
              </p>
            </div>
            <div className="flex items-center gap-2.5">
              {trialDays != null && (
                <Link
                  href="/app/settings"
                  className="rounded-full border border-accent bg-accent px-3.5 py-1.5 text-xs font-bold text-accent-ink"
                >
                  Trial · {trialDays}d left
                </Link>
              )}
              <Link
                href="/app/content"
                className="rounded-full border border-line bg-surface px-4 py-2 text-xs font-bold text-brand-deep"
              >
                Approve drafts
              </Link>
              <Link
                href="/app/marketing"
                className="inline-flex items-center gap-2 rounded-full bg-brand-deep px-4 py-2 text-xs font-bold text-white"
              >
                <IconSpark className="h-3.5 w-3.5 text-accent" />
                Generate content
              </Link>
            </div>
          </div>
        </header>

        <main className="studio-safe-bottom mx-auto w-full max-w-6xl flex-1 px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>

      {/* Mobile tab bar */}
      <nav
        className="studio-tabbar fixed inset-x-0 bottom-0 z-40 lg:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
        aria-label="Primary"
      >
        <ul className="relative mx-auto grid h-[4.25rem] max-w-lg grid-cols-5 items-end px-1">
          {TAB_BAR.map((item) => {
            const active = isActive(pathname, item.href);
            if (item.create) {
              return (
                <li key={item.href} className="relative flex justify-center">
                  <Link
                    href={item.href}
                    className="group relative -mt-7 flex flex-col items-center"
                    aria-label="Create campaign"
                  >
                    <span className="studio-create-orb flex h-14 w-14 items-center justify-center rounded-full transition group-active:scale-95">
                      <item.Icon className="h-6 w-6" />
                    </span>
                    <span className={`mt-1 text-[10px] font-bold ${active ? "studio-tab-active" : ""}`}>
                      {item.label}
                    </span>
                  </Link>
                </li>
              );
            }
            return (
              <li key={item.href} className="flex justify-center">
                <Link
                  href={item.href}
                  className={`relative flex min-w-[3.5rem] flex-col items-center gap-1 px-2 pb-2.5 pt-2 ${
                    active ? "studio-tab-active" : ""
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="tab-indicator"
                      className="pointer-events-none absolute left-1/2 top-0 h-0.5 w-8 -translate-x-1/2 rounded-full bg-brand-deep"
                      transition={{ type: "spring", stiffness: 420, damping: 34 }}
                    />
                  )}
                  <span
                    className={`flex h-8 w-8 items-center justify-center rounded-xl ${
                      active ? "bg-brand/10" : ""
                    }`}
                  >
                    <item.Icon className="h-5 w-5" />
                  </span>
                  <span className="text-[10px] font-bold tracking-wide">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Full-screen drawer */}
      <AnimatePresence>
        {drawerOpen && (
          <motion.div
            className="fixed inset-0 z-50 lg:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <button
              type="button"
              className="absolute inset-0 bg-brand-deep/60 backdrop-blur-md"
              onClick={() => setDrawerOpen(false)}
              aria-label="Close menu"
            />
            <motion.aside
              role="dialog"
              aria-modal="true"
              aria-label="Studio menu"
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", stiffness: 340, damping: 34 }}
              className="studio-drawer absolute inset-y-0 left-0 flex h-[100dvh] w-full flex-col"
            >
              <div className="relative flex items-center justify-between px-5 pb-2 pt-[max(1.25rem,env(safe-area-inset-top))]">
                <BrandLogo href="/app" variant="mark" className="h-10 w-10 ring-1 ring-white/20" />
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/20 bg-white/10 text-white"
                  aria-label="Close"
                >
                  <IconClose className="h-5 w-5" />
                </button>
              </div>

              <div className="relative px-5 pt-4">
                <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-accent">
                  Marketing studio
                </p>
                <h2 className="font-display mt-2 text-3xl font-extrabold tracking-tight text-white">
                  {tenantName}
                </h2>
                {profile?.industry && (
                  <p className="mt-1 text-sm text-white/60">{profile.industry}</p>
                )}
              </div>

              <nav className="relative mt-8 flex-1 space-y-1.5 overflow-y-auto px-4 pb-6">
                {NAV.map((item, i) => {
                  const active = isActive(pathname, item.href);
                  return (
                    <motion.div
                      key={item.href}
                      initial={{ opacity: 0, x: -16 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.04 * i, duration: 0.35 }}
                    >
                      <Link
                        href={item.href}
                        onClick={() => setDrawerOpen(false)}
                        className={`studio-drawer-link flex items-center gap-3.5 rounded-2xl px-3.5 py-3.5 ${
                          active ? "is-active" : ""
                        }`}
                      >
                        <span className="studio-drawer-icon flex h-10 w-10 items-center justify-center rounded-xl">
                          <item.Icon className="h-5 w-5" />
                        </span>
                        <span className="text-[15px] font-bold">{item.label}</span>
                        {item.primary && (
                          <span
                            className={`ml-auto rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                              active ? "bg-brand-deep text-accent" : "bg-accent/20 text-accent"
                            }`}
                          >
                            AI
                          </span>
                        )}
                      </Link>
                    </motion.div>
                  );
                })}

                {needsOnboarding && (
                  <Link
                    href="/app/onboarding"
                    onClick={() => setDrawerOpen(false)}
                    className="mt-3 flex items-center justify-between rounded-2xl bg-accent px-4 py-3.5 text-sm font-bold text-accent-ink"
                  >
                    Finish business setup
                    <span aria-hidden>→</span>
                  </Link>
                )}
              </nav>

              <div className="relative border-t border-white/15 px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-xs font-bold text-accent-ink">
                    {initials}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-white">{me.user.full_name}</p>
                    <p className="truncate text-xs text-white/55">{me.user.email}</p>
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-4">
                  {me.user.is_platform_admin && (
                    <Link
                      href="/admin"
                      onClick={() => setDrawerOpen(false)}
                      className="text-xs font-bold text-accent"
                    >
                      Control Plane
                    </Link>
                  )}
                  {trialDays != null && (
                    <Link
                      href="/app/settings"
                      onClick={() => setDrawerOpen(false)}
                      className="text-xs font-bold text-white/60"
                    >
                      Trial · {trialDays}d
                    </Link>
                  )}
                  <button
                    type="button"
                    onClick={logout}
                    className="ml-auto text-xs font-bold text-white/60 hover:text-white"
                  >
                    Log out
                  </button>
                </div>
              </div>
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
