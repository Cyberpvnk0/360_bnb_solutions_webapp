/**
 * The daily run: every alert, every area it watches read once, and a
 * message for each person whose criteria a new rental met.
 *
 * "New" is measured against the alert's own last look: the ids of
 * every rental in the area at the last run are kept on the row, and a
 * rental not among them is new. The first run of an alert only takes
 * that snapshot — nobody is mailed the whole market the morning after
 * they set an alert — and the mail begins with the next rental to
 * appear. Nothing here touches the plan meter: watching an area is
 * not opening it.
 *
 * Every outside thing is handed in — the feed, the mail, the push,
 * the store — so the run can be exercised without a network.
 */

import type { RentalListing } from "@/lib/mock/types";
import { alertEmail } from "./email";
import { matchesCriteria, type AlertCriteria } from "./criteria";

export interface AlertRow {
  id: string;
  userId: string;
  email: string | null;
  marketSlug: string | null;
  zip: string | null;
  label: string;
  criteria: AlertCriteria;
  wantsEmail: boolean;
  wantsPush: boolean;
  seenIds: string[];
  lastRunAt: string | null;
}

export interface RunDeps {
  listingsFor: (scope: { marketSlug: string | null; zip: string | null }) => Promise<RentalListing[]>;
  sendEmail: (mail: { to: string; subject: string; html: string; text: string }) => Promise<{ ok: boolean; detail: string | null }>;
  /** Pushes to every browser the account subscribed; how many took it. */
  pushTo: (userId: string, payload: { title: string; body: string; url: string }) => Promise<number>;
  save: (alertId: string, patch: { seenIds: string[]; lastRunAt: string }) => Promise<void>;
  appUrl: string;
  now: Date;
}

export interface RunReport {
  alerts: number;
  areas: number;
  seeded: number;
  notified: number;
  emails: number;
  pushes: number;
  failures: string[];
}

const scopeKey = (a: { marketSlug: string | null; zip: string | null }) => (a.zip ? `zip:${a.zip}` : `market:${a.marketSlug ?? ""}`);

export function dealsHrefFor(a: { marketSlug: string | null; zip: string | null }): string {
  return a.zip ? `/deals?zip=${encodeURIComponent(a.zip)}` : `/deals?market=${encodeURIComponent(a.marketSlug ?? "")}`;
}

export async function runAlerts(alerts: AlertRow[], deps: RunDeps): Promise<RunReport> {
  const report: RunReport = { alerts: alerts.length, areas: 0, seeded: 0, notified: 0, emails: 0, pushes: 0, failures: [] };
  const byArea = new Map<string, AlertRow[]>();
  for (const a of alerts) {
    const key = scopeKey(a);
    byArea.set(key, [...(byArea.get(key) ?? []), a]);
  }
  report.areas = byArea.size;
  const stamp = deps.now.toISOString();

  for (const [key, group] of byArea) {
    let listings: RentalListing[];
    try {
      listings = await deps.listingsFor({ marketSlug: group[0].marketSlug, zip: group[0].zip });
    } catch (e) {
      report.failures.push(`${key}: ${e instanceof Error ? e.message : "feed failed"}`);
      continue;
    }
    const currentIds = listings.map((l) => l.id);

    for (const alert of group) {
      // First look: remember the area, tell nobody.
      if (alert.lastRunAt === null) {
        await deps.save(alert.id, { seenIds: currentIds, lastRunAt: stamp });
        report.seeded += 1;
        continue;
      }
      const seen = new Set(alert.seenIds);
      const fresh = listings.filter((l) => !seen.has(l.id) && matchesCriteria(l, alert.criteria));
      if (fresh.length > 0) {
        report.notified += 1;
        const href = dealsHrefFor(alert);
        if (alert.wantsEmail && alert.email) {
          const mail = alertEmail(alert, fresh, deps.appUrl, href);
          const sent = await deps.sendEmail({ to: alert.email, ...mail });
          if (sent.ok) report.emails += 1;
          else report.failures.push(`${alert.id}: mail ${sent.detail ?? "failed"}`);
        }
        if (alert.wantsPush) {
          const first = fresh[0];
          const took = await deps.pushTo(alert.userId, {
            title: `${fresh.length} new rental${fresh.length === 1 ? "" : "s"} in ${alert.label}`,
            body: fresh.length === 1 ? `${first.address} · $${Math.round(first.rentMonthly).toLocaleString("en-US")}/mo` : `${first.address} and ${fresh.length - 1} more`,
            url: `${deps.appUrl.replace(/\/+$/, "")}${href}`,
          });
          report.pushes += took;
        }
      }
      await deps.save(alert.id, { seenIds: currentIds, lastRunAt: stamp });
    }
  }
  return report;
}
