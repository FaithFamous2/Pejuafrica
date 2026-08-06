import Link from "next/link";

type BrandLogoProps = {
  href?: string;
  variant?: "full" | "mark" | "wordmark";
  tone?: "light" | "dark";
  className?: string;
};

/**
 * Platform branding.
 * - full: horizontal PejuAfrica wordmark (`/logo.jpeg`)
 * - mark: green P icon (`/icon.jpeg`)
 */
export function BrandLogo({
  href = "/",
  variant = "full",
  tone = "light",
  className = "",
}: BrandLogoProps) {
  const content =
    variant === "mark" ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src="/icon.jpeg"
        alt="PejuAfrica"
        width={40}
        height={40}
        className={`h-9 w-9 rounded-xl object-cover shadow-sm ${className}`}
      />
    ) : variant === "wordmark" ? (
      <span
        className={`font-display text-xl font-bold tracking-tight ${
          tone === "dark" ? "text-white" : "text-brand-deep"
        } ${className}`}
      >
        Peju<span className={tone === "dark" ? "text-accent" : "text-brand"}>Africa</span>
      </span>
    ) : (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src="/logo.jpeg"
        alt="PejuAfrica — Africa’s Business Operating System"
        width={220}
        height={64}
        className={`h-9 w-auto object-contain md:h-10 ${className}`}
      />
    );

  if (!href) return content;
  return (
    <Link href={href} className="inline-flex items-center gap-2" aria-label="PejuAfrica home">
      {content}
    </Link>
  );
}

/** Compact mark + wordmark for dark headers */
export function BrandLockup({
  href = "/",
  tone = "dark",
  showWord = true,
}: {
  href?: string;
  tone?: "light" | "dark";
  showWord?: boolean;
}) {
  return (
    <Link href={href} className="inline-flex items-center gap-2.5" aria-label="PejuAfrica">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/icon.jpeg"
        alt=""
        width={36}
        height={36}
        className="h-9 w-9 rounded-xl object-cover ring-1 ring-white/15"
      />
      {showWord && (
        <span
          className={`font-display text-lg font-bold tracking-tight md:text-xl ${
            tone === "dark" ? "text-white" : "text-brand-deep"
          }`}
        >
          Peju<span className={tone === "dark" ? "text-accent" : "text-brand"}>Africa</span>
        </span>
      )}
    </Link>
  );
}
