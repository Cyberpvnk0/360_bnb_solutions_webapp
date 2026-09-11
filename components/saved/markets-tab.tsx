"use client";

/**
 * The markets an account has kept.
 *
 * Catalogue facts only — where it is, what kind of place, what the
 * local rule says — because those are the three things researched for
 * every market and they are true whether or not anybody has paid for
 * its figures. The measured performance lives on the market's own page,
 * one click away, rather than being half-loaded into a list.
 */

import * as React from "react";
import Link from "next/link";
import { ArrowUpRight, Binoculars, Bookmark, MapPin, X } from "lucide-react";
import { toast } from "sonner";
import { csvFileName, downloadCsv, toCsv, type CsvColumn } from "@/lib/export/csv";
import { fmtMoney, fmtNum } from "@/lib/format";
import { RULE_LABEL, RULE_TONE, TERRAIN_LABEL } from "@/lib/markets/explorer";
import { MARKET_BY_SLUG } from "@/lib/mock/markets";
import type { Market } from "@/lib/mock/types";
import { useSession } from "@/components/providers/session-provider";
import { EmptyState } from "@/components/primitives/empty-state";
import { InfoHint } from "@/components/primitives/info-hint";
import { StatusChip } from "@/components/primitives/status-chip";
import { Button } from "@/components/ui/button";

const COLUMNS: CsvColumn<Market>[] = [
  { header: "Market", value: (m) => m.name },
  { header: "State", value: (m) => m.stateCode },
  { header: "Type", value: (m) => TERRAIN_LABEL[m.terrain] },
  { header: "Regulation", value: (m) => RULE_LABEL[m.regulation.status] },
  { header: "Rule note", value: (m) => m.regulation.note },
  { header: "2BR rent (estimate)", value: (m) => m.medianRent2br },
];

function MarketCard({ market }: { market: Market }) {
  const { toggleWatchMarket } = useSession();
  return (
    <li className="group relative flex flex-col rounded-sm border border-border bg-card elev-card">
      <div className="flex items-start justify-between gap-3 px-5 pt-4">
        <div className="min-w-0">
          <Link
            href={`/markets/${market.slug}`}
            className="truncate font-display text-base font-semibold text-foreground transition-colors duration-150 hover:text-gold"
          >
            {market.name}, {market.stateCode}
          </Link>
          <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
            <MapPin aria-hidden className="size-3" />
            {TERRAIN_LABEL[market.terrain]}
          </p>
        </div>
        <button
          type="button"
          aria-label={`Remove ${market.name}`}
          onClick={() => {
            toggleWatchMarket(market.slug);
            toast.success(`Removed ${market.name}`);
          }}
          className="shrink-0 rounded-full p-1 text-muted-foreground opacity-0 transition-opacity duration-150 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
        >
          <X aria-hidden className="size-3.5" />
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 px-5">
        <StatusChip tone={RULE_TONE[market.regulation.status]}>
          {RULE_LABEL[market.regulation.status]}
        </StatusChip>
        <InfoHint label={`the rule in ${market.name}`}>
          {market.regulation.note}
        </InfoHint>
        <span className="ml-auto text-[11px] text-muted-foreground tabular">
          2BR {fmtMoney(market.medianRent2br)}
          <span className="text-muted-foreground/70"> est.</span>
        </span>
      </div>

      <div className="mt-4 flex items-center gap-2 border-t border-border px-5 py-3">
        <Button asChild variant="outline" size="sm" className="flex-1 gap-1.5">
          <Link href={`/markets/${market.slug}`}>
            Market
            <ArrowUpRight aria-hidden className="size-3.5" />
          </Link>
        </Button>
        <Button asChild size="sm" className="flex-1 gap-1.5">
          <Link href={`/deals?market=${market.slug}`}>
            <Binoculars aria-hidden className="size-3.5" />
            Rentals
          </Link>
        </Button>
      </div>
    </li>
  );
}

export function MarketsTab() {
  const { watchedMarketSlugs, tier, openUpgrade, recordExport } = useSession();

  const markets = React.useMemo(
    () =>
      watchedMarketSlugs
        .map((slug) => MARKET_BY_SLUG.get(slug))
        .filter((m): m is Market => !!m)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [watchedMarketSlugs]
  );

  if (markets.length === 0) {
    return (
      <EmptyState
        icon={Bookmark}
        title="No markets kept yet"
        description="Open a market and press Save market. The ones you keep land here, with the local rule and a way straight into their rentals."
        action={
          <Button asChild size="sm" className="gap-1.5">
            <Link href="/markets">
              Browse markets
              <ArrowUpRight aria-hidden className="size-3.5" />
            </Link>
          </Button>
        }
      />
    );
  }

  const exportCsv = () => {
    if (!tier.csvExport) {
      openUpgrade({ reason: "export" });
      return;
    }
    downloadCsv(csvFileName("saved-markets"), toCsv(markets, COLUMNS));
    recordExport(`${fmtNum(markets.length)} saved markets`, "/saved?tab=markets");
    toast.success(`Exported ${fmtNum(markets.length)} markets`);
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {fmtNum(markets.length)} kept
        </p>
        <Button variant="outline" size="sm" onClick={exportCsv}>
          Export CSV
        </Button>
      </div>
      <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {markets.map((m) => (
          <MarketCard key={m.slug} market={m} />
        ))}
      </ul>
    </div>
  );
}
