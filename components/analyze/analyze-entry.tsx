"use client";

/**
 * Address in, projection out — the entry form.
 *
 * Submitting consumes one pull (stated plainly, with the remaining count).
 * Free and out-of-pulls users never see an error: they get the upgrade
 * modal with their real result blurred behind it.
 */

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Coins, Crosshair, MapPin } from "lucide-react";
import {
  getAnalysis,
  getRecentAnalyses,
  runAddressPull,
  searchAddresses,
  type AddressSuggestion,
} from "@/lib/data";
import type { Analysis, PropertyType } from "@/lib/mock/types";
import { fmtDate } from "@/lib/format";
import { useSession } from "@/components/providers/session-provider";
import { EmptyState } from "@/components/primitives/empty-state";
import { MetricLabel } from "@/components/primitives/metric-label";
import { PageHeader } from "@/components/primitives/page-header";
import { StatusChip } from "@/components/primitives/status-chip";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const BEDROOM_OPTIONS = [1, 2, 3, 4, 5];
const BATHROOM_OPTIONS = ["1", "1.5", "2", "2.5", "3"];
const TYPE_OPTIONS: { value: PropertyType; label: string }[] = [
  { value: "apartment", label: "Apartment" },
  { value: "house", label: "House" },
  { value: "condo", label: "Condo" },
  { value: "townhome", label: "Townhome" },
];

export function AnalyzeEntry({
  initialAnalysis,
}: {
  initialAnalysis: Analysis | null;
}) {
  const router = useRouter();
  const { ready, tier, canPull, pullsRemaining, consumePull, openUpgrade } =
    useSession();

  const [query, setQuery] = React.useState(
    initialAnalysis
      ? `${initialAnalysis.address}, ${initialAnalysis.city}, ${initialAnalysis.stateCode}`
      : ""
  );
  const [selected, setSelected] = React.useState<Analysis | null>(initialAnalysis);
  const [suggestions, setSuggestions] = React.useState<AddressSuggestion[]>([]);
  const [listOpen, setListOpen] = React.useState(false);
  const [bedrooms, setBedrooms] = React.useState(initialAnalysis?.bedrooms ?? 2);
  const [bathrooms, setBathrooms] = React.useState(
    String(initialAnalysis?.bathrooms ?? "2")
  );
  const [propertyType, setPropertyType] = React.useState<PropertyType>(
    initialAnalysis?.propertyType ?? "apartment"
  );
  const [pulling, setPulling] = React.useState(false);
  const [recent, setRecent] = React.useState<Analysis[] | null>(null);

  React.useEffect(() => {
    getRecentAnalyses(5).then(setRecent);
  }, []);

  React.useEffect(() => {
    if (selected || query.trim().length < 2) return;
    let cancelled = false;
    const t = setTimeout(() => {
      searchAddresses(query).then((results) => {
        if (cancelled) return;
        setSuggestions(results);
        setListOpen(results.length > 0);
      });
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, selected]);

  const chooseSeq = React.useRef(0);

  const choose = async (s: AddressSuggestion) => {
    const seq = ++chooseSeq.current;
    setQuery(s.label);
    setListOpen(false);
    setSuggestions([]);
    const analysis = await getAnalysis(s.analysisId);
    // If the user resumed typing while this resolved, drop the stale pick.
    if (seq !== chooseSeq.current) return;
    setSelected(analysis);
    if (analysis) {
      setBedrooms(analysis.bedrooms);
      setBathrooms(String(analysis.bathrooms));
      setPropertyType(analysis.propertyType);
    }
  };

  const submit = async () => {
    if (!selected) return;
    if (!canPull) {
      openUpgrade({ reason: "pulls", analysis: selected });
      return;
    }
    setPulling(true);
    await runAddressPull(selected.id);
    consumePull();
    router.push(`/analyze/${selected.id}`);
  };

  if (pulling && selected) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 md:px-10">
        <MetricLabel>Running pull</MetricLabel>
        <h1 className="mt-1.5 font-display text-2xl font-medium tracking-tight md:text-3xl">
          {selected.address}, {selected.city}
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
              onClick={() => openUpgrade({ reason: "pulls", analysis: selected ?? undefined })}
              className="font-medium text-gold underline-offset-2 transition-colors duration-150 hover:text-gold-bright hover:underline"
            >
              See plans
            </button>
          </p>
        )}
      </div>

      {/* Address */}
      <div className="relative mt-8">
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
              chooseSeq.current += 1; // invalidate any in-flight pick
              setQuery(value);
              setSelected(null);
              if (value.trim().length < 2) {
                setSuggestions([]);
                setListOpen(false);
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
            {suggestions.map((s) => (
              <button
                key={s.analysisId}
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => choose(s)}
                className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground"
              >
                <MapPin aria-hidden className="size-3.5 shrink-0 text-gold" />
                {s.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {/* Unit details */}
      <div className="mt-8 grid gap-6 sm:grid-cols-[1fr_1fr_1.2fr]">
        <div>
          <MetricLabel className="pb-2">Bedrooms</MetricLabel>
          <div
            role="radiogroup"
            aria-label="Bedrooms"
            className="flex overflow-hidden rounded-sm border border-border"
          >
            {BEDROOM_OPTIONS.map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={bedrooms === n}
                onClick={() => setBedrooms(n)}
                className={cn(
                  "h-9 flex-1 border-r border-border text-sm transition-colors duration-150 last:border-r-0 tabular",
                  bedrooms === n
                    ? "bg-secondary font-semibold text-gold"
                    : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                )}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
        <div>
          <MetricLabel className="pb-2">Bathrooms</MetricLabel>
          <div
            role="radiogroup"
            aria-label="Bathrooms"
            className="flex overflow-hidden rounded-sm border border-border"
          >
            {BATHROOM_OPTIONS.map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={bathrooms === n}
                onClick={() => setBathrooms(n)}
                className={cn(
                  "h-9 flex-1 border-r border-border text-xs transition-colors duration-150 last:border-r-0 tabular",
                  bathrooms === n
                    ? "bg-secondary font-semibold text-gold"
                    : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                )}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
        <div>
          <MetricLabel className="pb-2">Property type</MetricLabel>
          <Select
            value={propertyType}
            onValueChange={(v) => setPropertyType(v as PropertyType)}
          >
            <SelectTrigger aria-label="Property type" className="h-9 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TYPE_OPTIONS.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Button
        size="lg"
        className="mt-10 w-full gap-2 sm:w-auto"
        disabled={!selected || !ready}
        onClick={submit}
      >
        Run the numbers
        <ArrowRight aria-hidden className="size-4" />
      </Button>
      {!selected ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Pick an address from the suggestions to continue.
        </p>
      ) : null}

      {/* Recent pulls */}
      <section aria-label="Recent pulls" className="mt-16 pb-12">
        <div className="border-b border-border pb-3">
          <h2 className="text-sm font-semibold text-foreground">Recent pulls</h2>
        </div>
        {recent === null ? (
          <div className="mt-3 space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : recent.length === 0 ? (
          <EmptyState
            icon={Crosshair}
            title="No pulls yet"
            description="Your first address lands here, ready to reopen."
            className="mt-4"
          />
        ) : (
          <ul className="divide-y divide-border">
            {recent.map((a) => (
              <li key={a.id}>
                <Link
                  href={`/analyze/${a.id}`}
                  className="flex items-center justify-between gap-4 py-2.5 transition-colors duration-150 hover:bg-secondary/40"
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
