"use client";

/**
 * New-listing alerts for the area on screen.
 *
 * A bell in the Deal Finder's band, for a searched market or ZIP. It
 * opens on the alerts already set for that area and a way to set one
 * more: the filters on screen become the criteria — furnished, the
 * sizes, the types, the rent band — and the person picks how to hear:
 * mail to the account's address, a notification in this browser, or
 * both. Once a morning the run (app/api/alerts/run) reads the area
 * and writes to whoever a new rental matched.
 *
 * Rows are the account's own, written with the browser key under the
 * table's policy, like lists and deals. A plan without live listings
 * has nothing to be told about, and is offered the plan that does.
 */

import * as React from "react";
import { Bell, BellRing, Loader2, Mail, Smartphone, X } from "lucide-react";
import { toast } from "sonner";
import { criteriaFromFilters, describeCriteria, readCriteria, type FilterLike } from "@/lib/alerts/criteria";
import { pushSupported, subscribeToPush, type PushRefusal } from "@/lib/push/client";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useSession } from "@/components/providers/session-provider";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

export interface AlertScope {
  marketSlug: string | null;
  zip: string | null;
  /** "Jacksonville, FL" or "ZIP 33604". */
  label: string;
}

interface AlertRow {
  id: string;
  summary: string;
  wantsEmail: boolean;
  wantsPush: boolean;
  createdAt: string;
}

type PushState = "off" | "asking" | "on" | PushRefusal;

function rowOf(r: Record<string, unknown>): AlertRow {
  return {
    id: String(r.id),
    summary: describeCriteria(readCriteria(r.criteria)),
    wantsEmail: r.wants_email === true,
    wantsPush: r.wants_push === true,
    createdAt: typeof r.created_at === "string" ? r.created_at : "",
  };
}

/** The account's alerts for one area, newest first; none on a failed read. */
async function fetchAlerts(scope: AlertScope): Promise<AlertRow[]> {
  let query = supabaseBrowser().from("listing_alerts").select("id,criteria,wants_email,wants_push,created_at");
  query = scope.zip ? query.eq("zip", scope.zip) : query.eq("market_slug", scope.marketSlug ?? "");
  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) return [];
  return ((data ?? []) as Record<string, unknown>[]).map(rowOf);
}

export function ListingAlerts({
  scope,
  filters,
  defaults,
}: {
  scope: AlertScope;
  filters: FilterLike;
  defaults: FilterLike;
}) {
  const { user, tier, openUpgrade } = useSession();
  const [open, setOpen] = React.useState(false);
  const [rows, setRows] = React.useState<AlertRow[] | null>(null);
  const [emailOn, setEmailOn] = React.useState(true);
  const [push, setPush] = React.useState<PushState>("off");
  const [saving, setSaving] = React.useState(false);
  const eligible = tier.creditLimit > 0;
  const criteria = React.useMemo(() => criteriaFromFilters(filters, defaults), [filters, defaults]);
  const summary = describeCriteria(criteria);

  // The count on the bell is read once per area, before the panel opens.
  React.useEffect(() => {
    if (!user) return;
    let live = true;
    fetchAlerts(scope).then((next) => {
      if (live) setRows(next);
    });
    return () => {
      live = false;
    };
  }, [user, scope.zip, scope.marketSlug]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = React.useCallback(() => {
    if (!user) return;
    void fetchAlerts(scope).then(setRows);
  }, [user, scope.zip, scope.marketSlug]); // eslint-disable-line react-hooks/exhaustive-deps

  const onOpenChange = (next: boolean) => {
    if (next && !eligible) {
      openUpgrade({ reason: "generic" });
      return;
    }
    setOpen(next);
    if (next) void load();
  };

  const enablePush = async (): Promise<boolean> => {
    const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!key || !pushSupported() || !user) {
      setPush("unsupported");
      return false;
    }
    setPush("asking");
    const r = await subscribeToPush(key);
    if (!r.ok) {
      setPush(r.reason);
      return false;
    }
    const { error } = await supabaseBrowser()
      .from("push_subscriptions")
      .upsert(
        {
          user_id: user.id,
          endpoint: r.subscription.endpoint,
          keys: r.subscription.keys,
          user_agent: navigator.userAgent,
        },
        { onConflict: "endpoint" }
      );
    if (error) {
      setPush("failed");
      return false;
    }
    setPush("on");
    return true;
  };

  const create = async () => {
    if (!user || saving) return;
    if (!emailOn && push !== "on") {
      toast("Pick at least one way to hear about it.");
      return;
    }
    setSaving(true);
    const { error } = await supabaseBrowser().from("listing_alerts").insert({
      user_id: user.id,
      email: user.email,
      market_slug: scope.marketSlug,
      zip: scope.zip,
      label: scope.label,
      criteria,
      wants_email: emailOn,
      wants_push: push === "on",
    });
    setSaving(false);
    if (error) {
      toast.error("The alert couldn't be saved.", { description: error.message });
      return;
    }
    toast.success(`Alert on for ${scope.label}`, { description: "Each morning a new rental matches, you'll hear." });
    void load();
  };

  const remove = async (id: string) => {
    setRows((prev) => prev?.filter((r) => r.id !== id) ?? prev);
    const { error } = await supabaseBrowser().from("listing_alerts").delete().eq("id", id);
    if (error) {
      toast.error("The alert couldn't be removed.");
      void load();
    }
  };

  const count = rows?.length ?? 0;

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={count > 0 ? `${count} alert${count === 1 ? "" : "s"} for ${scope.label}` : `Alert me about new rentals in ${scope.label}`}
          className={cn(
            "flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-xs font-medium transition-colors duration-150",
            count > 0
              ? "border-gold/50 bg-gold-fill/10 text-gold hover:bg-gold-fill/15"
              : "border-border text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
          )}
        >
          {count > 0 ? <BellRing aria-hidden className="size-3.5" /> : <Bell aria-hidden className="size-3.5" />}
          Alerts
          {count > 0 ? <span className="tabular">{count}</span> : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[22rem] p-0">
        <div className="border-b border-border px-4 py-3">
          <p className="text-sm font-semibold text-foreground">New listing alerts</p>
          <p className="truncate text-xs text-muted-foreground">{scope.label}</p>
        </div>

        {rows === null ? (
          <div className="flex items-center gap-2 px-4 py-3 text-xs text-muted-foreground">
            <Loader2 aria-hidden className="size-3.5 animate-spin" />
            Loading…
          </div>
        ) : rows.length > 0 ? (
          <ul className="divide-y divide-border border-b border-border">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center gap-2 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-foreground">{r.summary}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {[r.wantsEmail ? "Email" : null, r.wantsPush ? "Push" : null].filter(Boolean).join(" · ") || "No channel"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void remove(r.id)}
                  aria-label={`Remove alert: ${r.summary}`}
                  className="rounded-sm p-1.5 text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground"
                >
                  <X aria-hidden className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="px-4 py-3">
          <p className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">New alert</p>
          <p className="mt-1 text-sm text-foreground">{summary}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">From the filters on screen. Change them, and this changes.</p>

          <div className="mt-3 flex flex-col gap-2.5">
            <label className="flex items-center gap-3">
              <Mail aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-foreground">Email</span>
                <span className="block truncate text-[11px] text-muted-foreground">{user?.email ?? "your account's address"}</span>
              </span>
              <Switch checked={emailOn} onCheckedChange={setEmailOn} aria-label="Email" />
            </label>
            <label className="flex items-center gap-3">
              <Smartphone aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-foreground">Push</span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {push === "on"
                    ? "This browser"
                    : push === "asking"
                      ? "Asking the browser…"
                      : push === "denied"
                        ? "Blocked in this browser's settings"
                        : push === "unsupported"
                          ? "Not available on this device"
                          : push === "failed"
                            ? "Couldn't be set up here"
                            : "This browser"}
                </span>
              </span>
              <Switch
                checked={push === "on"}
                disabled={push === "asking"}
                onCheckedChange={(on) => {
                  if (on) void enablePush();
                  else setPush("off");
                }}
                aria-label="Push notifications"
              />
            </label>
          </div>

          <Button size="sm" className="mt-3 w-full" disabled={saving || !user} onClick={() => void create()}>
            {saving ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Bell aria-hidden className="size-4" />}
            Alert me
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
