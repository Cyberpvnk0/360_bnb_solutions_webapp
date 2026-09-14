"use client";

/**
 * /support — the member's tickets, and the team's queue.
 *
 * ONE SCREEN, TWO AUDIENCES. The server says whether this account is
 * support staff (never the client, never a query string), and that one
 * boolean decides whether the scope switch exists at all. A member sees
 * their own list and has no control that could ask for anyone else's; a
 * member of staff gets "Mine / All", a status filter and a search box,
 * and two extra columns — who raised it, and how urgent it is.
 *
 * The filters live in the URL so a queue view is a link: "everything
 * still open" is a bookmark the team can share, and browser back walks
 * the filters rather than leaving the screen.
 */

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { LifeBuoy, Plus, Search } from "lucide-react";
import { PageHeader } from "@/components/primitives/page-header";
import { EmptyState } from "@/components/primitives/empty-state";
import { DataTable, type DataTableColumn } from "@/components/primitives/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CATEGORY_LABEL, type Ticket } from "@/lib/support/ticket";
import { fullWhen, timeAgo } from "@/lib/support/when";
import { TicketPriorityChip, TicketStatusChip, UnreadDot } from "./chips";
import { NewTicketDialog } from "./new-ticket-dialog";

type Scope = "mine" | "all";
type StatusFilter = "live" | "open" | "pending" | "resolved" | "closed" | "all";

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "live", label: "Anything live" },
  { value: "open", label: "Needs reply" },
  { value: "pending", label: "Awaiting member" },
  { value: "resolved", label: "Resolved" },
  { value: "closed", label: "Closed" },
  { value: "all", label: "Everything" },
];

interface Payload {
  ok?: boolean;
  staff?: boolean;
  tickets?: Ticket[];
  unread?: number;
}

export function SupportScreen({ staff }: { staff: boolean }) {
  const router = useRouter();
  const params = useSearchParams();

  const scope: Scope = staff && params.get("scope") === "all" ? "all" : "mine";
  const status = (params.get("status") ?? (scope === "all" ? "live" : "all")) as StatusFilter;
  const urlQuery = params.get("q") ?? "";

  const [composing, setComposing] = React.useState(false);

  // Every filter, as one string. It is the effect's only dependency and
  // it is stamped on whatever comes back, which is what lets "are we
  // still loading?" be a comparison rather than a third state that has
  // to be reset in the effect body — and reset-in-effect is the
  // cascading render this codebase has been bitten by before.
  const key = `${scope}|${status}|${urlQuery}`;
  const [loaded, setLoaded] = React.useState<{
    key: string;
    tickets: Ticket[];
    failed: boolean;
  } | null>(null);

  const setParam = React.useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === "") next.delete(k);
        else next.set(k, v);
      }
      const qs = next.toString();
      router.replace(qs ? `/support?${qs}` : "/support", { scroll: false });
    },
    [params, router]
  );

  React.useEffect(() => {
    let live = true;
    const [nextScope, nextStatus, nextQuery] = key.split("|");
    const qs = new URLSearchParams();
    if (nextScope === "all") qs.set("scope", "all");
    if (nextStatus) qs.set("status", nextStatus);
    if (nextQuery) qs.set("q", nextQuery);

    fetch(`/api/support/tickets?${qs.toString()}`, { cache: "no-store" })
      .then((r) => r.json() as Promise<Payload>)
      .then((data) => {
        if (!live) return;
        setLoaded({ key, tickets: data?.ok ? (data.tickets ?? []) : [], failed: !data?.ok });
      })
      .catch(() => {
        if (live) setLoaded({ key, tickets: [], failed: true });
      });
    return () => {
      live = false;
    };
  }, [key]);

  // Loading is "what we hold is not what was asked for", which is true
  // on the first render and again the instant a filter changes.
  const loading = loaded?.key !== key;
  const rows = loading ? [] : loaded.tickets;
  const failed = !loading && loaded.failed;

  const columns = React.useMemo<DataTableColumn<Ticket>[]>(() => {
    const base: DataTableColumn<Ticket>[] = [
      {
        key: "subject",
        header: "Ticket",
        cell: (t) => (
          <div className="flex min-w-0 items-center gap-2">
            <UnreadDot show={staff ? t.unreadForStaff : t.unreadForUser} />
            <div className="min-w-0">
              <div className="truncate font-medium text-foreground">{t.subject}</div>
              <div className="mt-0.5 truncate text-xs text-muted-foreground">
                <span className="tabular">{t.ref}</span>
                <span aria-hidden> · </span>
                {CATEGORY_LABEL[t.category]}
                {staff && (t.userName || t.userEmail) ? (
                  <>
                    <span aria-hidden> · </span>
                    {t.userName || t.userEmail}
                  </>
                ) : null}
              </div>
            </div>
          </div>
        ),
        sortValue: (t) => t.subject.toLowerCase(),
      },
      {
        key: "status",
        header: "Status",
        cell: (t) => (
          <div className="flex items-center gap-1.5">
            <TicketStatusChip status={t.status} staff={staff} />
            {staff ? <TicketPriorityChip priority={t.priority} /> : null}
          </div>
        ),
        sortValue: (t) => t.status,
      },
      {
        key: "replies",
        header: "Replies",
        align: "right",
        // The opening message is not a reply, so a brand-new ticket
        // honestly reads as zero rather than one.
        cell: (t) => <span className="tabular">{Math.max(0, t.messageCount - 1)}</span>,
        sortValue: (t) => t.messageCount,
      },
      {
        key: "updated",
        header: "Last activity",
        align: "right",
        cell: (t) => (
          <span className="tabular text-muted-foreground" title={fullWhen(t.lastMessageAt)}>
            {timeAgo(t.lastMessageAt)}
          </span>
        ),
        sortValue: (t) => t.lastMessageAt,
      },
    ];
    return base;
  }, [staff]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:px-10">
      <PageHeader
        title="Support"
        description={
          staff
            ? "Every ticket raised on the platform, and the ones you raised yourself."
            : "Ask us anything. Replies land here and in your email."
        }
        actions={
          <Button onClick={() => setComposing(true)}>
            <Plus aria-hidden className="size-4" />
            New ticket
          </Button>
        }
      />

      <div className="mt-6 flex flex-wrap items-center gap-2">
        {staff ? (
          <Tabs
            value={scope}
            onValueChange={(v) =>
              setParam({ scope: v === "all" ? "all" : null, status: null })
            }
          >
            <TabsList>
              <TabsTrigger value="mine">My tickets</TabsTrigger>
              <TabsTrigger value="all">All tickets</TabsTrigger>
            </TabsList>
          </Tabs>
        ) : null}

        {staff ? (
          <>
            <Select value={status} onValueChange={(v) => setParam({ status: v })}>
              <SelectTrigger size="sm" aria-label="Filter by status" className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <form
              className="relative"
              onSubmit={(e) => {
                e.preventDefault();
                const typed = new FormData(e.currentTarget).get("q");
                setParam({ q: typeof typed === "string" ? typed.trim() || null : null });
              }}
            >
              <Search
                aria-hidden
                className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                key={urlQuery}
                name="q"
                defaultValue={urlQuery}
                placeholder="Subject, reference or member"
                aria-label="Search tickets"
                className="h-8 w-56 pl-8 text-sm"
              />
            </form>
          </>
        ) : null}
      </div>

      {failed ? (
        <p className="mt-4 text-sm text-muted-foreground">
          The ticket list could not be loaded. Your tickets are safe — refresh to try
          again.
        </p>
      ) : null}

      <div className="mt-4">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(t) => t.id}
          loading={loading}
          onRowClick={(t) => router.push(`/support/${t.id}`)}
          rowClassName={(t) =>
            (staff ? t.unreadForStaff : t.unreadForUser) ? "font-medium" : undefined
          }
          emptyState={
            <EmptyState
              icon={LifeBuoy}
              title={
                scope === "all"
                  ? "Nothing in the queue"
                  : urlQuery
                    ? "No tickets match that"
                    : "No tickets yet"
              }
              description={
                scope === "all"
                  ? "No tickets match this filter."
                  : "When something is not working or you are not sure how it should work, open a ticket and we will answer here."
              }
              action={
                scope === "all" ? null : (
                  <Button onClick={() => setComposing(true)}>Open a ticket</Button>
                )
              }
            />
          }
        />
      </div>

      {!staff && rows.length > 0 ? (
        <p className="mt-4 text-xs text-muted-foreground">
          Only you and the support team can see these.{" "}
          <Link href="/settings" className="underline underline-offset-2">
            Change the address replies go to
          </Link>
          .
        </p>
      ) : null}

      <NewTicketDialog open={composing} onOpenChange={setComposing} />
    </div>
  );
}
