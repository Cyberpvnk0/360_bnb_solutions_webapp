"use client";

import { TIERS, TIER_ORDER } from "@/config/app";
import { fmtDate, fmtNum } from "@/lib/format";
import type { AdminUserRow } from "@/lib/mock/types";
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

const COLUMNS: DataTableColumn<AdminUserRow>[] = [
  {
    key: "user",
    header: "User",
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
    header: "Tier",
    cell: (row) => (
      <StatusChip tone={TIER_CHIP_TONE[row.tier]}>
        {TIERS[row.tier].name}
      </StatusChip>
    ),
    sortValue: (row) => TIER_ORDER.indexOf(row.tier),
  },
  {
    key: "pulls",
    header: "Pulls",
    align: "right",
    cell: (row) => (
      <span className="tabular">
        {fmtNum(row.pullsUsed)} / {fmtNum(TIERS[row.tier].pullLimit)}
      </span>
    ),
    sortValue: (row) => row.pullsUsed,
  },
  {
    key: "joined",
    header: "Joined",
    align: "right",
    cell: (row) => fmtDate(row.joinedAt),
    sortValue: (row) => row.joinedAt,
  },
];

export function AdminUsersTable({
  users,
  loading,
}: {
  users: AdminUserRow[];
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
