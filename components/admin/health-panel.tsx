"use client";

/**
 * The admin panel's System health tab.
 *
 * Reads /api/admin/health — named admins only — and lays it out so the
 * question "is anything broken" is answered in the first line, and the
 * question "what exactly, and where do I go to fix it" one row below.
 * Every row carries its vendor dashboard links, because the next move
 * after reading "key refused" is always the same: open that dashboard.
 *
 * Every probe behind this page is a free call, so it refreshes on open,
 * on the button, and every two minutes while the tab is in view.
 */

import * as React from "react";
import {
  Check,
  CircleAlert,
  CircleCheck,
  ExternalLink,
  RefreshCw,
  TriangleAlert,
  X,
} from "lucide-react";
import type { HealthReport, HealthStatus, ServiceHealth } from "@/lib/admin/health";
import type { ServiceCategory } from "@/lib/admin/services";
import { fmtNum, fmtWhen } from "@/lib/format";
import { StatCard, StatHeader } from "@/components/primitives/stat-card";
import { StatusChip } from "@/components/primitives/status-chip";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const AUTO_REFRESH_MS = 120_000;

const CATEGORY_ORDER: { id: ServiceCategory; title: string; sub: string }[] = [
  { id: "infrastructure", title: "Infrastructure", sub: "Hosting, database and sign-in." },
  { id: "data", title: "Data", sub: "Rental listings, short-let performance, listing pages and owner records." },
  { id: "ai", title: "AI", sub: "The research assistant's model." },
  { id: "maps", title: "Maps & imagery", sub: "Maps, geocoding and property photos." },
  { id: "messaging", title: "Messaging", sub: "Listing alerts by email and push." },
  { id: "billing", title: "Billing", sub: "Checkout and credit packs." },
];

const STATUS_LABEL: Record<HealthStatus, string> = {
  operational: "Operational",
  degraded: "Degraded",
  down: "Down",
  "not-configured": "Not set up",
  idle: "No recent calls",
};

function StatusBadge({ status }: { status: HealthStatus }) {
  const tone =
    status === "operational"
      ? "gold"
      : status === "degraded"
        ? "warn"
        : status === "down"
          ? "neg"
          : status === "not-configured"
            ? "outline"
            : "neutral";
  return <StatusChip tone={tone}>{STATUS_LABEL[status]}</StatusChip>;
}

const PROBE_LABEL: Record<ServiceHealth["probeKind"], string> = {
  live: "Live check",
  passive: "Product calls only",
  self: "This server",
  config: "Settings only",
};

function seconds(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function ServiceRow({ service, now }: { service: ServiceHealth; now: number }) {
  const { calls, probe } = service;
  return (
    <li className="grid gap-4 px-6 py-5 md:grid-cols-[minmax(0,1fr)_auto]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-foreground">{service.name}</h3>
          <StatusBadge status={service.status} />
          {service.critical ? (
            <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Core
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{service.purpose}</p>
        <p
          className={cn(
            "mt-2 text-sm leading-snug",
            service.status === "down"
              ? "text-neg"
              : service.status === "degraded"
                ? "text-warn"
                : "text-foreground"
          )}
        >
          {service.reason}
        </p>

        <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5 text-xs">
          <div className="flex gap-1.5">
            <dt className="text-muted-foreground">Checked by</dt>
            <dd className="text-foreground">{PROBE_LABEL[service.probeKind]}</dd>
          </div>
          {probe ? (
            <div className="flex gap-1.5">
              <dt className="text-muted-foreground">Answered in</dt>
              <dd className="text-foreground tabular">{seconds(probe.ms)}</dd>
            </div>
          ) : null}
          {calls ? (
            <div className="flex gap-1.5">
              <dt className="text-muted-foreground">Product calls, 24h</dt>
              <dd className="text-foreground tabular">
                {calls.calls24h === 0
                  ? "none"
                  : `${fmtNum(calls.calls24h)}${calls.failures24h ? `, ${fmtNum(calls.failures24h)} failed` : ", all worked"}`}
              </dd>
            </div>
          ) : null}
          {calls?.last ? (
            <div className="flex gap-1.5">
              <dt className="text-muted-foreground">Last call</dt>
              <dd className="text-foreground tabular">
                {calls.last.status === null ? "no response" : `HTTP ${calls.last.status}`} ·{" "}
                {fmtWhen(calls.last.at, now)}
              </dd>
            </div>
          ) : null}
          {calls?.lastFail && calls.last?.at !== calls.lastFail.at ? (
            <div className="flex gap-1.5">
              <dt className="text-muted-foreground">Last failure</dt>
              <dd className="text-foreground tabular">
                {calls.lastFail.status === null ? "no response" : `HTTP ${calls.lastFail.status}`} ·{" "}
                {fmtWhen(calls.lastFail.at, now)}
              </dd>
            </div>
          ) : null}
          {service.metrics.map((m) => (
            <div key={m.label} className="flex gap-1.5">
              <dt className="text-muted-foreground">{m.label}</dt>
              <dd className="text-foreground tabular">{m.value}</dd>
            </div>
          ))}
        </dl>

        <details className="group mt-3">
          <summary className="cursor-pointer list-none text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground [&::-webkit-details-marker]:hidden">
            <span className="underline-offset-4 group-open:underline">Setup and billing</span>
          </summary>
          <div className="mt-3 grid gap-3 text-xs">
            {service.env.length > 0 ? (
              <div>
                <p className="metric-label">Environment</p>
                <ul className="mt-1.5 flex flex-wrap gap-1.5">
                  {service.env.map((e) => (
                    <li
                      key={e.name}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 font-mono text-[11px]",
                        e.present
                          ? "border-border text-foreground"
                          : e.optional
                            ? "border-border text-muted-foreground"
                            : "border-neg/40 text-neg"
                      )}
                    >
                      {e.present ? (
                        <Check aria-hidden className="size-3 text-gold" />
                      ) : (
                        <X aria-hidden className="size-3" />
                      )}
                      {e.name}
                      <span className="sr-only">{e.present ? "set" : e.optional ? "not set, optional" : "missing"}</span>
                      {!e.present && e.optional ? <span className="font-sans">optional</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <p className="text-muted-foreground">
              <span className="text-foreground">Bills:</span> {service.billing}
            </p>
            <p className="text-muted-foreground">
              <span className="text-foreground">Used by:</span> {service.usedBy.join(", ")}
            </p>
            {service.note ? <p className="leading-relaxed text-muted-foreground">{service.note}</p> : null}
          </div>
        </details>
      </div>

      {service.dashboards.length > 0 ? (
        <div className="flex flex-wrap items-start gap-2 md:max-w-[16rem] md:justify-end">
          {service.dashboards.map((d) => (
            <a
              key={d.url}
              href={d.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-sm border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              {d.label}
              <ExternalLink aria-hidden className="size-3 text-muted-foreground" />
              <span className="sr-only">(opens {service.name} in a new tab)</span>
            </a>
          ))}
        </div>
      ) : null}
    </li>
  );
}

function BackendRow({
  label,
  ok,
  value,
  detail,
}: {
  label: string;
  ok: boolean | null;
  value: string;
  detail?: string | null;
}) {
  return (
    <div className="flex items-start justify-between gap-6 px-6 py-3.5">
      <div className="min-w-0">
        <p className="text-sm text-foreground">{label}</p>
        {detail ? <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{detail}</p> : null}
      </div>
      <span
        className={cn(
          "inline-flex shrink-0 items-center gap-1.5 text-sm",
          ok === false ? "text-neg" : ok === true ? "text-foreground" : "text-muted-foreground"
        )}
      >
        {ok === true ? <CircleCheck aria-hidden className="size-4 text-gold" /> : null}
        {ok === false ? <TriangleAlert aria-hidden className="size-4" /> : null}
        {value}
      </span>
    </div>
  );
}

function Panel({
  title,
  sub,
  children,
  className,
}: {
  title: string;
  sub?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("overflow-hidden rounded-sm border border-border bg-card", className)}>
      <div className="border-b border-border px-6 py-4">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {sub ? <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function HealthPanel() {
  const [report, setReport] = React.useState<HealthReport | null>(null);
  const [failed, setFailed] = React.useState<string | null>(null);
  const [tick, setTick] = React.useState(0);
  const [refreshing, setRefreshing] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/health", { cache: "no-store" })
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as HealthReport | { reason?: string } | null;
        if (cancelled) return;
        if (!res.ok || !body || !("services" in body)) {
          setFailed(
            body && "reason" in body && body.reason === "admin-only"
              ? "System health is visible to named admins only: a confirmed address listed in ADMIN_EMAILS."
              : "The health check could not be read."
          );
          return;
        }
        setReport(body);
        setFailed(null);
      })
      .catch(() => {
        if (!cancelled) setFailed("The health check could not be read.");
      })
      .finally(() => {
        if (!cancelled) setRefreshing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tick]);

  React.useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      setRefreshing(true);
      setTick((n) => n + 1);
    }, AUTO_REFRESH_MS);
    return () => window.clearInterval(id);
  }, []);

  const refresh = () => {
    setRefreshing(true);
    setTick((n) => n + 1);
  };

  const now = report ? Date.parse(report.checkedAt) : 0;
  const overall = report?.overall;
  const attention = overall ? overall.counts.degraded + overall.counts.down : 0;

  return (
    <div className="mt-8">
      <div
        className={cn(
          "flex flex-col gap-4 rounded-sm border px-5 py-4 sm:flex-row sm:items-center sm:justify-between",
          overall?.status === "down"
            ? "border-neg/40 bg-[color-mix(in_oklab,var(--color-neg)_8%,var(--color-card))]"
            : overall?.status === "degraded"
              ? "border-warn/40 bg-[color-mix(in_oklab,var(--color-warn)_8%,var(--color-card))]"
              : "border-border bg-card"
        )}
        role="status"
        aria-live="polite"
      >
        <div className="flex min-w-0 items-start gap-3">
          {overall?.status === "down" ? (
            <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-neg" />
          ) : overall?.status === "degraded" ? (
            <CircleAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-warn" />
          ) : overall ? (
            <CircleCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-gold" />
          ) : null}
          <div className="min-w-0">
            {overall ? (
              <p className="text-sm font-semibold text-foreground text-balance">{overall.headline}</p>
            ) : failed ? (
              <p className="text-sm text-foreground">{failed}</p>
            ) : (
              <Skeleton className="h-5 w-72 max-w-full" />
            )}
            <p className="mt-0.5 text-xs text-muted-foreground">
              {report
                ? `Checked ${new Date(report.checkedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" })}. Live checks use free endpoints only; paid feeds are judged by the product's own recent calls.`
                : "Running every check…"}
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={refresh}
          disabled={refreshing}
          className="shrink-0 self-start sm:self-center"
        >
          <RefreshCw aria-hidden className={cn("size-3.5", refreshing && "motion-safe:animate-spin")} />
          {refreshing ? "Checking" : "Check again"}
        </Button>
      </div>

      {failed && report ? (
        <p className="mt-3 text-xs text-neg">The latest check failed; showing the previous one. {failed}</p>
      ) : null}

      <StatHeader className="mt-8">
        <StatCard label="Operational" serif value={overall ? fmtNum(overall.counts.operational) : <Skeleton className="mt-0.5 h-7 w-10" />} />
        <StatCard
          label="Need attention"
          value={overall ? fmtNum(attention) : <Skeleton className="mt-0.5 h-7 w-10" />}
          sub={
            overall ? (
              <span className="text-[11px] text-muted-foreground">
                {overall.counts.down} down · {overall.counts.degraded} degraded
              </span>
            ) : null
          }
        />
        <StatCard label="Not set up" value={overall ? fmtNum(overall.counts["not-configured"]) : <Skeleton className="mt-0.5 h-7 w-10" />} />
        <StatCard
          label="No recent calls"
          value={overall ? fmtNum(overall.counts.idle) : <Skeleton className="mt-0.5 h-7 w-10" />}
          sub={<span className="text-[11px] text-muted-foreground">nothing used them in 24h</span>}
        />
        <StatCard
          label="Server errors, 24h"
          value={report ? fmtNum(report.backend.routeErrors.last24h) : <Skeleton className="mt-0.5 h-7 w-10" />}
        />
      </StatHeader>

      <div className="mt-8 grid gap-6">
        {CATEGORY_ORDER.map((cat) => {
          const rows = report?.services.filter((s) => s.category === cat.id) ?? [];
          if (report && rows.length === 0) return null;
          return (
            <Panel key={cat.id} title={cat.title} sub={cat.sub}>
              {report ? (
                <ul className="divide-y divide-border">
                  {rows.map((s) => (
                    <ServiceRow key={s.id} service={s} now={now} />
                  ))}
                </ul>
              ) : (
                <div className="divide-y divide-border">
                  {Array.from({ length: 2 }).map((_, i) => (
                    <div key={i} className="px-6 py-5">
                      <Skeleton className="h-4 w-40" />
                      <Skeleton className="mt-2 h-3 w-full max-w-md" />
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          );
        })}
      </div>

      {report ? (
        <div className="mt-10 grid gap-6 lg:grid-cols-2">
          <Panel title="Backend" sub="The checks behind every feature, whichever vendor it uses.">
            <div className="divide-y divide-border">
              <BackendRow
                label="Database"
                ok={report.backend.database.ok}
                value={report.backend.database.ok ? "Writable" : "Failing"}
                detail={report.backend.database.ok ? null : report.backend.database.detail}
              />
              <BackendRow
                label="Member sign-in"
                ok={report.backend.auth.ok}
                value={report.backend.auth.ok ? "Configured" : "Not configured"}
                detail={report.backend.auth.ok ? null : report.backend.auth.detail}
              />
              <BackendRow
                label="Plan and credit tables"
                ok={report.backend.planTables.ok}
                value={report.backend.planTables.ok ? "Reachable" : "Missing"}
                detail={report.backend.planTables.ok ? null : report.backend.planTables.detail}
              />
              <BackendRow
                label="Shared cache"
                ok={report.backend.cache.detail ? false : null}
                value={`${fmtNum(report.backend.cache.markets)} markets · ${fmtNum(report.backend.cache.keyed)} saved results`}
                detail={report.backend.cache.detail}
              />
              <BackendRow
                label="Daily listing alerts"
                ok={
                  !report.backend.alertsJob.canAuthenticate
                    ? false
                    : report.backend.alertsJob.lastRun
                      ? report.backend.alertsJob.lastRun.ok
                      : null
                }
                value={
                  report.backend.alertsJob.lastRun
                    ? `${report.backend.alertsJob.lastRun.ok ? "Ran" : "Failed"} ${fmtWhen(report.backend.alertsJob.lastRun.at, now)}`
                    : "No run recorded yet"
                }
                detail={
                  !report.backend.alertsJob.canAuthenticate
                    ? "The scheduler cannot authenticate: set CRON_SECRET in the deployment, or the daily run is turned away."
                    : [report.backend.alertsJob.schedule, report.backend.alertsJob.lastRun?.detail]
                        .filter(Boolean)
                        .join(" · ") || null
                }
              />
              <BackendRow
                label="Admin access"
                ok={report.backend.access.adminsNamed > 0}
                value={`${report.backend.access.adminsNamed} named`}
                detail={
                  report.backend.access.adminsNamed > 0
                    ? "Addresses in ADMIN_EMAILS with a confirmed mailbox can open this tab and edit accounts."
                    : "ADMIN_EMAILS is empty, so account controls are off for everyone."
                }
              />
            </div>
          </Panel>

          <Panel title="Deployment" sub="What is answering these checks.">
            <div className="divide-y divide-border">
              <BackendRow label="Environment" ok={null} value={report.deployment.environment} />
              <BackendRow label="Region" ok={null} value={report.deployment.region ?? "—"} />
              <BackendRow
                label="Commit"
                ok={null}
                value={report.deployment.commit ?? "—"}
                detail={report.deployment.branch ? `branch ${report.deployment.branch}` : null}
              />
              <BackendRow label="Runtime" ok={null} value={report.deployment.runtime} />
              <BackendRow
                label="Call history"
                ok={report.telemetryShared ? null : false}
                value={report.telemetryShared ? "Shared across servers" : "This server only"}
                detail={
                  report.telemetryShared
                    ? "Every server instance writes its vendor call record to the shared store at most once a minute."
                    : "The shared store could not be read, so call history covers this one server instance."
                }
              />
            </div>
          </Panel>
        </div>
      ) : null}

      {report ? (
        <Panel
          className="mt-10"
          title="Recent server errors"
          sub="Errors thrown by our own routes, pages and actions. Messages are scrubbed of keys, tokens and email addresses before they are kept."
        >
          {report.backend.routeErrors.recent.length === 0 ? (
            <p className="px-6 py-6 text-sm text-muted-foreground">No server errors recorded.</p>
          ) : (
            <ul className="max-h-[28rem] divide-y divide-border overflow-y-auto">
              {report.backend.routeErrors.recent.map((e) => (
                <li key={`${e.at}|${e.path}|${e.digest ?? e.message}`} className="grid gap-1 px-6 py-3.5">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs">
                    <span className="font-mono text-foreground">
                      {e.method} {e.path}
                    </span>
                    <span className="text-muted-foreground">{e.kind}</span>
                    <span className="text-muted-foreground tabular">{fmtWhen(e.at, now)}</span>
                  </div>
                  <p className="break-words font-mono text-[11px] leading-relaxed text-muted-foreground">{e.message}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      ) : null}
    </div>
  );
}
