"use client";

/**
 * The page a "View photos" click opens while the right site is being
 * picked.
 *
 *   /go/listing?address=<street>&city=<town>&state=<ST>
 *
 * A row can arrive with no listing page. This opens at once, asks
 * app/api/photos-target where the click should land — the listing's
 * own page when it can be had in a few seconds, Zillow's page for the
 * home when Zillow says it has one, its address page otherwise, and
 * pictures of the address on Google when Zillow said no — and replaces
 * itself with the answer. Every destination is on the page too, for
 * anyone who would rather not wait the few seconds. See
 * lib/live/photos-target.
 *
 * A bare page, outside the shell: it exists for a few seconds and then
 * goes away.
 */

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import { pageQuery, photoSources, type Addressed } from "@/lib/live/listing-links";

function FindingRing() {
  return (
    <div className="relative flex size-[104px] shrink-0 items-center justify-center">
      <span
        aria-hidden
        className="working-glow absolute inset-3 rounded-full bg-select/25 blur-xl"
      />
      <svg viewBox="0 0 48 48" className="working-ring relative size-14" aria-hidden>
        <circle className="track" cx="24" cy="24" r="20" />
        <circle className="arc" cx="24" cy="24" r="20" />
      </svg>
    </div>
  );
}

type Outcome = "finding" | "opening" | "bad-address";

function Finder() {
  const sp = useSearchParams();
  const lat = Number(sp.get("lat"));
  const lon = Number(sp.get("lon"));
  const place: Addressed = {
    address: sp.get("address")?.trim() ?? "",
    city: sp.get("city")?.trim() ?? "",
    stateCode: sp.get("state")?.trim() ?? "",
    zip: sp.get("zip")?.trim() || undefined,
    point: Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : undefined,
  };
  // Everywhere else the photos may be, in order — on the page for
  // anyone who would rather not wait; the first of them is where this
  // lands if the answer never comes.
  const others = photoSources(place).filter((s) => s.id !== "redfin");
  const next = others[0] ?? null;
  const [outcome, setOutcome] = React.useState<Outcome>(next ? "finding" : "bad-address");
  const [opening, setOpening] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!next) return;
    let live = true;
    void (async () => {
      let href: string | null = null;
      let label: string | null = null;
      try {
        const res = await fetch(`/api/photos-target?${pageQuery(place)}`);
        const body = (await res.json().catch(() => null)) as {
          ok?: boolean;
          href?: string;
          source?: string;
        } | null;
        if (res.ok && body?.ok && typeof body.href === "string" && /^https:\/\//.test(body.href)) {
          href = body.href;
          label =
            body.source === "redfin" ? "Redfin" : body.source === "google" ? "Google" : "Zillow";
        }
      } catch {
        // No answer: the next destination in order is where the click
        // would have gone anyway.
      }
      if (!live) return;
      setOutcome("opening");
      setOpening(label ?? next.label);
      window.location.replace(href ?? next.href);
    })();
    return () => {
      live = false;
    };
    // The place is read off the URL once; it does not change under us.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [next?.href]);

  const town = [place.city, place.stateCode].filter(Boolean).join(", ");

  return (
    <div className="flex flex-col gap-6 p-6 md:flex-row md:items-center">
      <FindingRing />
      <div className="min-w-0 flex-1">
        <p className="metric-label">
          {outcome === "finding"
            ? "Finding the listing"
            : outcome === "opening"
              ? `Opening it on ${opening ?? "the next site"}`
              : "No address"}
        </p>
        <h1 className="mt-1 truncate font-display text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
          {place.address || "This property"}
        </h1>
        {town ? <p className="mt-0.5 text-sm text-muted-foreground">{town}</p> : null}
        <p className="mt-3 text-sm text-muted-foreground">
          {outcome === "bad-address"
            ? "This link carries too little of an address to find a listing for."
            : "A few seconds, at most."}
        </p>
        {others.length > 0 ? (
          <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="text-muted-foreground">Or open it on</span>
            {others.map((s) => (
              <a
                key={s.id}
                href={s.href}
                className="inline-flex items-center gap-0.5 font-medium text-gold transition-colors duration-150 hover:text-gold-bright"
              >
                {s.label}
                <ArrowUpRight aria-hidden className="size-3.5" />
              </a>
            ))}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export default function FindListingPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-6">
      <div className="w-full max-w-2xl overflow-hidden rounded-sm border border-border bg-card elev-panel">
        {/* useSearchParams may suspend during prerendering. */}
        <React.Suspense
          fallback={
            <div className="flex flex-col gap-6 p-6 md:flex-row md:items-center">
              <FindingRing />
              <div className="min-w-0 flex-1">
                <p className="metric-label">Finding the listing</p>
              </div>
            </div>
          }
        >
          <Finder />
        </React.Suspense>
      </div>
    </main>
  );
}
