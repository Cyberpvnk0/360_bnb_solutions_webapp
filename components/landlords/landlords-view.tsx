"use client";

/**
 * The private landlord book: every contact behind the pipeline, searchable
 * and editable in place. Nothing here is pooled, shared, or shown to any
 * other account — that privacy is the point, and the UI says so.
 */

import * as React from "react";
import { Contact, Lock, Plus, Search } from "lucide-react";
import { fmtDate, fmtNum } from "@/lib/format";
import type { Landlord, StrPolicy } from "@/lib/mock/types";
import { useSession } from "@/components/providers/session-provider";
import {
  DataTable,
  type DataTableColumn,
} from "@/components/primitives/data-table";
import { EmptyState } from "@/components/primitives/empty-state";
import { PageHeader } from "@/components/primitives/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AddLandlordDialog } from "./add-landlord-dialog";
import { LandlordSheet } from "./landlord-sheet";
import { StrPolicyChip } from "./str-policy-chip";

type PolicyFilter = "all" | StrPolicy;

const COLUMNS: DataTableColumn<Landlord>[] = [
  {
    key: "contact",
    header: "Contact",
    cell: (l) => (
      <div className="min-w-40">
        <div className="font-medium text-foreground">{l.name}</div>
        {l.company ? (
          <div className="mt-0.5 text-xs text-muted-foreground">{l.company}</div>
        ) : null}
      </div>
    ),
  },
  {
    key: "phone",
    header: "Phone",
    cell: (l) => l.phone,
  },
  {
    key: "email",
    header: "Email",
    cell: (l) => (
      <span className="block max-w-48 truncate text-muted-foreground">
        {l.email}
      </span>
    ),
  },
  {
    key: "units",
    header: "Units controlled",
    align: "right",
    cell: (l) => fmtNum(l.unitsControlled),
    sortValue: (l) => l.unitsControlled,
  },
  {
    key: "allowsStr",
    header: "Allows STR",
    cell: (l) => <StrPolicyChip policy={l.allowsStr} />,
  },
  {
    key: "lastContacted",
    header: "Last contacted",
    cell: (l) =>
      l.lastContacted ? (
        fmtDate(l.lastContacted)
      ) : (
        <span className="text-muted-foreground">Never</span>
      ),
    // Empty string sorts before every ISO date, so "Never" reads as oldest.
    sortValue: (l) => l.lastContacted ?? "",
  },
  {
    key: "deals",
    header: "Deals",
    align: "right",
    cell: (l) =>
      l.dealIds.length > 0 ? (
        fmtNum(l.dealIds.length)
      ) : (
        <span className="text-muted-foreground">0</span>
      ),
    sortValue: (l) => l.dealIds.length,
  },
];

export function LandlordsView() {
  const { ready, landlords } = useSession();
  const [query, setQuery] = React.useState("");
  const [policy, setPolicy] = React.useState<PolicyFilter>("all");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [addOpen, setAddOpen] = React.useState(false);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return landlords.filter((l) => {
      if (policy !== "all" && l.allowsStr !== policy) return false;
      if (!q) return true;
      return (
        l.name.toLowerCase().includes(q) ||
        (l.company ?? "").toLowerCase().includes(q) ||
        l.email.toLowerCase().includes(q)
      );
    });
  }, [landlords, query, policy]);

  const selected = landlords.find((l) => l.id === selectedId) ?? null;
  const bookEmpty = ready && landlords.length === 0;

  const clearFilters = () => {
    setQuery("");
    setPolicy("all");
  };

  const addButton = (
    <Button className="gap-1.5" onClick={() => setAddOpen(true)}>
      <Plus aria-hidden className="size-4" />
      Add landlord
    </Button>
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:px-10">
      <PageHeader
        title="Landlords"
        description="The relationships behind every lease."
        actions={addButton}
      />

      {/* Privacy strip — the selling point, stated plainly. */}
      <div className="mt-5 flex items-start gap-2 border-y border-border py-3.5">
        <Lock aria-hidden className="mt-px size-3.5 shrink-0 text-gold" />
        <p className="text-xs leading-4 text-muted-foreground">
          <span className="font-medium text-foreground">Private to you.</span>{" "}
          Your landlord book is never shared, pooled, or shown to other users.
        </p>
      </div>

      {bookEmpty ? (
        <EmptyState
          icon={Contact}
          title="Your book is empty"
          description="Every deal starts with a landlord who said yes. Add your first contact."
          action={addButton}
          className="mt-6"
        />
      ) : (
        <>
          {/* Toolbar */}
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <div className="relative w-full sm:w-72">
              <Search
                aria-hidden
                className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name, company, or email"
                aria-label="Search contacts"
                className="pl-8"
              />
            </div>
            <Select
              value={policy}
              onValueChange={(v) => setPolicy(v as PolicyFilter)}
            >
              <SelectTrigger className="w-40" aria-label="Filter by STR policy">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="yes">Allows STR</SelectItem>
                <SelectItem value="negotiable">Negotiable</SelectItem>
                <SelectItem value="no">Doesn&apos;t allow</SelectItem>
              </SelectContent>
            </Select>
            <p className="ml-auto text-sm text-muted-foreground tabular">
              {ready
                ? `${fmtNum(filtered.length)} ${
                    filtered.length === 1 ? "contact" : "contacts"
                  }`
                : "—"}
            </p>
          </div>

          {/* The book */}
          <div className="mt-4 rounded-sm border border-border bg-card">
            <DataTable
              columns={COLUMNS}
              rows={filtered}
              rowKey={(l) => l.id}
              onRowClick={(l) => setSelectedId(l.id)}
              loading={!ready}
              skeletonRows={8}
              initialSort={{ key: "lastContacted", dir: "desc" }}
              emptyState={
                <EmptyState
                  icon={Search}
                  title="No contacts match"
                  description="Try a different name, or clear the search and filters."
                  action={
                    <Button variant="outline" onClick={clearFilters}>
                      Clear filters
                    </Button>
                  }
                  className="border-0"
                />
              }
            />
          </div>
        </>
      )}

      <LandlordSheet
        landlord={selected}
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
      />
      <AddLandlordDialog open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}
