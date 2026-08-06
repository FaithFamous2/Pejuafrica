"use client";

import { motion } from "framer-motion";

const ease = [0.22, 1, 0.36, 1] as const;

export function PageHero({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease }}
      className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between"
    >
      <div className="min-w-0 max-w-2xl">
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-brand">{eyebrow}</p>
        <h1 className="font-display mt-2 text-3xl font-extrabold tracking-tight text-brand-deep sm:text-4xl md:text-[2.75rem] md:leading-[1.05]">
          {title}
        </h1>
        {description && (
          <div className="mt-3 text-sm leading-relaxed text-muted sm:text-base">{description}</div>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </motion.div>
  );
}
