"use client";

/**
 * The page a "View photos" click opens while the listing's own page is
 * still being found.
 *
 *   /go/listing?address=<street>&city=<town>&state=<ST>
 *
 * A row can arrive with no listing page, and finding one is a lookup
 * that can take half a minute the first time. A click in that window
 * used to open somewhere else instead — right, but not what the button
 * promised. This opens at once, asks the listing site (through
 * app/api/listing-page, cached for everyone after the first answer),
 * and replaces itself with the listing when it lands. When the site
 * has no page for the address, it replaces itself with the next
 * destination in order — the address's page on Zillow — and every
 * destination (Zillow, Realtor, Google) is on the page too, for anyone
 * who would rather not wait. See lib/live/listing-links for the order.
 *
 * A bare page, outside the shell: it exists for a second or thirty and
 * then goes away.
 */

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import {
  pageQuery,
  photoSources,
  usableListingPage,
  type Addressed,
} from "@/lib/live/listing-links";

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

type Outcome = "finding" | "next" | "bad-address";

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
  // Everywhere else the photos may be, in order, once the listing site
  // has been asked; the first of them is where this lands when the
  // site has no page.
  const others = photoSources(place).filter((s) => s.id !== "redfin");
  const next = others[0] ?? null;
  const [outcome, setOutcome] = React.useState<Outcome>(next ? "finding" : "bad-address");

  React.useEffect(() => {
    if (!next) return;
    let live = true;
    void (async () => {
      let page: string | null = null;
      try {
        const res = await fetch(`/api/listing-page?${pageQuery(place)}`);
        const body = (await res.json().catch(() => null)) as {
          ok?: boolean;
          page?: string | null;
        } | null;
        if (res.ok && body?.ok) page = usableListingPage(body.page ?? undefined);
      } catch {
        // No answer is the same as no page for this click: the next
        // destination is the honest second choice either way.
      }
      if (!live) return;
      if (page) {
        window.location.replace(page);
        return;
      }
      setOutcome("next");
      window.location.replace(next.href);
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
            : outcome === "next"
              ? `Opening it on ${next?.label ?? "the next site"}`
              : "No address"}
        </p>
        <h1 className="mt-1 truncate font-display text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
          {place.address || "This property"}
        </h1>
        {town ? <p className="mt-0.5 text-sm text-muted-foreground">{town}</p> : null}
        <p className="mt-3 text-sm text-muted-foreground">
          {outcome === "bad-address"
            ? "This link carries too little of an address to find a listing for."
            : "This can take up to half a minute the first time an address is looked up."}
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
