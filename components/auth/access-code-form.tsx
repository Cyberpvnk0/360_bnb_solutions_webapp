"use client";

/**
 * /access — one field, one button, straight into the admin panel.
 *
 * A link can carry the code after a "#" (…/access#ABCD-EFGH-…), and the
 * page fills it in and signs in on its own. The part after "#" is never
 * sent to any server, so the code does not land in a request log or a
 * referrer; it is cleared from the address bar as soon as it is read.
 */

import * as React from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { MetricLabel } from "@/components/primitives/metric-label";
import { Button } from "@/components/ui/button";

export function AccessCodeForm() {
  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const signIn = React.useCallback(async (value: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/access", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: value }),
        cache: "no-store",
      });
      const body = (await res.json().catch(() => null)) as
        | { ok: true; next: string }
        | { ok: false; message?: string }
        | null;
      if (res.ok && body?.ok) {
        // A full load, so every server component reads the new session.
        window.location.assign(body.next);
        return;
      }
      setError((body && !body.ok && body.message) || "Sign-in failed. Try again.");
    } catch {
      setError("The site could not be reached. Check your connection and try again.");
    }
    setBusy(false);
  }, []);

  React.useEffect(() => {
    const fromLink = decodeURIComponent(window.location.hash.replace(/^#/, "")).trim();
    if (!fromLink) return;
    // Deferred, and the address bar cleared only when it fires: an effect
    // can run twice before it settles, and clearing the code on a pass
    // whose timer is then cancelled would leave nothing to sign in with.
    const t = window.setTimeout(() => {
      window.history.replaceState(null, "", window.location.pathname);
      setCode(fromLink);
      void signIn(fromLink);
    }, 0);
    return () => window.clearTimeout(t);
  }, [signIn]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (code.trim()) void signIn(code);
      }}
      className="rounded-sm border border-border bg-card p-6"
      noValidate
    >
      <MetricLabel>Admin access</MetricLabel>
      <h1 className="mt-1.5 font-display text-2xl font-semibold tracking-tight text-foreground">
        Enter your access code
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        No email or password needed. The code opens the admin panel and every part of the site.
      </p>

      <label className="mt-6 block">
        <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          Access code
        </span>
        <input
          id="access-code"
          type="text"
          inputMode="text"
          autoComplete="one-time-code"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="mt-1.5 h-12 w-full rounded-sm border border-border bg-secondary/40 px-3 font-mono text-lg tracking-[0.12em] text-foreground uppercase placeholder:text-muted-foreground placeholder:normal-case placeholder:tracking-normal focus-visible:border-gold/50"
          placeholder="XXXX-XXXX-XXXX-XXXX"
        />
      </label>

      {error ? (
        <p
          role="alert"
          className="mt-4 rounded-sm border px-3 py-2 text-sm"
          style={{ color: "var(--red-muted)", borderColor: "var(--red-muted)" }}
        >
          {error}
        </p>
      ) : null}

      <Button type="submit" size="lg" className="mt-6 w-full gap-2" disabled={busy || !code.trim()}>
        {busy ? (
          <Loader2 aria-hidden className="size-4 animate-spin" />
        ) : (
          <>
            Open the admin panel
            <ArrowRight aria-hidden className="size-4" />
          </>
        )}
      </Button>
    </form>
  );
}
