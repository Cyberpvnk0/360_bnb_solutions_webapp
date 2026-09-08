"use client";

import { TIERS, TIER_ORDER } from "@/config/app";
import type { AdminAccount } from "@/lib/admin/metrics";
import { fmtDate, fmtNum } from "@/lib/format";
import {
  DataTable,
  type DataTableColumn,
} from "@/components/primitives/data-table";
import { StatusChip } from "@/components/primitives/status-chip";

const TIER_CHIP_TONE = {
  free: "neutral",
  starter: "outline",
  pro: "gold",
  scale: "gold",
} as const;

const COLUMNS: DataTableColumn<AdminAccount>[] = [
  {
    key: "user",
    header: "Account",
    cell: (row) => (
      <div className="min-w-0">
        <div className="font-medium text-foreground">{row.name}</div>
        <div className="text-xs text-muted-foreground">{row.email}</div>
      </div>
    ),
    sortValue: (row) => row.name,
  },
  {
    key: "tier",
    header: "Plan",
    cell: (row) => (
      <StatusChip tone={TIER_CHIP_TONE[row.tier]}>
        {TIERS[row.tier].name}
      </StatusChip>
    ),
    sortValue: (row) => TIER_ORDER.indexOf(row.tier),
  },
  {
    key: "analyses",
    header: "Analyses",
    align: "right",
    cell: (row) => (
      <span className="tabular">
        {fmtNum(row.analysesUsed)} / {fmtNum(TIERS[row.tier].pullLimit)}
      </span>
    ),
    sortValue: (row) => row.analysesUsed,
  },
  {
    key: "markets",
    header: "Markets",
    align: "right",
    cell: (row) => (
      <span className="tabular">
        {fmtNum(row.marketsUsed)} / {fmtNum(TIERS[row.tier].marketLimit)}
      </span>
    ),
    sortValue: (row) => row.marketsUsed,
  },
  {
    key: "credits",
    header: "Pack credits",
    align: "right",
    cell: (row) => (
      <span className="tabular">{row.credits > 0 ? fmtNum(row.credits) : "—"}</span>
    ),
    sortValue: (row) => row.credits,
  },
  {
    key: "joined",
    header: "Joined",
    align: "right",
    cell: (row) => (row.joinedAt ? fmtDate(row.joinedAt) : "—"),
    sortValue: (row) => row.joinedAt,
  },
];

export function AdminUsersTable({
  users,
  loading,
}: {
  users: AdminAccount[];
  loading: boolean;
}) {
  return (
    <DataTable
      columns={COLUMNS}
      rows={users}
      rowKey={(row) => row.id}
      loading={loading}
      skeletonRows={8}
      initialSort={{ key: "joined", dir: "desc" }}
    />
  );
}
