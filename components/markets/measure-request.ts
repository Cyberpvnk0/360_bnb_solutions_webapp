import type { StoredMarketStats } from "@/lib/db/market-store";
import type { LiveMarketMonth, LiveMarketPace } from "@/lib/live/airroi";

export interface MarketMeasurement {
  stats: StoredMarketStats | null;
  at: string | null;
  months: LiveMarketMonth[];
  monthsAt: string | null;
  pace: LiveMarketPace[];
  paceAt: string | null;
  errors: { section: string; message: string }[];
}

type Result =
  | { status: "done"; measurement: MarketMeasurement; charged: number }
  | { status: "no-credits" }
  | { status: "failed"; message: string };

/** One purchase request; never retry automatically or discard its answer. */
export async function requestMarketMeasurement(slug: string): Promise<Result> {
  try {
    const res = await fetch("/api/markets/measure", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ market: slug }),
      // The server's limit is 60 seconds. A lost response must not leave
      // the page in a permanent loading state, or trigger a second buy.
      signal: AbortSignal.timeout(65_000),
    });
    const data = (await res.json().catch(() => null)) as
      | (Partial<MarketMeasurement> & { ok?: boolean; message?: string; reason?: string; charged?: number })
      | null;
    if (res.status === 402 || data?.reason === "no-credits") {
      return { status: "no-credits" };
    }
    const stats = data?.stats && typeof data.stats === "object" && !Array.isArray(data.stats) ? data.stats : null;
    const months = Array.isArray(data?.months) ? data.months : [];
    const pace = Array.isArray(data?.pace) ? data.pace : [];
    if (!res.ok || !data?.ok || (!stats && !months.length && !pace.length)) {
      return { status: "failed", message: data?.message ?? "Those figures could not be fetched." };
    }
    return {
      status: "done",
      measurement: { stats, at: data.at ?? null, months, monthsAt: data.monthsAt ?? null,
        pace, paceAt: data.paceAt ?? null, errors: data.errors ?? [] },
      charged: data.charged ?? 0,
    };
  } catch {
    return { status: "failed", message: "Those figures could not be fetched." };
  }
}
