"use client";

/**
 * Sign in and sign up, one component.
 *
 * The two differ by a single call and one line of copy, and keeping
 * them apart means two forms that drift — different validation, one
 * that handles a rejected password nicely and one that does not.
 *
 * Errors are shown as the service worded them. An auth failure a person
 * cannot act on ("something went wrong") is the difference between
 * fixing a typo and giving up.
 */

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Loader2 } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { MetricLabel } from "@/components/primitives/metric-label";

/** Supabase's own floor. Stating it up front beats a rejection after
 *  someone has already typed a password they liked. */
const MIN_PASSWORD = 6;

export function AuthForm({ mode }: { mode: "signin" | "signup" }) {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/dashboard";

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [sent, setSent] = React.useState(false);

  const signingUp = mode === "signup";

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (password.length < MIN_PASSWORD) {
      setError(`Password needs at least ${MIN_PASSWORD} characters.`);
      return;
    }

    setBusy(true);
    const supabase = supabaseBrowser();

    const { data, error: authError } = signingUp
      ? await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
          },
        })
      : await supabase.auth.signInWithPassword({ email, password });

    if (authError) {
      setBusy(false);
      setError(authError.message);
      return;
    }

    // A project with email confirmation on returns a user and no
    // session: they are registered but cannot act until they click the
    // link. Saying "check your email" is the difference between waiting
    // and assuming it broke.
    if (signingUp && data.session === null) {
      setBusy(false);
      setSent(true);
      return;
    }

    // refresh() so server components re-read the new cookie; without it
    // the shell renders as though nobody is signed in.
    router.replace(next);
    router.refresh();
  };

  if (sent) {
    return (
      <div className="rounded-sm border border-border bg-card p-6">
        <MetricLabel>Almost there</MetricLabel>
        <h1 className="mt-1.5 font-display text-2xl font-medium tracking-tight text-foreground">
          Check your email
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          We sent a confirmation link to{" "}
          <span className="font-medium text-foreground">{email}</span>. Click it
          and you&apos;re in.
        </p>
        <p className="mt-4 text-xs text-muted-foreground">
          Nothing after a minute? Check spam, or{" "}
          <button
            type="button"
            onClick={() => {
              setSent(false);
              setPassword("");
            }}
            className="text-gold underline-offset-2 hover:underline"
          >
            try a different address
          </button>
          .
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-sm border border-border bg-card p-6"
      noValidate
    >
      <MetricLabel>{signingUp ? "Create account" : "Welcome back"}</MetricLabel>
      <h1 className="mt-1.5 font-display text-2xl font-medium tracking-tight text-foreground">
        {signingUp ? "Start analyzing deals" : "Sign in"}
      </h1>

      <div className="mt-6 space-y-4">
        <label className="block">
          <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            Email
          </span>
          <input
            type="email"
            required
            autoComplete="email"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1.5 h-11 w-full rounded-sm border border-border bg-secondary/40 px-3 text-base text-foreground placeholder:text-muted-foreground focus-visible:border-gold/50"
            placeholder="you@example.com"
          />
        </label>

        <label className="block">
          <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            Password
          </span>
          <input
            type="password"
            required
            minLength={MIN_PASSWORD}
            autoComplete={signingUp ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1.5 h-11 w-full rounded-sm border border-border bg-secondary/40 px-3 text-base text-foreground focus-visible:border-gold/50"
            placeholder={signingUp ? `${MIN_PASSWORD}+ characters` : ""}
          />
        </label>
      </div>

      {error ? (
        <p
          role="alert"
          className="mt-4 rounded-sm border px-3 py-2 text-sm"
          style={{ color: "var(--red-muted)", borderColor: "var(--red-muted)" }}
        >
          {error}
        </p>
      ) : null}

      <Button type="submit" size="lg" className="mt-6 w-full gap-2" disabled={busy}>
        {busy ? (
          <Loader2 aria-hidden className="size-4 animate-spin" />
        ) : (
          <>
            {signingUp ? "Create account" : "Sign in"}
            <ArrowRight aria-hidden className="size-4" />
          </>
        )}
      </Button>

      <p className="mt-4 text-center text-xs text-muted-foreground">
        {signingUp ? (
          <>
            Already have an account?{" "}
            <Link href="/login" className="text-gold underline-offset-2 hover:underline">
              Sign in
            </Link>
          </>
        ) : (
          <>
            No account yet?{" "}
            <Link href="/signup" className="text-gold underline-offset-2 hover:underline">
              Create one
            </Link>
          </>
        )}
      </p>
    </form>
  );
}
