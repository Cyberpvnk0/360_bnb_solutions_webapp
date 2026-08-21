"use client";

import * as React from "react";
import { Receipt } from "lucide-react";
import { toast } from "sonner";
import {
  TIERS,
  annualEffectiveMonthly,
  type TierId,
} from "@/config/app";
import { getInvoices } from "@/lib/data";
import { fmtDate, fmtMoneyCents, fmtNum } from "@/lib/format";
import type { Invoice } from "@/lib/mock/types";
import {
  BillingToggle,
  PricingTiers,
  type BillingCycle,
} from "@/components/pricing/pricing-cards";
import { useSession } from "@/components/providers/session-provider";
import {
  DataTable,
  type DataTableColumn,
} from "@/components/primitives/data-table";
import { EmptyState } from "@/components/primitives/empty-state";
import { StatusChip } from "@/components/primitives/status-chip";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

const INVOICE_COLUMNS: DataTableColumn<Invoice>[] = [
  {
    key: "date",
    header: "Date",
    cell: (row) => fmtDate(row.date),
    sortValue: (row) => row.date,
  },
  {
    key: "description",
    header: "Description",
    cell: (row) => <span className="text-foreground">{row.description}</span>,
  },
  {
    key: "amount",
    header: "Amount",
    align: "right",
    cell: (row) => fmtMoneyCents(row.amount),
    sortValue: (row) => row.amount,
  },
  {
    key: "status",
    header: "Status",
    align: "right",
    cell: (row) => (
      <StatusChip tone={row.status === "paid" ? "gold" : "outline"}>
        {row.status === "paid" ? "Paid" : "Open"}
      </StatusChip>
    ),
  },
];

export function BillingTab() {
  const { ready, user, tier, pullsUsed, pullLimit, upgradeTo, openUpgrade } =
    useSession();
  const [billing, setBilling] = React.useState<BillingCycle>("annual");
  const [invoices, setInvoices] = React.useState<Invoice[] | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    getInvoices().then((rows) => {
      if (!cancelled) setInvoices(rows);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready || !user) {
    return (
      <div className="space-y-8">
        <Skeleton className="h-44 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-96 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  const isPaid = tier.priceMonthly > 0;
  const priceLine = !isPaid
    ? "$0 forever"
    : user.billingCycle === "annual"
      ? `${fmtMoneyCents(annualEffectiveMonthly(tier))}/mo, billed annually at ${fmtMoneyCents(tier.priceAnnual)}`
      : `${fmtMoneyCents(tier.priceMonthly)}/mo, billed monthly`;

  const usedFraction = pullLimit > 0 ? Math.min(1, pullsUsed / pullLimit) : 0;
  const exhausted = pullLimit > 0 && pullsUsed >= pullLimit;

  const handleSelect = (tierId: TierId) => {
    upgradeTo(tierId);
    toast.success(`Plan changed to ${TIERS[tierId].name}`);
  };

  return (
    <div className="space-y-8">
      {/* Current plan */}
      <section className="rounded-sm border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-6 py-4">
          <h2 className="text-sm font-semibold text-foreground">
            Current plan
          </h2>
          {isPaid ? <StatusChip tone="gold">Active</StatusChip> : null}
        </div>
        <div className="p-6">
          <div className="font-display text-3xl font-medium tracking-tight text-foreground">
            {tier.name}
          </div>
          <p className="mt-1 text-sm text-muted-foreground tabular">
            {priceLine}
          </p>
          {isPaid ? (
            <p className="mt-0.5 text-xs text-muted-foreground tabular">
              Renews {fmtDate(user.periodEnd)}
            </p>
          ) : null}
        </div>
      </section>

      {/* Pull usage */}
      <section className="rounded-sm border border-border bg-card">
        <div className="border-b border-border px-6 py-4">
          <h2 className="text-sm font-semibold text-foreground">
            Address pulls this period
          </h2>
        </div>
        <div className="p-6">
          {pullLimit > 0 ? (
            <>
              <div className="h-1.5 w-full overflow-hidden rounded-sm bg-secondary">
                <div
                  className="h-full rounded-sm transition-all duration-150"
                  style={{
                    width: `${usedFraction * 100}%`,
                    background: exhausted ? "var(--red-muted)" : "var(--gold)",
                  }}
                />
              </div>
              <p className="mt-3 text-xs text-muted-foreground tabular">
                {fmtNum(pullsUsed)} of {fmtNum(pullLimit)} used · resets{" "}
                {fmtDate(user.periodEnd)}
              </p>
            </>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-4">
              <p className="text-sm text-muted-foreground">
                The Free plan includes no pulls.
              </p>
              <Button onClick={() => openUpgrade({ reason: "pulls" })}>
                Upgrade for pulls
              </Button>
            </div>
          )}
        </div>
      </section>

      {/* Invoice history */}
      <section className="overflow-hidden rounded-sm border border-border bg-card">
        <div className="border-b border-border px-6 py-4">
          <h2 className="text-sm font-semibold text-foreground">
            Invoice history
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Every charge to date.
          </p>
        </div>
        <DataTable
          columns={INVOICE_COLUMNS}
          rows={invoices ?? []}
          rowKey={(row) => row.id}
          loading={invoices === null}
          skeletonRows={5}
          emptyState={
            <EmptyState
              icon={Receipt}
              title="No invoices yet."
              description="Charges appear here once a paid plan starts."
              className="border-0"
            />
          }
        />
      </section>

      {/* Change plan */}
      <section className="rounded-sm border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-6 py-4">
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              Change plan
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Anything unlimited stays unlimited — that&apos;s the point.
            </p>
          </div>
          <BillingToggle billing={billing} onChange={setBilling} />
        </div>
        <div className="p-6">
          <PricingTiers
            billing={billing}
            compact={false}
            currentTierId={user.tier}
            onSelect={handleSelect}
          />
        </div>
      </section>
    </div>
  );
}
