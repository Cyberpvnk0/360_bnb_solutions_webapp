import Link from "next/link";
import { APP_NAME } from "@/config/app";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background px-4 text-center">
      <p className="metric-label">{APP_NAME}</p>
      <h1 className="mt-3 font-display text-5xl font-medium tracking-tight text-foreground">
        No such page
      </h1>
      <p className="mt-3 max-w-sm text-sm text-muted-foreground">
        The address you pulled up doesn&apos;t exist. The deals do.
      </p>
      <Link
        href="/dashboard"
        className="mt-6 inline-flex h-9 items-center rounded-sm bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors duration-150 hover:bg-brand-deep"
      >
        Back to the dashboard
      </Link>
    </div>
  );
}
