"use client";

/**
 * /admin — internal operator metrics. MRR, tier mix, pull volume, and the
 * unit economics after the coaching-program rev share and data costs.
 * Everything is computed from getAdminMetrics(); no hardcoded dollars.
 */

import * as React from "react";
import { MoveDownRight } from "lucide-react";
import { getAdminMetrics } from "@/lib/data";
import { fmtMoney, fmtMoneyCents, fmtNum, fmtPct } from "@/lib/format";
import type { AdminMetrics } from "@/lib/mock/types";
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
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function LedgerRow({
  label,
  value,
  negative,
  strong,
}: {
  label: React.ReactNode;
  value: string;
  negative?: boolean;
  strong?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-6 px-5 py-3.5">
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
          "inline-flex items-center gap-1.5 text-sm tabular",
          negative && "text-neg",
          strong && "font-semibold text-gold",
          !negative && !strong && "text-foreground"
        )}
      >
        {negative ? (
          <MoveDownRight aria-hidden className="size-3" strokeWidth={2.5} />
        ) : null}
        {value}
      </span>
    </div>
  );
}

export function AdminScreen() {
  const [metrics, setMetrics] = React.useState<AdminMetrics | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    getAdminMetrics().then((m) => {
      if (!cancelled) setMetrics(m);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const loading = metrics === null;

  const arpu = metrics ? metrics.mrr / metrics.activeSubscriptions : 0;
  const programShare = metrics ? metrics.mrr * metrics.revShareRate : 0;
  const dataCosts = metrics
    ? metrics.dataCostPerUser * metrics.activeSubscriptions
    : 0;
  const netBeforeOverhead = metrics
    ? metrics.mrr - programShare - dataCosts
    : 0;

  const sk = (w: string) => <Skeleton className={cn("mt-0.5 h-7", w)} />;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:px-10">
      <PageHeader
        title={
          <span className="inline-flex flex-wrap items-center gap-3">
            Admin
            <StatusChip tone="outline">Internal</StatusChip>
          </span>
        }
        description="Operator metrics. Not visible to customers."
      />

      {/* Stat header */}
      <StatHeader className="mt-8">
        <StatCard
          label="MRR"
          serif
          value={metrics ? fmtMoney(metrics.mrr) : sk("w-24")}
        />
        <StatCard
          label="Active subscriptions"
          value={metrics ? fmtNum(metrics.activeSubscriptions) : sk("w-16")}
        />
        <StatCard
          label="Free accounts"
          value={metrics ? fmtNum(metrics.freeAccounts) : sk("w-16")}
        />
        <StatCard
          label="ARPU"
          value={metrics ? fmtMoneyCents(arpu) : sk("w-20")}
        />
        <StatCard
          label="Est. data cost / paying user"
          value={metrics ? fmtMoneyCents(metrics.dataCostPerUser) : sk("w-16")}
          sub={
            <span className="text-[11px] text-muted-foreground">per month</span>
          }
        />
        <StatCard
          label="Program rev share"
          value={metrics ? fmtMoney(programShare) : sk("w-20")}
          sub={
            metrics ? (
              <span className="text-[11px] text-muted-foreground tabular">
                {fmtPct(metrics.revShareRate)} of MRR
              </span>
            ) : (
              <Skeleton className="h-3 w-16" />
            )
          }
        />
      </StatHeader>

      {/* Charts */}
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <ChartCard
          title="Tier distribution"
          sub="Every account in the cohort, by plan."
        >
          {metrics ? (
            <TierDonut tierCounts={metrics.tierCounts} />
          ) : (
            <div className="flex h-[290px] items-center justify-center">
              <Skeleton className="size-40 rounded-full" />
            </div>
          )}
        </ChartCard>
        <ChartCard
          title="Pull volume"
          sub="Address pulls per month, trailing 12 months."
        >
          {metrics ? (
            <PullVolumeChart pullVolume={metrics.pullVolume} />
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

      {/* Unit economics */}
      <div className="mt-10 rounded-sm border border-border bg-card">
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground">
            Unit economics
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Monthly, at the current cohort mix.
          </p>
        </div>
        {metrics ? (
          <div className="divide-y divide-border">
            <LedgerRow label="MRR" value={fmtMoney(metrics.mrr)} />
            <LedgerRow
              label={`Coaching program share (${fmtPct(metrics.revShareRate)})`}
              value={`−${fmtMoney(programShare)}`}
              negative
            />
            <LedgerRow
              label="Est. data costs"
              value={`−${fmtMoney(dataCosts)}`}
              negative
            />
            <LedgerRow
              label="Net before overhead"
              value={fmtMoney(netBeforeOverhead)}
              strong
            />
          </div>
        ) : (
          <div className="divide-y divide-border">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center justify-between px-5 py-3.5"
              >
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-4 w-20" />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Users */}
      <div className="mt-10 rounded-sm border border-border bg-card">
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground">Accounts</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            A sample of the cohort, newest first.
          </p>
        </div>
        <div className="px-5 pb-3">
          <AdminUsersTable users={metrics?.users ?? []} loading={loading} />
        </div>
      </div>
    </div>
  );
}
