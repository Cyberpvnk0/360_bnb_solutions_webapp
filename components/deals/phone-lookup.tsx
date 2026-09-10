"use client";

/**
 * The deep phone lookup, in the contact panel.
 *
 * Offered only where the listing site gave no number. One button that
 * says what it is and what it costs; press it and public records are
 * searched for the property's owner and their number. Charged only
 * when a number comes back, and the button says that too, because a
 * cost that might not apply is exactly the kind a person wants stated
 * before they press.
 *
 * The answer is kept for the session by listing, so closing and
 * reopening the panel does not ask — or charge — again. The server
 * keeps the account's own record for the month besides.
 *
 * What is shown is what came back: a name when there is one, numbers
 * with what kind they are, and a do-not-call mark where the records
 * carry one — never hidden, since the person about to dial is the one
 * it is for.
 */

import * as React from "react";
import { Loader2, Mail, Phone, ShieldAlert } from "lucide-react";
import { PHONE_LOOKUP_CREDITS } from "@/config/app";
import { useSession } from "@/components/providers/session-provider";
import type { PhoneLookupResult } from "@/lib/live/phone-lookup";
import type { RentalListing } from "@/lib/mock/types";
import { cn } from "@/lib/utils";

type State =
  | { status: "idle" }
  | { status: "looking" }
  | { status: "found"; result: PhoneLookupResult; charged: number }
  | { status: "none"; result: PhoneLookupResult | null }
  | { status: "failed"; reason: string };

const IDLE: State = { status: "idle" };
/** Session cache: one answer per listing, paid for once. */
const answers = new Map<string, State>();

function failureCopy(reason: string): string {
  switch (reason) {
    case "not-configured":
    case "no-key":
      return "Deep lookup isn't set up on this deployment yet.";
    case "auth":
      return "The records provider refused this deployment's key.";
    case "quota":
      return "The records provider is over its limit right now. Nothing was charged.";
    case "no-zip":
      return "This address has no ZIP to look it up by.";
    case "unreadable":
      return "The records provider answered in a shape this can't read. Nothing was charged.";
    default:
      return "The lookup didn't go through. Nothing was charged.";
  }
}

export function PhoneLookup({
  listing,
  className,
}: {
  listing: RentalListing;
  className?: string;
}) {
  const { creditsRemaining, credits, openUpgrade, refreshUsage } = useSession();
  const [, rerender] = React.useReducer((n: number) => n + 1, 0);
  const state = answers.get(listing.id) ?? IDLE;
  const affordable = creditsRemaining + credits >= PHONE_LOOKUP_CREDITS;

  const settle = (next: State) => {
    answers.set(listing.id, next);
    rerender();
  };

  const run = async () => {
    if (!affordable) {
      openUpgrade({ reason: "credits" });
      return;
    }
    settle({ status: "looking" });
    try {
      const res = await fetch("/api/phone-lookup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          address: listing.address,
          city: listing.city,
          state: listing.stateCode,
          zip: listing.zip,
          lat: listing.lat,
          lon: listing.lon,
        }),
      });
      const body = (await res.json().catch(() => null)) as {
        ok?: boolean;
        found?: boolean;
        result?: PhoneLookupResult | null;
        charged?: number;
        reason?: string;
      } | null;
      if (res.status === 402 || body?.reason === "no-credits") {
        settle(IDLE);
        openUpgrade({ reason: "credits" });
        return;
      }
      if (!res.ok || !body?.ok) {
        settle({ status: "failed", reason: body?.reason ?? "network" });
        return;
      }
      if (body.found && body.result) {
        settle({ status: "found", result: body.result, charged: body.charged ?? 0 });
        // The header's count moves to the server's figure.
        void refreshUsage();
        return;
      }
      settle({ status: "none", result: body.result ?? null });
    } catch {
      settle({ status: "failed", reason: "network" });
    }
  };

  const button = (label: string, busy = false) => (
    <button
      type="button"
      onClick={() => void run()}
      disabled={busy}
      title={`Searches public records for the owner's phone number. ${PHONE_LOOKUP_CREDITS} credits, charged only when a number is found.`}
      className={cn(
        "inline-flex h-8 w-fit items-center gap-1.5 rounded-sm border border-gold/60 bg-gold-fill/10 px-3 text-sm font-medium text-foreground transition-colors duration-150 hover:bg-gold-fill/20 disabled:cursor-default disabled:opacity-80",
        className
      )}
    >
      {busy ? (
        <Loader2 aria-hidden className="size-3.5 animate-spin" />
      ) : (
        <Phone aria-hidden className="size-3.5 text-gold" />
      )}
      {label}
      {!busy ? (
        <span className="text-xs text-muted-foreground">· {PHONE_LOOKUP_CREDITS} credits</span>
      ) : null}
    </button>
  );

  if (state.status === "idle") return button("Deep phone lookup");
  if (state.status === "looking") return button("Searching public records…", true);

  if (state.status === "failed") {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">{failureCopy(state.reason)}</p>
        {["not-configured", "no-key", "auth", "no-zip"].includes(state.reason) ? null : (
          <div>{button("Try the deep lookup again")}</div>
        )}
      </div>
    );
  }

  const result = state.status === "found" ? state.result : state.result;
  const persons = result?.persons ?? [];

  return (
    <div className="flex flex-col gap-3">
      {state.status === "none" ? (
        <p className="text-sm text-muted-foreground">
          No phone number in public records for this address. Nothing was charged.
        </p>
      ) : null}
      {persons.map((person, i) => (
        <div key={i} className="flex flex-col gap-1.5">
          <p className="text-sm font-medium text-foreground">
            {person.name ?? "Property owner"}
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              public records
            </span>
          </p>
          {person.phones.map((phone) => (
            <div key={phone.number} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <a
                href={`tel:${phone.number.replace(/[^\d+]/g, "")}`}
                className="inline-flex items-center gap-1.5 font-medium text-foreground tabular transition-colors duration-150 hover:text-gold"
              >
                <Phone aria-hidden className="size-3.5 text-muted-foreground" />
                {phone.number}
              </a>
              {phone.type !== "unknown" ? (
                <span className="text-xs text-muted-foreground">
                  {phone.type === "mobile" ? "Mobile" : "Landline"}
                </span>
              ) : null}
              {phone.dnc ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-neg/40 px-2 py-0.5 text-[11px] font-medium text-neg">
                  <ShieldAlert aria-hidden className="size-3" />
                  Do not call
                </span>
              ) : null}
            </div>
          ))}
          {person.emails.map((email) => (
            <a
              key={email}
              href={`mailto:${email}`}
              className="inline-flex w-fit items-center gap-1.5 text-sm text-foreground transition-colors duration-150 hover:text-gold"
            >
              <Mail aria-hidden className="size-3.5 text-muted-foreground" />
              {email}
            </a>
          ))}
        </div>
      ))}
      {state.status === "found" ? (
        <p className="text-xs text-muted-foreground">
          Usually the owner rather than the manager.
          {state.charged > 0 ? ` ${state.charged} credits.` : " No charge this time."}
          {persons.some((p) => p.phones.some((ph) => ph.dnc))
            ? " A marked number is on a do-not-call list; calling and texting rules apply."
            : ""}
        </p>
      ) : null}
    </div>
  );
}
