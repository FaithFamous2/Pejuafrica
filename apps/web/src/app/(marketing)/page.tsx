"use client";

import Link from "next/link";
import { motion, useScroll, useTransform } from "framer-motion";
import { useRef } from "react";
import { BrandLogo, BrandLockup } from "@/components/brand-logo";

const ease = [0.22, 1, 0.36, 1] as const;

const fadeUp = {
  hidden: { opacity: 0, y: 28 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: 0.12 + i * 0.1, duration: 0.85, ease },
  }),
};

export default function MarketingHomePage() {
  const heroRef = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({
    target: heroRef,
    offset: ["start start", "end start"],
  });
  const heroY = useTransform(scrollYProgress, [0, 1], [0, 120]);
  const heroOpacity = useTransform(scrollYProgress, [0, 0.75], [1, 0.35]);

  return (
    <div className="flex min-h-screen flex-col overflow-x-hidden">
      <header className="absolute inset-x-0 top-0 z-30">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
          <BrandLockup href="/" tone="dark" />
          <nav className="flex items-center gap-2 text-sm md:gap-3">
            <Link
              href="/login"
              className="rounded-full px-4 py-2 text-white/80 transition hover:text-white"
            >
              Log in
            </Link>
            <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.98 }}>
              <Link
                href="/register"
                className="rounded-full bg-accent px-5 py-2.5 font-semibold text-accent-ink shadow-[0_0_30px_var(--glow)]"
              >
                Start free trial
              </Link>
            </motion.div>
          </nav>
        </div>
      </header>

      <section
        ref={heroRef}
        className="relative flex min-h-[100svh] items-end overflow-hidden md:items-center"
      >
        {/* Full-bleed visual plane */}
        <motion.div style={{ y: heroY, opacity: heroOpacity }} className="absolute inset-0 -z-10">
          <div className="absolute inset-0 bg-brand-deep" />
          <div
            className="peju-drift absolute -left-[20%] -top-[30%] h-[70vmax] w-[70vmax] rounded-full blur-3xl"
            style={{
              background:
                "radial-gradient(circle, rgba(17,122,79,0.85) 0%, rgba(17,122,79,0) 70%)",
            }}
          />
          <div
            className="peju-drift-slow absolute -bottom-[25%] -right-[15%] h-[65vmax] w-[65vmax] rounded-full blur-3xl"
            style={{
              background:
                "radial-gradient(circle, rgba(214,245,106,0.28) 0%, rgba(214,245,106,0) 68%)",
            }}
          />
          <div
            className="peju-pulse absolute left-1/2 top-1/3 h-[40vmax] w-[40vmax] -translate-x-1/2 rounded-full blur-2xl"
            style={{
              background:
                "radial-gradient(circle, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0) 70%)",
            }}
          />
          {/* Atmospheric market/city texture via CSS mesh — real visual anchor of growth */}
          <div
            className="absolute inset-0 opacity-[0.18]"
            style={{
              backgroundImage:
                "url(\"data:image/svg+xml,%3Csvg width='160' height='160' viewBox='0 0 160 160' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M0 80h160M80 0v160' stroke='%23d6f56a' stroke-opacity='0.35' stroke-width='0.6'/%3E%3Ccircle cx='80' cy='80' r='2' fill='%23d6f56a' fill-opacity='0.5'/%3E%3C/svg%3E\")",
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-brand-deep via-brand-deep/55 to-transparent md:bg-gradient-to-r md:from-brand-deep md:via-brand-deep/70 md:to-transparent" />
        </motion.div>

        <div className="relative z-10 mx-auto w-full max-w-6xl px-6 pb-16 pt-28 md:pb-24 md:pt-20">
          <motion.div
            custom={0}
            variants={fadeUp}
            initial="hidden"
            animate="show"
            className="max-w-xl"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo.jpeg"
              alt="PejuAfrica"
              width={640}
              height={360}
              className="h-auto w-full max-w-[min(100%,28rem)] rounded-2xl object-contain shadow-[0_20px_60px_rgba(0,0,0,0.35)] sm:max-w-md md:max-w-lg"
            />
          </motion.div>

          <motion.h1
            custom={1}
            variants={fadeUp}
            initial="hidden"
            animate="show"
            className="font-display mt-5 max-w-3xl text-2xl font-semibold leading-tight text-white/95 sm:text-3xl md:mt-7 md:text-4xl lg:text-5xl"
          >
            Your AI Marketing Department for African SMEs
          </motion.h1>

          <motion.p
            custom={2}
            variants={fadeUp}
            initial="hidden"
            animate="show"
            className="mt-5 max-w-xl text-base leading-relaxed text-white/75 md:mt-6 md:text-lg"
          >
            A full month of strategy and content in under 10 minutes — built for fashion,
            restaurants, clinics, and growing Nigerian businesses.
          </motion.p>

          <motion.div
            custom={3}
            variants={fadeUp}
            initial="hidden"
            animate="show"
            className="mt-9 flex flex-wrap items-center gap-4"
          >
            <motion.div whileHover={{ scale: 1.04, y: -2 }} whileTap={{ scale: 0.98 }}>
              <Link
                href="/register"
                className="inline-flex rounded-full bg-accent px-7 py-3.5 text-base font-bold text-accent-ink shadow-[0_0_40px_var(--glow)]"
              >
                Start 14-day free trial
              </Link>
            </motion.div>
            <motion.div whileHover={{ x: 4 }} whileTap={{ scale: 0.98 }}>
              <Link
                href="/login"
                className="inline-flex rounded-full border border-white/25 bg-white/5 px-7 py-3.5 text-base font-semibold text-white backdrop-blur-sm transition hover:bg-white/10"
              >
                I already have an account
              </Link>
            </motion.div>
          </motion.div>
        </div>

        <motion.div
          aria-hidden
          className="pointer-events-none absolute bottom-6 left-1/2 z-10 hidden -translate-x-1/2 md:block"
          animate={{ y: [0, 8, 0] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
        >
          <div className="h-10 w-6 rounded-full border border-white/30 p-1">
            <div className="mx-auto h-2 w-1 rounded-full bg-accent" />
          </div>
        </motion.div>
      </section>

      {/* Second composition — one job: prove the outcome */}
      <section className="relative overflow-hidden px-6 py-24 md:py-32">
        <div className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute left-[-10%] top-0 h-72 w-72 rounded-full bg-brand/10 blur-3xl" />
          <div className="absolute bottom-0 right-[-5%] h-80 w-80 rounded-full bg-accent/20 blur-3xl" />
        </div>

        <div className="mx-auto max-w-6xl">
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.4 }}
            transition={{ duration: 0.8, ease }}
            className="max-w-2xl"
          >
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-brand">
              How it works
            </p>
            <h2 className="font-display mt-3 text-3xl font-bold text-brand-deep md:text-5xl">
              From business profile to a month of marketing — before your coffee cools.
            </h2>
          </motion.div>

          <div className="mt-14 grid gap-10 md:grid-cols-3">
            {[
              {
                step: "01",
                title: "Tell Peju about your business",
                body: "Brand voice, audience, competitors, and goals — so the AI learns how you sell.",
              },
              {
                step: "02",
                title: "Generate a 30-day plan",
                body: "Strategy, calendar, captions, hashtags, and graphic prompts in one run.",
              },
              {
                step: "03",
                title: "Approve and publish",
                body: "Review drafts, export assets, or connect WhatsApp and Instagram when ready.",
              },
            ].map((item, i) => (
              <motion.div
                key={item.step}
                initial={{ opacity: 0, y: 36 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.35 }}
                transition={{ delay: i * 0.12, duration: 0.7, ease }}
              >
                <p className="font-display text-5xl font-extrabold text-brand/20">{item.step}</p>
                <h3 className="font-display mt-3 text-xl font-bold text-brand-deep">{item.title}</h3>
                <p className="mt-2 text-muted leading-relaxed">{item.body}</p>
              </motion.div>
            ))}
          </div>

          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7, ease }}
            className="mt-20 flex flex-col items-start justify-between gap-6 rounded-[2rem] bg-brand-deep px-8 py-10 text-white md:flex-row md:items-center md:px-12"
          >
            <div>
              <p className="font-display text-2xl font-bold md:text-3xl">
                Ready for your AI marketing department?
              </p>
              <p className="mt-2 text-white/70">14-day free trial. Built for African SMEs first.</p>
            </div>
            <motion.div whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.98 }}>
              <Link
                href="/register"
                className="inline-flex rounded-full bg-accent px-7 py-3.5 font-bold text-accent-ink"
              >
                Create your workspace
              </Link>
            </motion.div>
          </motion.div>
        </div>
      </section>

      <footer className="border-t border-line px-6 py-8 text-sm text-muted">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <BrandLogo href="/" variant="full" className="h-8" />
          <p>© {new Date().getFullYear()} PejuAfrica. AI Business OS for African SMEs.</p>
        </div>
      </footer>
    </div>
  );
}
