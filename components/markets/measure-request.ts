import type { StoredMarketStats } from "@/lib/db/market-store";

export interface MarketMeasurement {
  stats: StoredMarketStats;
  at: string | null;
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
      // The server's limit is 30 seconds. A lost response must not leave
      // the page in a permanent loading state, or trigger a second buy.
      signal: AbortSignal.timeout(35_000),
    });
    const data = (await res.json().catch(() => null)) as
      | { ok?: boolean; stats?: StoredMarketStats; at?: string; message?: string; reason?: string; charged?: number }
      | null;
    if (res.status === 402 || data?.reason === "no-credits") {
      return { status: "no-credits" };
    }
    if (!res.ok || !data?.ok || !data.stats || typeof data.stats !== "object" || Array.isArray(data.stats)) {
      return { status: "failed", message: data?.message ?? "Those figures could not be fetched." };
    }
    return {
      status: "done",
      measurement: { stats: data.stats, at: data.at ?? null },
      charged: data.charged ?? 0,
    };
  } catch {
    return { status: "failed", message: "Those figures could not be fetched." };
  }
}
