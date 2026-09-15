"use client";

/**
 * One account, and the five things support can do to it.
 *
 * Everything here acts on somebody else. That makes this the screen
 * where an ordinary UI habit — an autosaving field, a button that
 * fires on Enter — is a real hazard, so nothing in it acts on a single
 * keystroke: every action is a named button pressed on purpose, and
 * the two that cannot be walked back ask again before they run.
 *
 * THE ADMIN NEVER LEARNS THE PASSWORD THEY SET. It goes to the auth
 * server and comes back as nothing but "done". The point of the
 * feature is to unstick somebody locked out, not to hold their key —
 * and the reset mail, which leaves the password known only to its
 * owner, is offered first for exactly that reason.
 *
 * ONE THING AT A TIME. A single `busy` marker disables the whole
 * drawer while a write is in flight, because two of these (the plan
 * and the credits) change the same figures, and a double submission
 * against an account somebody rang up about is not worth the two
 * hundred milliseconds it would save.
 */

import * as React from "react";
import {
  Check,
  Coins,
  KeyRound,
  Mail,
  ShieldAlert,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { TIERS, TIER_ORDER, type TierId } from "@/config/app";
import { MIN_PASSWORD, MAX_PASSWORD, MAX_GRANT } from "@/lib/admin/accounts";
import type { AdminAccount } from "@/lib/admin/metrics";
import { fmtDate, fmtNum } from "@/lib/format";
import { MetricLabel } from "@/components/primitives/metric-label";
import { StatusChip } from "@/components/primitives/status-chip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

type Action = "set-password" | "set-email" | "send-reset" | "grant-credits" | "set-tier";

interface Answer {
  ok?: boolean;
  detail?: string | null;
  balance?: number;
  granted?: boolean;
}

/** A block of the drawer: a label, what it does, and its controls. */
function Section({
  icon: Icon,
  label,
  blurb,
  children,
  danger,
}: {
  icon: typeof KeyRound;
  label: string;
  blurb: string;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <section
      className={cn(
        "rounded-sm border p-4",
        danger ? "border-neg/35 bg-[color-mix(in_oklab,var(--color-neg)_5%,var(--color-card))]" : "border-border bg-card"
      )}
    >
      <div className="flex items-center gap-2">
        <Icon aria-hidden className={cn("size-3.5", danger ? "text-neg" : "text-muted-foreground")} />
        <MetricLabel>{label}</MetricLabel>
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{blurb}</p>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function AccountDrawer({
  account,
  onOpenChange,
  onChanged,
}: {
  /** The row that was clicked, or null when the drawer is shut. */
  account: AdminAccount | null;
  onOpenChange: (open: boolean) => void;
  /** Re-read the figures after a write that moved them. */
  onChanged: () => void;
}) {
  const [busy, setBusy] = React.useState<Action | null>(null);
  const [password, setPassword] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [tier, setTier] = React.useState<TierId>("free");
  const [confirming, setConfirming] = React.useState<Action | null>(null);

  // The fields follow the row. Left as they were, a password typed for
  // one account would still be sitting in the box when the next one is
  // opened — which is precisely how it gets applied to the wrong one.
  const id = account?.id ?? null;
  const [shownId, setShownId] = React.useState<string | null>(null);
  if (id !== shownId) {
    setShownId(id);
    setPassword("");
    setEmail(account?.email ?? "");
    setAmount("");
    setTier(account?.tier ?? "free");
    setConfirming(null);
  }

  const run = async (action: Action, payload: Record<string, unknown>) => {
    if (!account) return;
    setBusy(action);
    setConfirming(null);
    try {
      const res = await fetch("/api/admin/account", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, userId: account.id, ...payload }),
      });
      const answer = (await res.json().catch(() => null)) as Answer | null;
      if (!res.ok || !answer?.ok) {
        toast.error(answer?.detail ?? `That didn't go through (HTTP ${res.status})`);
        return;
      }
      return answer;
    } catch {
      toast.error("Couldn't reach the server.");
    } finally {
      setBusy(null);
    }
  };

  const disabled = busy !== null;

  return (
    <Sheet open={account !== null} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-0 sm:max-w-md">
        {account ? (
          <>
            <SheetHeader className="gap-1 border-b border-border px-5 py-4">
              <SheetTitle className="flex flex-wrap items-center gap-2 text-base">
                {account.name}
                <StatusChip tone={account.tier === "free" ? "neutral" : "gold"}>
                  {TIERS[account.tier].name}
                </StatusChip>
              </SheetTitle>
              <SheetDescription>
                {account.email}
                {account.joinedAt ? ` · joined ${fmtDate(account.joinedAt)}` : null}
              </SheetDescription>
            </SheetHeader>

            <div className="space-y-3 px-5 py-5">
              <Section
                icon={Mail}
                label="Password reset"
                blurb="Emails them their own reset link. Try this first — it leaves the password known only to them."
              >
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={disabled || !account.email}
                  onClick={async () => {
                    const out = await run("send-reset", { email: account.email });
                    if (out) toast.success(`Reset link sent to ${account.email}`);
                  }}
                >
                  {busy === "send-reset" ? "Sending…" : "Send reset email"}
                </Button>
              </Section>

              <Section
                icon={Coins}
                label="Grant credits"
                blurb="Straight onto the balance a purchase writes to, with your address and the reason on the ledger entry."
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    value={amount}
                    inputMode="numeric"
                    onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
                    placeholder="25"
                    aria-label="Credits to grant"
                    className="h-9 w-28 tabular"
                    disabled={disabled}
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={disabled || !amount || Number(amount) < 1 || Number(amount) > MAX_GRANT}
                    onClick={async () => {
                      const out = await run("grant-credits", { amount: Number(amount) });
                      if (!out) return;
                      // granted false means the same grant already
                      // landed this minute — a double click, not a
                      // failure, and saying "done" to both would hide
                      // that only one took.
                      toast.success(
                        out.granted
                          ? `Granted ${fmtNum(Number(amount))} — balance ${fmtNum(out.balance ?? 0)}`
                          : `Already granted this minute — balance ${fmtNum(out.balance ?? 0)}`
                      );
                      setAmount("");
                      onChanged();
                    }}
                  >
                    {busy === "grant-credits" ? "Granting…" : "Grant"}
                  </Button>
                  <span className="text-xs text-muted-foreground tabular">
                    holds {fmtNum(account.credits)}
                  </span>
                </div>
              </Section>

              <Section
                icon={ShieldAlert}
                label="Plan"
                blurb="What the meters allow from the next request onward. The same writer the checkout uses."
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Select
                    value={tier}
                    onValueChange={(v) => setTier(v as TierId)}
                    disabled={disabled}
                  >
                    <SelectTrigger className="h-9 w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TIER_ORDER.map((t) => (
                        <SelectItem key={t} value={t}>
                          {TIERS[t].name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={disabled || tier === account.tier}
                    onClick={async () => {
                      const out = await run("set-tier", { tier });
                      if (!out) return;
                      toast.success(`${account.name} is on ${TIERS[tier].name}`);
                      onChanged();
                    }}
                  >
                    {busy === "set-tier" ? "Saving…" : "Move plan"}
                  </Button>
                </div>
              </Section>

              <Section
                icon={Mail}
                label="Address on file"
                blurb="Confirmed on the spot, so they are not locked out by it, and their profile row follows."
                danger
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    value={email}
                    type="email"
                    onChange={(e) => setEmail(e.target.value)}
                    aria-label="New email address"
                    className="h-9 min-w-0 flex-1"
                    disabled={disabled}
                  />
                  {confirming === "set-email" ? (
                    <>
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={disabled}
                        onClick={async () => {
                          const out = await run("set-email", { email });
                          if (!out) return;
                          toast.success(`Address moved to ${out.detail ?? email}`);
                          onChanged();
                        }}
                      >
                        Move it
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={disabled || !email.trim() || email.trim() === account.email}
                      onClick={() => setConfirming("set-email")}
                    >
                      Change
                    </Button>
                  )}
                </div>
              </Section>

              <Section
                icon={KeyRound}
                label="Set a password"
                blurb="For the dead end the reset email can't fix. You will not see it again after this — read it to them and move on."
                danger
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    value={password}
                    // Readable on purpose: whoever types it has to read
                    // it back to the person on the phone, and a masked
                    // field here means it gets written on paper first.
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={`${MIN_PASSWORD}–${MAX_PASSWORD} characters`}
                    aria-label="New password"
                    className="h-9 min-w-0 flex-1"
                    disabled={disabled}
                  />
                  {confirming === "set-password" ? (
                    <>
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={disabled}
                        onClick={async () => {
                          const out = await run("set-password", { password });
                          if (!out) return;
                          toast.success(`Password set for ${account.name}`);
                          setPassword("");
                        }}
                      >
                        Set it
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={
                        disabled ||
                        password.length < MIN_PASSWORD ||
                        password.length > MAX_PASSWORD
                      }
                      onClick={() => setConfirming("set-password")}
                    >
                      Set
                    </Button>
                  )}
                </div>
                {/* Said plainly, because it is the question the person
                    on the other end of the phone asks next. Changing a
                    password does not invalidate refresh tokens the auth
                    server already issued. */}
                <p className="mt-2.5 flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
                  <TriangleAlert aria-hidden className="mt-0.5 size-3 shrink-0 text-neg" />
                  Anyone already signed in on another device stays signed in. Nothing
                  on this panel ends a session that is already open.
                </p>
              </Section>

              <p className="flex items-center gap-1.5 pt-1 text-xs text-muted-foreground">
                <Check aria-hidden className="size-3" />
                Every credit grant is written to the ledger with your address on it.
              </p>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
