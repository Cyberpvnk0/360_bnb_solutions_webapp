/**
 * The store, read as the service and not as a person.
 *
 * The daily alert run has to see every account's alerts and
 * subscriptions, which no browser key may. It uses the same secret the
 * plan meter uses (lib/db/usage), through the REST interface, and only
 * from a route that is itself behind the operator's gate.
 */

export function serviceConfig(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return { url: url.replace(/\/+$/, ""), key };
}

const TIMEOUT_MS = 8_000;

export async function serviceRest<T>(
  path: string,
  init: { method?: string; body?: unknown; prefer?: string } = {}
): Promise<{ ok: true; data: T } | { ok: false; detail: string }> {
  const cfg = serviceConfig();
  if (!cfg) return { ok: false, detail: "no store configured" };
  try {
    const res = await fetch(`${cfg.url}/rest/v1/${path}`, {
      method: init.method ?? "GET",
      headers: {
        apikey: cfg.key,
        authorization: `Bearer ${cfg.key}`,
        "content-type": "application/json",
        ...(init.prefer ? { prefer: init.prefer } : {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 200);
      return { ok: false, detail: `HTTP ${res.status} ${detail}`.trim() };
    }
    const text = await res.text();
    return { ok: true, data: (text ? JSON.parse(text) : null) as T };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message.slice(0, 200) : "unreachable" };
  }
}
