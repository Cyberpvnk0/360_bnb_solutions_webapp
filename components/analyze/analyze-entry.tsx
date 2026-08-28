"use client";

/**
 * Address in, projection out — the entry form.
 *
 * It now does that. What was here searched a hardcoded list of invented
 * addresses and, on submit, waited two seconds before opening one of
 * thirty seeded analyses regardless of what had been typed. Any real
 * address returned somebody else's property, convincingly.
 *
 * Suggestions come from the public federal geocoder — free, keyless,
 * nothing billed — so they can be fetched on every debounced keystroke.
 * Picking one carries its coordinates through to the result, where the
 * comps are drawn around that exact point rather than around the
 * market's centre.
 *
 * Submitting consumes one pull (stated plainly, with the remaining count).
 * Free and out-of-pulls users never see an error: they get the upgrade
 * modal with their real result blurred behind it.
 */

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Coins, Crosshair, MapPin } from "lucide-react";
import { getRecentAnalyses } from "@/lib/data";
import type { Analysis } from "@/lib/mock/types";
import { fmtDate } from "@/lib/format";
import { useSession } from "@/components/providers/session-provider";
import { EmptyState } from "@/components/primitives/empty-state";
import { MetricLabel } from "@/components/primitives/metric-label";
import { PageHeader } from "@/components/primitives/page-header";
import { StatusChip } from "@/components/primitives/status-chip";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** A geocoded place: what the geocoder calls it, and where it is. */
interface AddressMatch {
  address: string;
  point: { lat: number; lon: number } | null;
}


export function AnalyzeEntry({
  initialAnalysis,
  prefill = null,
}: {
  initialAnalysis: Analysis | null;
  /** A geocoded address handed over by the top-bar search, coordinates
   *  and all, so this form does not resolve the same string twice. */
  prefill?: AddressMatch | null;
}) {
  const router = useRouter();
  const { ready, tier, canPull, pullsRemaining, consumePull, openUpgrade } =
    useSession();

  const [query, setQuery] = React.useState(
    prefill?.address ??
      (initialAnalysis
        ? `${initialAnalysis.address}, ${initialAnalysis.city}, ${initialAnalysis.stateCode}`
        : "")
  );
  /** The geocoded place this will analyse. Null until one is picked. */
  const [place, setPlace] = React.useState<AddressMatch | null>(
    prefill ??
      (initialAnalysis
        ? {
            address: `${initialAnalysis.address}, ${initialAnalysis.city}, ${initialAnalysis.stateCode}`,
            // No coordinates: a listing handed over from the Deal Finder
            // carries an address but not a geocode, so the box asks for
            // a pick before it will run. Better than projecting at a
            // point we do not have.
            point: null,
          }
        : null)
  );
  const [suggestions, setSuggestions] = React.useState<AddressMatch[]>([]);
  const [listOpen, setListOpen] = React.useState(false);
  const [searching, setSearching] = React.useState(false);
  /** Set when a lookup completed and matched nothing — a typo and an
   *  outage look identical without it. */
  const [noMatch, setNoMatch] = React.useState(false);
  const [pulling, setPulling] = React.useState(false);
  const [recent, setRecent] = React.useState<Analysis[] | null>(null);

  React.useEffect(() => {
    getRecentAnalyses(5).then(setRecent);
  }, []);

  React.useEffect(() => {
    const q = query.trim();
    // Already resolved to the thing being shown; nothing to look up.
    if (place?.address === q) return;
    // Too short to look up. Clearing the list is the change handler's
    // job, not this effect's — a synchronous setState here would run on
    // every render that passes through a short query, and the compiler
    // is right to refuse it.
    if (q.length < 4) return;

    let cancelled = false;
    // Long enough that a street number and name are usually complete —
    // the geocoder matches whole addresses, not prefixes, so firing on
    // every character mostly buys empty results.
    const t = setTimeout(async () => {
      setSearching(true);
      setNoMatch(false);
      try {
        const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
        const body = (await res.json()) as { matches?: AddressMatch[] };
        if (cancelled) return;
        const matches = body.matches ?? [];
        setSuggestions(matches);
        setListOpen(matches.length > 0);
        setNoMatch(matches.length === 0);
      } catch {
        if (!cancelled) setNoMatch(false);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, place]);

  const choose = (match: AddressMatch) => {
    setQuery(match.address);
    setPlace(match);
    setListOpen(false);
    setSuggestions([]);
    setNoMatch(false);
  };

  const ready_ = place?.point != null;

  const submit = () => {
    if (!place?.point) return;
    if (!canPull) {
      openUpgrade({ reason: "pulls" });
      return;
    }
    setPulling(true);
    consumePull();
    // The parameters are the analysis: shareable, reloadable, and no
    // row to write or migration to run.
    //
    // No size. Asking for bedrooms and baths before showing anything
    // put three questions between a person and the answer they came
    // for — and the result page can offer the same correction against a
    // projection they can watch respond to it.
    const params = new URLSearchParams({
      a: place.address,
      lat: String(place.point.lat),
      lon: String(place.point.lon),
    });
    router.push(`/analyze/new?${params}`);
  };

  if (pulling && place) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 md:px-10">
        <MetricLabel>Running pull</MetricLabel>
        <h1 className="mt-1.5 font-display text-2xl font-medium tracking-tight md:text-3xl">
          {place.address}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Reading nearby short-term rentals and lease listings…
        </p>
        <div className="mt-8 flex flex-col items-center border-y border-border py-10">
          <Skeleton className="size-56 rounded-full" />
          <Skeleton className="mt-5 h-4 w-48" />
        </div>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 md:px-10">
      <PageHeader
        title="Analyze an address"
        description="One pull turns an address into a breakeven read backed by the comps around it."
      />

      {/* Pull cost notice */}
      <div
        className={cn(
          "mt-8 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-sm border px-5 py-4",
          !ready || canPull
            ? "border-gold-fill/40 bg-gold-fill/5"
            : "border-neg/40 bg-neg/5"
        )}
      >
        <Coins
          aria-hidden
          className={cn("size-4", canPull ? "text-gold" : "text-neg")}
        />
        {!ready ? (
          <Skeleton className="h-4 w-64" />
        ) : canPull ? (
          <p className="text-sm text-foreground">
            Submitting consumes <span className="font-semibold">1 pull</span>.
            You have{" "}
            <span className="font-semibold tabular">{pullsRemaining}</span>{" "}
            remaining this period.
          </p>
        ) : (
          <p className="text-sm text-foreground">
            {tier.id === "free"
              ? "The Free plan includes no address pulls."
              : "You've used every pull this period."}{" "}
            <button
              type="button"
              onClick={() => openUpgrade({ reason: "pulls" })}
              className="font-medium text-gold underline-offset-2 transition-colors duration-150 hover:text-gold-bright hover:underline"
            >
              See plans
            </button>
          </p>
        )}
      </div>

      {/* Property card — address, unit details and the submit action */}
      <section
        aria-label="Property"
        className="mt-6 rounded-sm border border-border bg-card"
      >
        <div className="border-b border-border px-6 py-4">
          <h2 className="text-sm font-semibold text-foreground">Property</h2>
        </div>
        <div className="p-6">
          {/* Address */}
          <div className="relative">
            <MetricLabel className="pb-2">Property address</MetricLabel>
            <div className="relative">
              <MapPin
                aria-hidden
                className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <input
                type="text"
                role="combobox"
                aria-expanded={listOpen}
                aria-controls="analyze-address-listbox"
                aria-autocomplete="list"
                aria-label="Property address"
                placeholder="Start typing a street address…"
                value={query}
                onChange={(e) => {
                  const value = e.target.value;
                  setQuery(value);
                  // Typing invalidates the pick: the coordinates on
                  // screen belong to the previous address, and running
                  // a projection at them would be quietly wrong.
                  setPlace(null);
                  if (value.trim().length < 4) {
                    setSuggestions([]);
                    setListOpen(false);
                    setNoMatch(false);
                  }
                }}
                className="h-12 w-full rounded-sm border border-border bg-card pl-10 pr-4 text-base text-foreground placeholder:text-muted-foreground focus-visible:border-gold/50"
              />
            </div>
            {listOpen ? (
              <div
                id="analyze-address-listbox"
                role="listbox"
                className="absolute left-0 right-0 z-30 mt-1 overflow-hidden rounded-sm border border-border bg-popover"
              >
                {suggestions.map((match) => (
                  <button
                    key={`${match.address}|${match.point?.lat}`}
                    type="button"
                    role="option"
                    aria-selected={false}
                    onClick={() => choose(match)}
                    className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground"
                  >
                    <MapPin aria-hidden className="size-3.5 shrink-0 text-gold" />
                    {match.address}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <Button
            size="lg"
            className="mt-8 w-full gap-2 sm:w-auto"
            disabled={!ready_ || !ready}
            onClick={submit}
          >
            Run the numbers
            <ArrowRight aria-hidden className="size-4" />
          </Button>
          {ready_ ? null : (
            <p className="mt-2 text-xs text-muted-foreground">
              {searching
                ? "Looking up that address…"
                : noMatch
                  ? "No match for that address. Check the street number and spelling, or add the city and state."
                  : "Pick an address from the suggestions to continue."}
            </p>
          )}
        </div>
      </section>

      {/* Recent pulls */}
      <section
        aria-label="Recent pulls"
        className="mb-12 mt-12 overflow-hidden rounded-sm border border-border bg-card"
      >
        <div className="border-b border-border px-6 py-4">
          <h2 className="text-sm font-semibold text-foreground">Recent pulls</h2>
        </div>
        {recent === null ? (
          <div className="divide-y divide-border">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center justify-between gap-4 px-6 py-2.5"
              >
                <Skeleton className="h-5 w-56 max-w-full" />
                <Skeleton className="h-[21px] w-24 shrink-0" />
              </div>
            ))}
          </div>
        ) : recent.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={Crosshair}
              title="No pulls yet"
              description="Your first address lands here, ready to reopen."
            />
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {recent.map((a) => (
              <li key={a.id}>
                <Link
                  href={`/analyze/${a.id}`}
                  className="flex items-center justify-between gap-4 px-6 py-2.5 transition-colors duration-150 hover:bg-secondary/40"
                >
                  <span className="min-w-0 truncate text-sm text-foreground">
                    {a.address}, {a.city}, {a.stateCode}
                  </span>
                  <span className="flex shrink-0 items-center gap-3">
                    <StatusChip tone="outline">{a.bedrooms} bd</StatusChip>
                    <span className="text-xs text-muted-foreground tabular">
                      {fmtDate(a.createdAt)}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
