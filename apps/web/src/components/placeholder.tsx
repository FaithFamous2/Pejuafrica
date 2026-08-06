import Link from "next/link";

export function Placeholder({ title, body }: { title: string; body: string }) {
  return (
    <div className="relative mx-auto flex min-h-[70vh] max-w-2xl flex-col items-center justify-center px-6 text-center">
      <div className="peju-drift pointer-events-none absolute left-1/4 top-10 -z-10 h-40 w-40 rounded-full bg-brand/10 blur-3xl" />
      <Link href="/app" className="text-sm font-medium text-brand">
        ← Back to dashboard
      </Link>
      <h1 className="font-display mt-6 text-3xl font-bold text-brand-deep md:text-4xl">{title}</h1>
      <p className="mt-3 text-muted">{body}</p>
    </div>
  );
}
