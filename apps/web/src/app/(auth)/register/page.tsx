"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { api } from "@/lib/api";
import { AuthFrame } from "@/components/auth-frame";

export default function RegisterPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const form = new FormData(e.currentTarget);
    try {
      const result = await api.register({
        email: String(form.get("email")),
        password: String(form.get("password")),
        full_name: String(form.get("full_name")),
        business_name: String(form.get("business_name")),
        industry: String(form.get("industry") || "") || undefined,
      });
      if (result.tenant?.id) {
        localStorage.setItem("peju_tenant_id", result.tenant.id);
      }
      router.push("/app/onboarding");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthFrame
      title="Create your workspace"
      subtitle="14-day free trial. No card required."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className="font-semibold text-brand">
            Log in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Full name" name="full_name" required />
        <Field label="Work email" name="email" type="email" required />
        <Field label="Business name" name="business_name" required />
        <Field label="Industry" name="industry" placeholder="Fashion, Restaurant, Clinic…" />
        <Field label="Password" name="password" type="password" required minLength={10} />
        {error && <p className="text-sm text-danger">{error}</p>}
        <motion.button
          type="submit"
          disabled={loading}
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.99 }}
          className="w-full rounded-full bg-brand-deep py-3.5 font-semibold text-white disabled:opacity-60"
        >
          {loading ? "Creating workspace…" : "Start free trial"}
        </motion.button>
      </form>
    </AuthFrame>
  );
}

function Field({
  label,
  name,
  type = "text",
  required,
  placeholder,
  minLength,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
  minLength?: number;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1.5 block font-medium text-foreground">{label}</span>
      <input
        name={name}
        type={type}
        required={required}
        placeholder={placeholder}
        minLength={minLength}
        className="w-full rounded-2xl border border-line bg-surface-soft/60 px-4 py-3 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
      />
    </label>
  );
}
