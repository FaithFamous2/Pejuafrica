"use client";

import { motion } from "framer-motion";
import { BrandLockup } from "@/components/brand-logo";

const ease = [0.22, 1, 0.36, 1] as const;

export function AuthFrame({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-6 py-12">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-brand-deep" />
      <div
        className="peju-drift pointer-events-none absolute -left-24 top-0 h-[50vmax] w-[50vmax] rounded-full blur-3xl"
        style={{
          background: "radial-gradient(circle, rgba(17,122,79,0.7) 0%, transparent 70%)",
        }}
      />
      <div
        className="peju-drift-slow pointer-events-none absolute -bottom-20 -right-16 h-[45vmax] w-[45vmax] rounded-full blur-3xl"
        style={{
          background: "radial-gradient(circle, rgba(214,245,106,0.25) 0%, transparent 70%)",
        }}
      />

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease }}
        className="w-full max-w-md"
      >
        <BrandLockup href="/" tone="dark" />
        <h1 className="font-display mt-8 text-3xl font-bold text-white md:text-4xl">{title}</h1>
        <p className="mt-2 text-white/70">{subtitle}</p>
        <div className="mt-8 rounded-[1.75rem] border border-white/10 bg-white p-6 shadow-2xl md:p-8">
          {children}
        </div>
        <div className="mt-6 text-center text-sm text-white/70">{footer}</div>
      </motion.div>
    </div>
  );
}
