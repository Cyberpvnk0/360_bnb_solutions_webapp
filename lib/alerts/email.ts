/**
 * The morning mail: the new rentals that matched, and nothing else.
 *
 * Sent through a transactional mail API with the deployment's key and
 * sender (RESEND_API_KEY, ALERTS_FROM). Without either the run skips
 * mail and says so; a person whose alert asked for mail is not told
 * something was sent that was not.
 */

import { analyzeHref } from "@/lib/live/analyze-href";
import type { RentalListing } from "@/lib/mock/types";

const ENDPOINT = "https://api.resend.com/emails";
const TIMEOUT_MS = 10_000;

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim() && process.env.ALERTS_FROM?.trim());
}

export async function sendEmail(mail: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<{ ok: boolean; detail: string | null }> {
  const key = process.env.RESEND_API_KEY?.trim();
  const from = process.env.ALERTS_FROM?.trim();
  if (!key || !from) return { ok: false, detail: "mail is not configured" };
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to: [mail.to], subject: mail.subject, html: mail.html, text: mail.text }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (res.ok) return { ok: true, detail: null };
    const body = (await res.text().catch(() => "")).slice(0, 200);
    return { ok: false, detail: `HTTP ${res.status} ${body}`.trim() };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message.slice(0, 200) : "unreachable" };
  }
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

function facts(l: RentalListing): string {
  const bits = [`${money(l.rentMonthly)}/mo`, `${l.bedrooms} bd / ${l.bathrooms} ba`];
  if (l.sqft) bits.push(`${l.sqft.toLocaleString("en-US")} sqft`);
  if (l.features.includes("Furnished")) bits.push("Furnished");
  return bits.join(" · ");
}

/** The mail for one alert's fresh matches. */
export function alertEmail(
  alert: { label: string },
  listings: RentalListing[],
  appUrl: string,
  dealsHref: string
): { subject: string; html: string; text: string } {
  const n = listings.length;
  const subject = `${n} new rental${n === 1 ? "" : "s"} in ${alert.label} match${n === 1 ? "es" : ""} your alert`;
  const base = appUrl.replace(/\/+$/, "");
  const items = listings.slice(0, 12);

  const rows = items
    .map(
      (l) => `
      <tr>
        <td style="padding:14px 0;border-top:1px solid #e8e6e1;">
          <div style="font-weight:600;color:#161514;">${esc(l.address)}</div>
          <div style="color:#6b6862;font-size:13px;margin-top:2px;">${esc(`${l.city}, ${l.stateCode}`)} · ${esc(facts(l))}</div>
          <div style="margin-top:8px;"><a href="${esc(base + analyzeHref(l))}" style="color:#9a7a17;font-weight:600;text-decoration:none;">Run the numbers →</a></div>
        </td>
      </tr>`
    )
    .join("");
  const more = n > items.length ? `<p style="color:#6b6862;font-size:13px;">And ${n - items.length} more in the Deal Finder.</p>` : "";

  const html = `<!doctype html><html><body style="margin:0;background:#f4f3f0;font-family:-apple-system,Segoe UI,Inter,sans-serif;color:#161514;">
  <div style="max-width:560px;margin:0 auto;padding:32px 20px;">
    <div style="font-weight:700;letter-spacing:-0.01em;font-size:18px;">AirCore</div>
    <h1 style="font-size:22px;line-height:1.25;margin:20px 0 6px;">${n} new rental${n === 1 ? "" : "s"} in ${esc(alert.label)}</h1>
    <p style="margin:0 0 18px;color:#6b6862;">Listed since your last check, and matching what you asked for.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${rows}</table>
    ${more}
    <p style="margin:24px 0 0;"><a href="${esc(base + dealsHref)}" style="display:inline-block;background:#e3b341;color:#1c1503;font-weight:600;padding:10px 16px;border-radius:999px;text-decoration:none;">Open the Deal Finder</a></p>
    <p style="margin:28px 0 0;color:#9b9791;font-size:12px;">You set an alert for ${esc(alert.label)} in AirCore. Turn it off in the Deal Finder, under Alerts.</p>
  </div></body></html>`;

  const text = [
    `${n} new rental${n === 1 ? "" : "s"} in ${alert.label}`,
    "",
    ...items.map((l) => `${l.address}, ${l.city}, ${l.stateCode} — ${facts(l)}\n${base}${analyzeHref(l)}`),
    n > items.length ? `\nAnd ${n - items.length} more in the Deal Finder.` : "",
    "",
    `Open the Deal Finder: ${base}${dealsHref}`,
    `You set an alert for ${alert.label} in AirCore. Turn it off in the Deal Finder, under Alerts.`,
  ]
    .filter((line) => line !== null)
    .join("\n");

  return { subject, html, text };
}
