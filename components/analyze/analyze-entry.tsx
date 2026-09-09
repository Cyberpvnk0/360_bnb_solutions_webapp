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
import { ArrowRight, Coins, Crosshair, Loader2, MapPin } from "lucide-react";
import type { Analysis } from "@/lib/mock/types";
import { fmtWhen } from "@/lib/format";
import { analyzeSearchHref } from "@/lib/live/analyze-href";
import { useSession } from "@/components/providers/session-provider";
import { EmptyState } from "@/components/primitives/empty-state";
import { MetricLabel } from "@/components/primitives/metric-label";
import { PageHeader } from "@/components/primitives/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { AddressSuggestionList } from "@/components/shell/address-suggestion-list";
import {
  MIN_QUERY_LENGTH,
  resolveSuggestionPoint,
  useAddressSuggestions,
  type AddressSuggestion,
} from "@/components/shell/use-address-suggestions";

/** A geocoded place: what the geocoder calls it, and where it is. */
interface AddressMatch {
  address: string;
  /** The parts, when a suggestion carried them — the result prints
   *  the street with the city under it rather than the line twice. */
  street?: string;
  city?: string;
  state?: string;
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
  const { ready, tier, canSpend, creditsRemaining, spendCredit, openUpgrade, activity } =
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
  const [listOpen, setListOpen] = React.useState(false);
  /** A picked suggestion is being placed (text-only providers). */
  const [locating, setLocating] = React.useState(false);
  const [pulling, setPulling] = React.useState(false);

  // Live suggestions for what is typed — paused once the text IS the
  // picked address, so picking does not immediately look it up again.
  const { suggestions, searching, noMatch } = useAddressSuggestions(query, {
    enabled: place?.address !== query.trim(),
  });
  const showList = listOpen && query.trim().length >= MIN_QUERY_LENGTH && !place;

  // The highlight belongs to one list: a new list starts from its first
  // row. Derived during render rather than reset in an effect.
  const [highlightFor, setHighlightFor] = React.useState<{
    list: AddressSuggestion[];
    index: number;
  } | null>(null);
  const highlighted = highlightFor?.list === suggestions ? highlightFor.index : 0;
  const setHighlighted = (next: number | ((h: number) => number)) =>
    setHighlightFor({
      list: suggestions,
      index: typeof next === "function" ? next(highlighted) : next,
    });

  /**
   * This account's own recent analyses: the pulls it has paid for,
   * read from its activity, each carrying the URL that reopens the
   * property. There is no seeded history — a new account's list is
   * empty because it is.
   */
  const recent = React.useMemo(
    () => activity.filter((e) => e.type === "pull" && e.href).slice(0, 5),
    [activity]
  );

  const choose = async (match: AddressSuggestion) => {
    setQuery(match.address);
    setListOpen(false);
    setLocating(true);
    const point = await resolveSuggestionPoint(match);
    setLocating(false);
    setPlace({
      address: match.address,
      street: match.street,
      city: match.city,
      state: match.state,
      point,
    });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!showList) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const s = suggestions[highlighted];
      if (s) void choose(s);
    } else if (e.key === "Escape") {
      setListOpen(false);
    }
  };

  const ready_ = place?.point != null;

  const submit = () => {
    if (!place?.point) return;
    if (!canSpend) {
      openUpgrade({ reason: "credits" });
      return;
    }
    setPulling(true);
    spendCredit();
    // The parameters are the analysis: shareable, reloadable, and no
    // row to write or migration to run.
    //
    // No size. Asking for bedrooms and baths before showing anything
    // put three questions between a person and the answer they came
    // for — and the result page can offer the same correction against a
    // projection they can watch respond to it.
    router.push(analyzeSearchHref({ ...place, point: place.point }));
  };

  if (pulling && place) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 md:px-10">
        <MetricLabel>Running pull</MetricLabel>
        <h1 className="mt-1.5 font-display text-2xl font-semibold tracking-tight md:text-3xl">
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
        description="One credit turns an address into a breakeven read backed by the comps around it."
      />

      {/* Credit cost notice */}
      <div
        className={cn(
          "mt-8 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-sm border px-5 py-4",
          !ready || canSpend
            ? "border-gold-fill/40 bg-gold-fill/5"
            : "border-neg/40 bg-neg/5"
        )}
      >
        <Coins
          aria-hidden
          className={cn("size-4", canSpend ? "text-gold" : "text-neg")}
        />
        {!ready ? (
          <Skeleton className="h-4 w-64" />
        ) : canSpend ? (
          <p className="text-sm text-foreground">
            Submitting spends <span className="font-semibold">1 credit</span>.
            You have{" "}
            <span className="font-semibold tabular">{creditsRemaining}</span>{" "}
            left this month.
          </p>
        ) : (
          <p className="text-sm text-foreground">
            {tier.id === "free"
              ? "The Free plan includes no credits."
              : "You've used every credit this month."}{" "}
            <button
              type="button"
              onClick={() => openUpgrade({ reason: "credits" })}
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
                aria-expanded={showList}
                aria-controls="analyze-address-listbox"
                aria-autocomplete="list"
                aria-label="Property address"
                placeholder="Start typing a street address…"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  // Typing invalidates the pick: the coordinates on
                  // screen belong to the previous address, and running
                  // a projection at them would be quietly wrong.
                  setPlace(null);
                  setListOpen(true);
                }}
                onKeyDown={onKeyDown}
                onFocus={() => setListOpen(true)}
                onBlur={() => setListOpen(false)}
                className="h-12 w-full rounded-sm border border-border bg-card pl-10 pr-10 text-base text-foreground placeholder:text-muted-foreground focus-visible:border-select/50"
              />
              {locating || (searching && !place) ? (
                <Loader2
                  aria-hidden
                  className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground"
                />
              ) : null}
            </div>
            {showList ? (
              <div className="absolute left-0 right-0 z-30 mt-1">
                <AddressSuggestionList
                  id="analyze-address-listbox"
                  suggestions={suggestions}
                  highlighted={highlighted}
                  onHighlight={setHighlighted}
                  onChoose={(s) => void choose(s)}
                  footer={
                    searching && suggestions.length === 0
                      ? "Searching…"
                      : noMatch
                        ? "No address matches yet — keep typing, or add the city."
                        : "Pick the address to continue"
                  }
                />
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
              {locating
                ? "Placing that address…"
                : place && !place.point
                  ? "That address couldn't be placed on the map. Try picking it again, or a neighbouring one."
                  : searching
                    ? "Looking up that address…"
                    : noMatch
                      ? "No address matches yet. Keep typing, or add the city."
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
        {!ready ? (
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
            {recent.map((e) => (
              <li key={e.id}>
                {/* Fills the pins' red on hover, like a comp row: the
                    same "this one" signal everywhere a row can be
                    picked. */}
                <Link
                  href={e.href!}
                  className="group flex items-center justify-between gap-4 px-6 py-2.5 transition-colors duration-150 hover:bg-select focus-visible:bg-select focus-visible:outline-none"
                >
                  <span className="min-w-0 truncate text-sm text-foreground transition-colors duration-150 group-hover:text-white group-focus-visible:text-white">
                    {e.message.replace(/^Analyzed /, "")}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground transition-colors duration-150 tabular group-hover:text-white/85 group-focus-visible:text-white/85">
                    {fmtWhen(e.at)}
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
