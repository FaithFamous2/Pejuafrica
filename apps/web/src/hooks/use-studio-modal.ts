"use client";

import { useEffect } from "react";

const OPEN_CLASS = "studio-modal-open";

/**
 * Locks body scroll and hides the mobile tab bar while a fullscreen modal is open.
 * Needed because fixed overlays inside `main` lose to the tab bar's stacking context.
 */
export function useStudioModal(open: boolean) {
  useEffect(() => {
    if (!open) return;
    const body = document.body;
    body.classList.add(OPEN_CLASS);
    const prev = body.style.overflow;
    body.style.overflow = "hidden";
    return () => {
      body.classList.remove(OPEN_CLASS);
      body.style.overflow = prev;
    };
  }, [open]);
}
