"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { api } from "@/lib/api";
import { AuthFrame } from "@/components/auth-frame";

export default function InviteAcceptPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const router = useRouter();
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof api.previewInvite>> | null>(
    null,
  );
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!token) return;
    api
      .previewInvite(token)
      .then((p) => {
        setPreview(p);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Invalid invite"));
  }, [token]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.acceptInvite({
        token,
        full_name: fullName,
        password: preview?.user_exists ? undefined : password,
      });
      localStorage.setItem("peju_tenant_id", res.tenant_id);
      // Existing users still need to log in; new users created without session — send to login
      router.push(
        `/login?invited=1&email=${encodeURIComponent(preview?.email || "")}&tenant=${res.tenant_id}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not accept invite");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthFrame
      title="Join workspace"
      subtitle={preview ? `${preview.org_name} · ${preview.role}` : "Loading invite…"}
      footer={
        <p className="text-center text-sm text-white/70">
          Already have access?{" "}
          <Link href="/login" className="font-semibold text-accent">
            Log in
          </Link>
        </p>
      }
    >
      {error && !preview && (
        <div className="space-y-4">
          <p className="text-sm text-danger">{error}</p>
          <Link href="/login" className="text-sm font-semibold text-brand">
            Back to login
          </Link>
        </div>
      )}

      {preview && (
        <motion.form
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          onSubmit={onSubmit}
          className="space-y-4"
        >
          <p className="text-sm text-muted">
            {preview.inviter_name ? `${preview.inviter_name} invited` : "You were invited"}{" "}
            <strong>{preview.email}</strong> to collaborate
            {preview.already_member ? " (you are already a member)" : ""}.
          </p>
          <p className="text-xs text-muted">Access: {preview.permissions.join(", ")}</p>

          <label className="block text-xs font-semibold uppercase tracking-wider text-muted">
            Your full name
            <input
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="mt-1.5 w-full rounded-xl border border-line bg-white px-3 py-2.5 text-sm normal-case tracking-normal text-brand-deep"
              placeholder="Ada Okonkwo"
            />
          </label>

          {!preview.user_exists && (
            <label className="block text-xs font-semibold uppercase tracking-wider text-muted">
              Create a password
              <input
                required
                type="password"
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-line bg-white px-3 py-2.5 text-sm normal-case tracking-normal text-brand-deep"
              />
            </label>
          )}

          {preview.user_exists && (
            <p className="text-xs text-muted">
              You already have a PejuAfrica account — accept, then log in with your existing
              password.
            </p>
          )}

          {error && <p className="text-sm text-danger">{error}</p>}

          <button
            type="submit"
            disabled={loading || preview.already_member}
            className="w-full rounded-full bg-brand-deep py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {preview.already_member
              ? "Already joined"
              : loading
                ? "Joining…"
                : "Accept & continue"}
          </button>
        </motion.form>
      )}
    </AuthFrame>
  );
}
