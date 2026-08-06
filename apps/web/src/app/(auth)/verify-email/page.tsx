"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { AuthFrame } from "@/components/auth-frame";

function VerifyEmailInner() {
  const params = useSearchParams();
  const token = params.get("token") || "";
  const [message, setMessage] = useState("Verifying…");
  const [ok, setOk] = useState(false);

  useEffect(() => {
    if (!token) {
      setMessage("Missing verification token.");
      return;
    }
    api
      .verifyEmail(token)
      .then((res) => {
        setOk(true);
        setMessage(res.message);
      })
      .catch((err) => setMessage(err instanceof Error ? err.message : "Verification failed"));
  }, [token]);

  return (
    <AuthFrame
      title="Verify email"
      subtitle="Confirming your PejuAfrica account."
      footer={
        <p className="text-center text-sm text-white/70">
          <Link href="/login" className="font-semibold text-accent">
            Continue to login
          </Link>
        </p>
      }
    >
      <p className={`text-sm ${ok ? "text-brand" : "text-muted"}`}>{message}</p>
    </AuthFrame>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <AuthFrame
          title="Verify email"
          subtitle="Confirming your PejuAfrica account."
          footer={null}
        >
          <p className="text-sm text-muted">Verifying…</p>
        </AuthFrame>
      }
    >
      <VerifyEmailInner />
    </Suspense>
  );
}
