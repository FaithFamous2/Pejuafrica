"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { api } from "@/lib/api";
import { AuthFrame } from "@/components/auth-frame";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const form = new FormData(e.currentTarget);
    try {
      const result = await api.login({
        email: String(form.get("email")),
        password: String(form.get("password")),
      });
      if (result.tenant?.id) {
        localStorage.setItem("peju_tenant_id", result.tenant.id);
      }
      if (result.user.is_platform_admin && !result.tenant) {
        router.push("/admin");
      } else {
        router.push("/app");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthFrame
      title="Welcome back"
      subtitle="Log in to your business workspace."
      footer={
        <>
          New to PejuAfrica?{" "}
          <Link href="/register" className="font-semibold text-brand">
            Start free trial
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <label className="block text-sm">
          <span className="mb-1.5 block font-medium">Email</span>
          <input
            name="email"
            type="email"
            required
            className="w-full rounded-2xl border border-line bg-surface-soft/60 px-4 py-3 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1.5 block font-medium">Password</span>
          <input
            name="password"
            type="password"
            required
            className="w-full rounded-2xl border border-line bg-surface-soft/60 px-4 py-3 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
        </label>
        <div className="text-right">
          <Link href="/forgot-password" className="text-xs font-semibold text-brand">
            Forgot password?
          </Link>
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
        <motion.button
          type="submit"
          disabled={loading}
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.99 }}
          className="w-full rounded-full bg-brand-deep py-3.5 font-semibold text-white disabled:opacity-60"
        >
          {loading ? "Signing in…" : "Log in"}
        </motion.button>
      </form>
    </AuthFrame>
  );
}
