"use client";

/**
 * /admin — the operator's view: who is on what plan, what the month has
 * bought, and what is outstanding on packs.
 *
 * Every figure is read from the store through /api/admin/metrics, with
 * the arithmetic written down in lib/admin/metrics beside the query it
 * came from. Nothing on this page is modelled, and where a number does
 * not exist yet — nothing has been billed, so there is no revenue — the
 * card says "list price" and means it.
 */

import * as React from "react";
import { TriangleAlert } from "lucide-react";
import { CREDIT_PACKS, TIERS } from "@/config/app";
import type { AdminMetrics } from "@/lib/admin/metrics";
import { fmtMoney, fmtMonth, fmtNum } from "@/lib/format";
import { PageHeader } from "@/components/primitives/page-header";
import { StatCard, StatHeader } from "@/components/primitives/stat-card";
import { StatusChip } from "@/components/primitives/status-chip";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { PullVolumeChart, TierDonut } from "./admin-charts";
import { AdminUsersTable } from "./admin-users-table";

function ChartCard({
  title,
  sub,
  children,
}: {
  title: string;
  sub: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-sm border border-border bg-card">
      <div className="border-b border-border px-6 py-4">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}

function LedgerRow({
  label,
  value,
  strong,
}: {
  label: React.ReactNode;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-6 px-6 py-3.5">
      <span
        className={cn(
          "text-sm",
          strong ? "font-semibold text-foreground" : "text-muted-foreground"
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          "text-sm tabular",
          strong ? "font-semibold text-gold" : "text-foreground"
        )}
      >
        {value}
      </span>
    </div>
  );
}

export function AdminScreen() {
  const [metrics, setMetrics] = React.useState<AdminMetrics | null>(null);
  const [failed, setFailed] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/metrics", { cache: "no-store" })
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as
          | AdminMetrics
          | { reason?: string }
          | null;
        if (cancelled) return;
        if (!res.ok || !body || !("period" in body)) {
          setFailed(
            body && "reason" in body && body.reason === "admin-only"
              ? "This account is not on the staff list."
              : "The metrics could not be read."
          );
          return;
        }
        setMetrics(body);
      })
      .catch(() => {
        if (!cancelled) setFailed("The metrics could not be read.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loading = metrics === null && failed === null;
  const sk = (w: string) => <Skeleton className={cn("mt-0.5 h-7", w)} />;

  const pullVolume =
    metrics?.byPeriod.map((p) => ({ month: `${p.period}-01`, pulls: p.analyses })) ??
    [];
  const periodLabel = metrics ? fmtMonth(`${metrics.period}-01`) : "";

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:px-10">
      <PageHeader
        title={
          <span className="inline-flex flex-wrap items-center gap-3">
            Admin
            <StatusChip tone="outline">Staff</StatusChip>
          </span>
        }
        description="Every account, what the month has bought, and what is outstanding. Read from the store; nothing here is modelled."
      />

      {failed || metrics?.error ? (
        <div className="mt-6 flex items-start gap-3 rounded-sm border border-border bg-secondary/40 px-4 py-3">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-neg" />
          <div className="text-sm text-foreground">
            {failed ?? "The store answered with an error."}
            {metrics?.error ? (
              <p className="mt-0.5 text-xs text-muted-foreground">{metrics.error}</p>
            ) : null}
          </div>
        </div>
      ) : null}

      {metrics?.truncated ? (
        <p className="mt-4 text-xs text-muted-foreground">
          One of the reads hit the store&apos;s row ceiling, so the totals
          below undercount. The accounts list is the newest thousand.
        </p>
      ) : null}

      <StatHeader className="mt-8">
        <StatCard
          label="Accounts"
          serif
          value={metrics ? fmtNum(metrics.accounts) : sk("w-16")}
        />
        <StatCard
          label="On a paid plan"
          value={metrics ? fmtNum(metrics.paying) : sk("w-16")}
        />
        <StatCard
          label="Plans at list price"
          value={metrics ? fmtMoney(metrics.listMrr) : sk("w-24")}
          sub={
            <span className="text-[11px] text-muted-foreground">
              per month, if every paid plan were billed monthly
            </span>
          }
        />
        <StatCard
          label={`Analyses in ${periodLabel || "this month"}`}
          value={metrics ? fmtNum(metrics.analysesThisPeriod) : sk("w-16")}
          sub={
            <span className="text-[11px] text-muted-foreground">
              distinct properties, every account
            </span>
          }
        />
        <StatCard
          label={`Markets opened in ${periodLabel || "this month"}`}
          value={metrics ? fmtNum(metrics.marketsThisPeriod) : sk("w-16")}
        />
        <StatCard
          label="Pack credits outstanding"
          value={metrics ? fmtNum(metrics.creditsOutstanding) : sk("w-16")}
          sub={
            <span className="text-[11px] text-muted-foreground">
              analyses bought and not yet used
            </span>
          }
        />
      </StatHeader>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <ChartCard title="Plan mix" sub="Every account, by plan.">
          {metrics ? (
            <TierDonut tierCounts={metrics.tierCounts} />
          ) : (
            <div className="flex h-[290px] items-center justify-center">
              <Skeleton className="size-40 rounded-full" />
            </div>
          )}
        </ChartCard>
        <ChartCard
          title="Analyses bought"
          sub="Distinct properties analysed per month, trailing 12 months."
        >
          {metrics ? (
            <PullVolumeChart pullVolume={pullVolume} />
          ) : (
            <div className="flex h-[268px] items-end gap-2 px-2 pb-2">
              {Array.from({ length: 12 }).map((_, i) => (
                <Skeleton
                  key={i}
                  className="w-full"
                  style={{ height: `${30 + ((i * 17) % 60)}%` }}
                />
              ))}
            </div>
          )}
        </ChartCard>
      </div>

      <div className="mt-10 grid gap-6 lg:grid-cols-2">
        <div className="rounded-sm border border-border bg-card">
          <div className="border-b border-border px-6 py-4">
            <h2 className="text-sm font-semibold text-foreground">Plans</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Accounts on each, and what those plans list for.
            </p>
          </div>
          {metrics ? (
            <div className="divide-y divide-border">
              {metrics.tierCounts.map(({ tier, count }) => (
                <LedgerRow
                  key={tier}
                  label={`${TIERS[tier].name} · ${fmtNum(count)}`}
                  value={
                    TIERS[tier].priceMonthly > 0
                      ? fmtMoney(count * TIERS[tier].priceMonthly)
                      : "—"
                  }
                />
              ))}
              <LedgerRow label="At list, per month" value={fmtMoney(metrics.listMrr)} strong />
            </div>
          ) : (
            <div className="divide-y divide-border">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between px-6 py-3.5">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-4 w-16" />
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-sm border border-border bg-card">
          <div className="border-b border-border px-6 py-4">
            <h2 className="text-sm font-semibold text-foreground">
              Packs granted in {periodLabel || "this month"}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Top-ups fulfilled this month, by pack.
            </p>
          </div>
          {metrics ? (
            metrics.packsThisPeriod.length === 0 ? (
              <p className="px-6 py-6 text-sm text-muted-foreground">
                No packs granted this month.
              </p>
            ) : (
              <div className="divide-y divide-border">
                {metrics.packsThisPeriod.map(({ pack, count }) => (
                  <LedgerRow
                    key={pack}
                    label={`${CREDIT_PACKS[pack].label} · ${fmtNum(count)}`}
                    value={fmtMoney(count * CREDIT_PACKS[pack].price)}
                  />
                ))}
                <LedgerRow
                  label="Pack revenue at list"
                  value={fmtMoney(
                    metrics.packsThisPeriod.reduce(
                      (s, p) => s + p.count * CREDIT_PACKS[p.pack].price,
                      0
                    )
                  )}
                  strong
                />
              </div>
            )
          ) : (
            <div className="divide-y divide-border">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between px-6 py-3.5">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-4 w-16" />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mt-10 overflow-hidden rounded-sm border border-border bg-card">
        <div className="border-b border-border px-6 py-4">
          <h2 className="text-sm font-semibold text-foreground">Accounts</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Newest first. Usage is this month&apos;s, against each plan&apos;s cap.
          </p>
        </div>
        <AdminUsersTable users={metrics?.accountsList ?? []} loading={loading} />
      </div>
    </div>
  );
}
