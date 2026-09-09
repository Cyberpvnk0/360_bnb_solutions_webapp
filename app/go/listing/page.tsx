"use client";

/**
 * The page a "View photos" click opens while the listing's own page is
 * still being found.
 *
 *   /go/listing?address=<street>&city=<town>&state=<ST>
 *
 * A typed address arrives with no listing page, and finding one is a
 * lookup that can take half a minute the first time. A click in that
 * window used to open a search for the address instead — right, but
 * not what the button promised. This opens at once, asks the listing
 * site (app/api/listing-page, cached for everyone after the first
 * answer), and replaces itself with the listing when it lands. When
 * the site has no page for the address, it replaces itself with the
 * search, which is the honest second choice; the search is on the
 * page too, for anyone who would rather not wait.
 *
 * A bare page, outside the shell: it exists for a second or thirty and
 * then goes away.
 */

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import {
  listingSearchHref,
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

type Outcome = "finding" | "none" | "bad-address";

function Finder() {
  const sp = useSearchParams();
  const place: Addressed = {
    address: sp.get("address")?.trim() ?? "",
    city: sp.get("city")?.trim() ?? "",
    stateCode: sp.get("state")?.trim() ?? "",
  };
  const search = listingSearchHref(place);
  const [outcome, setOutcome] = React.useState<Outcome>(
    search ? "finding" : "bad-address"
  );

  React.useEffect(() => {
    if (!search) return;
    let live = true;
    void (async () => {
      let page: string | null = null;
      try {
        const query = new URLSearchParams({
          address: place.address,
          city: place.city,
          state: place.stateCode,
        });
        const res = await fetch(`/api/listing-page?${query}`);
        const body = (await res.json().catch(() => null)) as {
          ok?: boolean;
          page?: string | null;
        } | null;
        if (res.ok && body?.ok) page = usableListingPage(body.page ?? undefined);
      } catch {
        // No answer is the same as no page for this click: the search
        // is the honest second choice either way.
      }
      if (!live) return;
      if (page) {
        window.location.replace(page);
        return;
      }
      setOutcome("none");
      window.location.replace(search);
    })();
    return () => {
      live = false;
    };
    // The place is read off the URL once; it does not change under us.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const town = [place.city, place.stateCode].filter(Boolean).join(", ");

  return (
    <div className="flex flex-col gap-6 p-6 md:flex-row md:items-center">
      <FindingRing />
      <div className="min-w-0 flex-1">
        <p className="metric-label">
          {outcome === "finding" ? "Finding the listing page" : outcome === "none" ? "Opening the search" : "No address"}
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
        {search ? (
          <a
            href={search}
            className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-gold transition-colors duration-150 hover:text-gold-bright"
          >
            Search the listing sites instead
            <ArrowUpRight aria-hidden className="size-3.5" />
          </a>
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
                <p className="metric-label">Finding the listing page</p>
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
