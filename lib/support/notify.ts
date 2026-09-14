/**
 * The mail that tells someone a ticket moved.
 *
 * Two directions, and both are best effort: a reply is saved whether or
 * not the mail leaves, because the thread is the record and the mail is
 * only a nudge towards it. Nothing here throws, and nothing here is
 * awaited in a way that can fail a request.
 *
 * The bodies are built by pure functions so they can be tested for the
 * one thing that actually matters in a support mail — that it never
 * carries an internal note out of the building.
 */

import { emailConfigured, sendEmail } from "@/lib/alerts/email";
import { adminEmails } from "@/lib/auth/gate";
import type { Ticket } from "./ticket";

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** First few lines of a message, for a subject line or a preview. */
export function preview(body: string, max = 240): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function shell(heading: string, lead: string, quote: string, cta: string, href: string) {
  return `<!doctype html><html><body style="margin:0;background:#f4f3f0;font-family:-apple-system,Segoe UI,Inter,sans-serif;color:#161514;">
  <div style="max-width:560px;margin:0 auto;padding:32px 20px;">
    <div style="font-weight:700;letter-spacing:-0.01em;font-size:18px;">AirCore</div>
    <h1 style="font-size:22px;line-height:1.3;margin:20px 0 6px;">${esc(heading)}</h1>
    <p style="margin:0 0 18px;color:#6b6862;">${esc(lead)}</p>
    <div style="border-left:2px solid #e3b341;padding:2px 0 2px 14px;color:#3a3833;white-space:pre-wrap;">${esc(quote)}</div>
    <p style="margin:24px 0 0;"><a href="${esc(href)}" style="display:inline-block;background:#e3b341;color:#1c1503;font-weight:600;padding:10px 16px;border-radius:999px;text-decoration:none;">${esc(cta)}</a></p>
    <p style="margin:28px 0 0;color:#9b9791;font-size:12px;">Reply in the ticket rather than to this address — mail sent here is not read.</p>
  </div></body></html>`;
}

function plain(heading: string, lead: string, quote: string, cta: string, href: string) {
  return [heading, "", lead, "", quote, "", `${cta}: ${href}`, "", "Reply in the ticket rather than to this address — mail sent here is not read."].join(
    "\n"
  );
}

/** The member's mail: we answered. */
export function staffReplyEmail(
  ticket: Pick<Ticket, "ref" | "subject">,
  body: string,
  appUrl: string,
  ticketId: string
): { subject: string; html: string; text: string } {
  const href = `${appUrl.replace(/\/+$/, "")}/support/${ticketId}`;
  const heading = "Support has replied";
  const lead = `Ticket ${ticket.ref} — ${ticket.subject}`;
  const quote = preview(body, 600);
  return {
    subject: `Re: ${ticket.subject} [${ticket.ref}]`,
    html: shell(heading, lead, quote, "Open the ticket", href),
    text: plain(heading, lead, quote, "Open the ticket", href),
  };
}

/** The team's mail: somebody needs us. */
export function staffAlertEmail(
  ticket: Pick<Ticket, "ref" | "subject" | "userEmail" | "userName">,
  body: string,
  appUrl: string,
  ticketId: string,
  opened: boolean
): { subject: string; html: string; text: string } {
  const href = `${appUrl.replace(/\/+$/, "")}/support/${ticketId}`;
  const who = ticket.userName || ticket.userEmail || "A member";
  const heading = opened ? `${who} opened a ticket` : `${who} replied`;
  const lead = `Ticket ${ticket.ref} — ${ticket.subject}`;
  const quote = preview(body, 600);
  return {
    subject: `${opened ? "New" : "Reply"}: ${ticket.subject} [${ticket.ref}]`,
    html: shell(heading, lead, quote, "Open the queue", href),
    text: plain(heading, lead, quote, "Open the queue", href),
  };
}

type Mail = { subject: string; html: string; text: string };

async function deliver(to: string, mail: Mail): Promise<void> {
  if (!emailConfigured() || !to) return;
  await sendEmail({ to, ...mail }).catch(() => undefined);
}

/**
 * Tell the member we answered. Never the other way round: this is only
 * ever called for a message that is going to them, so an internal note
 * has no path to it.
 */
export async function notifyMember(
  ticket: Ticket,
  body: string,
  appUrl: string
): Promise<void> {
  if (!ticket.userEmail) return;
  await deliver(ticket.userEmail, staffReplyEmail(ticket, body, appUrl, ticket.id));
}

/**
 * Tell the team. Goes to every address in ADMIN_EMAILS, which is the
 * same list that decides who may read the queue — so an address that
 * gets the mail is an address that can act on it.
 */
export async function notifyStaff(
  ticket: Ticket,
  body: string,
  appUrl: string,
  opened: boolean
): Promise<void> {
  const mail = staffAlertEmail(ticket, body, appUrl, ticket.id, opened);
  await Promise.all([...adminEmails()].map((to) => deliver(to, mail)));
}
