import Link from "next/link";
import { APP_COMPANY, APP_NAME, APP_TAGLINE } from "@/config/app";
import { Wordmark } from "@/components/shell/wordmark";
import { Button } from "@/components/ui/button";

/** Minimal marketing chrome: sticky hairline top bar, hairline footer. */
export default function MarketingLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 md:px-8">
          <Wordmark href="/" />
          <nav className="flex items-center gap-1.5 sm:gap-3">
            <a
              href="#pricing"
              className="px-2 text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground"
            >
              Pricing
            </a>
            <Button asChild variant="ghost" size="sm">
              <Link href="/dashboard">Log in</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/dashboard">Get started</Link>
            </Button>
          </nav>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 md:flex-row md:items-end md:justify-between md:px-8">
          <div>
            <Wordmark href="/" />
            <p className="mt-2 text-sm text-muted-foreground">{APP_TAGLINE}</p>
          </div>
          <div className="text-xs text-muted-foreground md:text-right">
            <p>Built for rental arbitrage operators.</p>
            <p className="mt-1">© 2026 {APP_COMPANY}</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
