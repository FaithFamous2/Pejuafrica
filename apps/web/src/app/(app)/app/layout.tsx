"use client";

import { AppProviders, AppShell } from "@/components/app-shell";

export default function AppSectionLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppProviders>
      <AppShell>{children}</AppShell>
    </AppProviders>
  );
}
