/**
 * What the scraping account has actually spent.
 *
 * The vendor publishes an account endpoint that costs nothing to call,
 * and not calling it is why "we burned 5,000 credits in a day" was a
 * guess for as long as it was. A plan is sized from a burn rate; a
 * burn rate that can only be estimated gets estimated wrong, and this
 * project has already paid once for a cost figure I assumed instead of
 * read — off by a factor of ten, in the wrong direction.
 *
 * Reports the vendor's own fields, unrenamed and uninterpreted. Their
 * meaning is theirs to define: on some plans the count is requests and
 * on others it is credits, and a probe that silently picks one is a
 * probe that invents the answer it was asked for.
 */

const ACCOUNT_ENDPOINT = "https://api.scraperapi.com/account";
const TIMEOUT_MS = 10_000;

export interface ScraperUsage {
  ok: boolean;
  /** The payload verbatim, whatever keys it carries. */
  account: Record<string, unknown> | null;
  /** Derived only where the vendor's own names make it unambiguous. */
  used: number | null;
  limit: number | null;
  remaining: number | null;
  percentUsed: number | null;
  error: string | null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export async function scraperUsage(): Promise<ScraperUsage> {
  const miss: ScraperUsage = {
    ok: false,
    account: null,
    used: null,
    limit: null,
    remaining: null,
    percentUsed: null,
    error: null,
  };
  const key = process.env.SCRAPERAPI_KEY;
  if (!key) return { ...miss, error: "no SCRAPERAPI_KEY on this deployment" };

  let res: Response;
  try {
    res = await fetch(`${ACCOUNT_ENDPOINT}?api_key=${encodeURIComponent(key)}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      // A usage figure read from a cache is not a usage figure.
      cache: "no-store",
    });
  } catch {
    return { ...miss, error: "network or timeout" };
  }

  const text = await res.text().catch(() => "");
  if (!res.ok) {
    return { ...miss, error: `${res.status}: ${text.replace(/\s+/g, " ").slice(0, 200)}` };
  }

  let account: Record<string, unknown>;
  try {
    account = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { ...miss, error: "not JSON" };
  }

  const used = num(account.requestCount);
  const limit = num(account.requestLimit);
  return {
    ok: true,
    account,
    used,
    limit,
    remaining: used !== null && limit !== null ? Math.max(0, limit - used) : null,
    percentUsed:
      used !== null && limit !== null && limit > 0
        ? Number(((used / limit) * 100).toFixed(1))
        : null,
    error: null,
  };
}
