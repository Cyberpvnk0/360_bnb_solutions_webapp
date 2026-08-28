import Link from "next/link";

/**
 * The signed-out shell.
 *
 * Deliberately not the app shell: a sign-in page wrapped in a nav bar
 * full of links that all bounce back to sign-in is a maze. One mark,
 * one card, nothing else to click.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="px-4 py-6 md:px-8">
        <Link
          href="/"
          className="font-display text-lg font-medium tracking-tight text-foreground"
        >
          ArbiCore
        </Link>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pb-16 pt-4 md:items-center md:pb-24 md:pt-0">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}
