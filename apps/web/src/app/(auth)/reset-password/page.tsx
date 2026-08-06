"use client";

import Link from "next/link";
import { FormEvent, Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { AuthFrame } from "@/components/auth-frame";

function ResetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const initialEmail = useMemo(() => params.get("email") || "", [params]);
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await api.resetPassword({
        email,
        code: code.trim(),
        new_password: password,
      });
      setMessage(res.message);
      window.setTimeout(() => router.push("/login"), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthFrame
      title="Set new password"
      subtitle="Enter the code from your email, then choose a new password."
      footer={
        <p className="text-center text-sm text-white/70">
          No code?{" "}
          <Link href="/forgot-password" className="font-semibold text-accent">
            Resend code
          </Link>
        </p>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <label className="block text-xs font-semibold uppercase tracking-wider text-muted">
          Email
          <input
            required
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1.5 w-full rounded-xl border border-line bg-white px-3 py-2.5 text-sm normal-case tracking-normal text-brand-deep"
          />
        </label>
        <label className="block text-xs font-semibold uppercase tracking-wider text-muted">
          6-digit code
          <input
            required
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="mt-1.5 w-full rounded-xl border border-line bg-white px-3 py-2.5 text-sm tracking-[0.3em] text-brand-deep"
            placeholder="000000"
          />
        </label>
        <label className="block text-xs font-semibold uppercase tracking-wider text-muted">
          New password
          <input
            required
            type="password"
            minLength={10}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1.5 w-full rounded-xl border border-line bg-white px-3 py-2.5 text-sm normal-case tracking-normal text-brand-deep"
          />
        </label>
        <label className="block text-xs font-semibold uppercase tracking-wider text-muted">
          Confirm password
          <input
            required
            type="password"
            minLength={10}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="mt-1.5 w-full rounded-xl border border-line bg-white px-3 py-2.5 text-sm normal-case tracking-normal text-brand-deep"
          />
        </label>
        {error && <p className="text-sm text-danger">{error}</p>}
        {message && <p className="text-sm text-brand">{message}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-full bg-brand-deep py-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          {loading ? "Updating…" : "Update password"}
        </button>
      </form>
    </AuthFrame>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <AuthFrame title="Set new password" subtitle="Loading…" footer={null}>
          <p className="text-sm text-muted">Loading…</p>
        </AuthFrame>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}
