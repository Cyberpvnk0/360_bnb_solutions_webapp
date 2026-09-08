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

/** A `next` we will follow: a path on this site, nothing that a browser
 *  would read as another host (`//host`, `/\host`, `https://host`). */
function safeNext(raw: string | null): string {
  if (!raw) return "/dashboard";
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) {
    return "/dashboard";
  }
  return raw;
}

export function AuthForm({
  mode,
  setupProblem = null,
}: {
  mode: "signin" | "signup";
  /** Set when the deployment cannot authenticate at all. Passed from a
   *  server component, which can see variables the browser cannot. */
  setupProblem?: string | null;
}) {
  const router = useRouter();
  const params = useSearchParams();
  // Only a path on this site. `?next=https://elsewhere` after a real
  // sign-in is the textbook open redirect; the callback route already
  // refuses it and this form must too.
  const next = safeNext(params.get("next"));

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  // A confirmation link that did not exchange lands here with a reason;
  // the person deserves to read it rather than a blank sign-in form.
  const linkExpired = params.get("error") === "link-expired";
  const [error, setError] = React.useState<string | null>(() =>
    linkExpired
      ? "That confirmation link has expired or was already used. Enter your email and resend it, or sign in if you have already confirmed."
      : null
  );
  /** Good news, kept apart from `error` so one cannot erase the other:
   *  "your email is confirmed" from the callback, "sent again" from a
   *  resend. */
  const [notice, setNotice] = React.useState<string | null>(() =>
    params.get("notice") === "confirmed"
      ? "Your email is confirmed. Sign in with your password to continue."
      : null
  );
  const [sent, setSent] = React.useState(false);
  const [resent, setResent] = React.useState<"idle" | "sending" | "done">("idle");

  const signingUp = mode === "signup";

  /** Where the confirmation link brings them back to: this site's
   *  callback, which exchanges the code for a session and forwards. */
  const redirectTo = () =>
    `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;

  /**
   * Another copy of the confirmation email, for the address typed in.
   *
   * Two places need it: the "check your email" card, when the first one
   * never arrived, and a sign-in refused with "email not confirmed",
   * which is somebody who registered, lost the email, and now cannot
   * get in by any path this form offered.
   */
  const resend = async () => {
    if (!email) return;
    setResent("sending");
    const supabase = supabaseBrowser();
    const { error: resendError } = await supabase.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: redirectTo() },
    });
    if (resendError) {
      setResent("idle");
      setError(resendError.message);
      return;
    }
    setResent("done");
    setNotice(`Confirmation email sent again to ${email}. Check spam if it is not there in a minute.`);
  };

  /** When a resend is the right next step: the service said the email
   *  is not confirmed, or the link that was meant to confirm it died. */
  const canResend = /not confirmed/i.test(error ?? "") || (linkExpired && error !== null);

  // A form that cannot possibly succeed should say so rather than
  // accept a password and fail quietly.
  if (setupProblem) {
    return (
      <div className="rounded-sm border border-border bg-card p-6">
        <MetricLabel>Setup needed</MetricLabel>
        <h1 className="mt-1.5 font-display text-xl font-medium tracking-tight text-foreground">
          Sign-in isn&apos;t switched on yet
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {setupProblem}
        </p>
      </div>
    );
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setNotice(null);

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
          options: { emailRedirectTo: redirectTo() },
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
      setResent("idle");
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
          Nothing after a minute? Check spam,{" "}
          {resent === "done" ? (
            <span className="text-foreground">sent again</span>
          ) : (
            <button
              type="button"
              onClick={resend}
              disabled={resent === "sending"}
              className="text-gold underline-offset-2 hover:underline disabled:opacity-60"
            >
              {resent === "sending" ? "sending…" : "send it again"}
            </button>
          )}
          , or{" "}
          <button
            type="button"
            onClick={() => {
              setSent(false);
              setResent("idle");
              setNotice(null);
              setError(null);
              setPassword("");
            }}
            className="text-gold underline-offset-2 hover:underline"
          >
            try a different address
          </button>
          .
        </p>
        {error ? (
          <p
            role="alert"
            className="mt-4 rounded-sm border px-3 py-2 text-sm"
            style={{ color: "var(--red-muted)", borderColor: "var(--red-muted)" }}
          >
            {error}
          </p>
        ) : null}
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

      {notice ? (
        <p
          role="status"
          className="mt-4 rounded-sm border border-gold/40 bg-gold/[0.06] px-3 py-2 text-sm text-foreground"
        >
          {notice}
        </p>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="mt-4 rounded-sm border px-3 py-2 text-sm"
          style={{ color: "var(--red-muted)", borderColor: "var(--red-muted)" }}
        >
          {error}
          {canResend && resent !== "done" ? (
            <>
              {" "}
              <button
                type="button"
                onClick={resend}
                disabled={resent === "sending" || !email}
                title={email ? undefined : "Enter your email above first"}
                className="text-gold underline-offset-2 hover:underline disabled:opacity-60"
              >
                {resent === "sending" ? "Sending…" : "Resend the confirmation email"}
              </button>
            </>
          ) : null}
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
