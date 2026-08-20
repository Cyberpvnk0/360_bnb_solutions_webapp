import Link from "next/link";
import { APP_NAME } from "@/config/app";
import { cn } from "@/lib/utils";

/** The product wordmark: gold mark + serif name. Renames via config/app. */
export function Wordmark({
  href = "/dashboard",
  className,
}: {
  href?: string;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-2.5 text-foreground transition-opacity duration-150 hover:opacity-80",
        className
      )}
    >
      <span
        aria-hidden
        className="block size-2.5 rotate-45 border border-gold bg-gold-fill/20"
      />
      <span className="font-display text-lg font-medium tracking-tight">
        {APP_NAME}
      </span>
    </Link>
  );
}
