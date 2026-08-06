"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { AuthFrame } from "@/components/auth-frame";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);
    setDevCode(null);
    try {
      const res = await api.forgotPassword(email);
      setMessage(res.message);
      if (res.dev_reset_code) setDevCode(res.dev_reset_code);
      window.setTimeout(() => {
        router.push(`/reset-password?email=${encodeURIComponent(email)}`);
      }, 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send code");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthFrame
      title="Forgot password"
      subtitle="We'll email a 6-digit code to reset it."
      footer={
        <p className="text-center text-sm text-white/70">
          Remembered it?{" "}
          <Link href="/login" className="font-semibold text-accent">
            Log in
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
        {error && <p className="text-sm text-danger">{error}</p>}
        {message && <p className="text-sm text-brand">{message}</p>}
        {devCode && (
          <p className="rounded-xl bg-surface-soft px-3 py-2 text-xs text-muted">
            Dev code: <strong className="tracking-widest text-brand-deep">{devCode}</strong>
          </p>
        )}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-full bg-brand-deep py-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          {loading ? "Sending…" : "Send reset code"}
        </button>
      </form>
    </AuthFrame>
  );
}
