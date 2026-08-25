/**
 * Enrichment orchestration: turn a page of live listings into the same
 * listings carrying feature flags.
 *
 * Bounded on purpose. Enrichment is the expensive vendor, so it runs
 * only over what a student can actually see (one page, not a whole
 * metro), only over rows whose amenities are still unknown, and only a
 * few at a time. A listing that can't be read comes back untouched with
 * `featuresKnown` still false — the filter then excludes it as unknown,
 * which is the honest outcome, rather than counting it as unfurnished.
 */

import {
  describeListing,
  ScraperApiError,
  type PageSignals,
} from "@/lib/live/scraperapi";
import type { RentalListing } from "@/lib/mock/types";

/**
 * Properties per request.
 *
 * Sized to about one concurrency wave, not one screenful: a request that
 * bundled all 24 visible cards would hold a serverless function open for
 * four or five sequential waves and show the student nothing until the
 * last one landed. Small batches keep every invocation well inside the
 * function timeout and let cards fill in as answers arrive. Enriching
 * beyond what's on screen is still money spent on rows nobody is
 * looking at, so the client never asks for more than the page.
 */
export const MAX_ENRICH_PER_REQUEST = 8;

/**
 * Vendor calls in flight at once.
 *
 * This is a VENDOR limit, not a politeness setting: ScraperAPI caps
 * concurrent threads by plan (5 on the free trial, more as you go up),
 * and exceeding it earns 429s rather than speed. The default matches
 * the trial so a first test can't fail for the wrong reason; raise
 * SCRAPERAPI_CONCURRENCY to your plan's ceiling and the same page
 * finishes proportionally faster.
 */
export const DEFAULT_CONCURRENCY = 5;

function concurrency(): number {
  const raw = Number(process.env.SCRAPERAPI_CONCURRENCY);
  return Number.isFinite(raw) && raw > 0
    ? Math.floor(raw)
    : DEFAULT_CONCURRENCY;
}

/** What one address cost and yielded — diagnostics only, no prose. */
export interface EnrichmentRecord {
  id: string;
  known: boolean;
  /** Wall-clock for this one read. The probe aggregates these into the
   *  answer to "how long will a page take". */
  ms: number;
  features: string[];
  strategy: string | null;
  textLength: number;
  credits: number | null;
  rendered: boolean;
  /** Did the search page lead us to the listing's own page? */
  reachedDetail: boolean;
  /** Structural read of the page — never its content. */
  signals: PageSignals | null;
  failure: string | null;
}

export interface EnrichmentBatch {
  /** Flags by listing id, for the client to merge onto its rows. */
  facts: Record<string, { features: string[]; featuresKnown: boolean }>;
  records: EnrichmentRecord[];
  attempted: number;
  resolved: number;
  creditsSpent: number | null;
  /** Wall-clock for the whole batch — one wave when the batch fits the
   *  concurrency limit, more when it doesn't. */
  ms: number;
}

export interface EnrichTarget {
  id: string;
  address: string;
  city: string;
  stateCode: string;
}

/** Run `worker` over `items`, at most CONCURRENCY at a time. */
async function pooled<T, R>(
  items: readonly T[],
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const runners = Array.from(
    { length: Math.min(concurrency(), items.length) },
    async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        results[i] = await worker(items[i]);
      }
    }
  );
  await Promise.all(runners);
  return results;
}

/**
 * Read the listing pages for these addresses and return their flags.
 *
 * Never throws for a single bad address: one unreadable page shouldn't
 * cost the other twenty-three their answer. Transport-level failures are
 * recorded per row so the probe can report exactly what went wrong —
 * "auth" reads very differently from "blocked".
 */
export async function enrichTargets(
  targets: readonly EnrichTarget[]
): Promise<EnrichmentBatch> {
  const slice = targets.slice(0, MAX_ENRICH_PER_REQUEST);

  const started = Date.now();
  const records = await pooled(slice, async (t): Promise<EnrichmentRecord> => {
    const at = Date.now();
    try {
      const facts = await describeListing(t.address, t.city, t.stateCode);
      return {
        id: t.id,
        ms: Date.now() - at,
        known: facts.featuresKnown,
        features: facts.features,
        strategy: facts.strategy,
        textLength: facts.textLength,
        credits: facts.credits,
        rendered: facts.rendered,
        reachedDetail: facts.reachedDetail,
        signals: facts.signals,
        failure: null,
      };
    } catch (error) {
      return {
        id: t.id,
        ms: Date.now() - at,
        known: false,
        features: [],
        strategy: null,
        textLength: 0,
        credits: null,
        rendered: false,
        reachedDetail: false,
        signals: null,
        failure:
          error instanceof ScraperApiError ? error.reason : "network",
      };
    }
  });

  const facts: EnrichmentBatch["facts"] = {};
  for (const r of records) {
    // Only a real read writes a fact. A failure leaves the row's
    // amenities unknown rather than asserting it has none.
    if (r.known) facts[r.id] = { features: r.features, featuresKnown: true };
  }

  const credited = records.filter((r) => r.credits !== null);
  return {
    facts,
    records,
    attempted: records.length,
    resolved: records.filter((r) => r.known).length,
    creditsSpent: credited.length
      ? credited.reduce((sum, r) => sum + (r.credits ?? 0), 0)
      : null,
    ms: Date.now() - started,
  };
}

/** Rows worth spending on: live listings whose amenities are unknown.
 *  Preview inventory already carries its own tags, and a row we've
 *  already read is a row we never pay for twice. */
export function targetsFor(listings: readonly RentalListing[]): EnrichTarget[] {
  return listings
    .filter((l) => l.featuresKnown !== true && l.id.startsWith("live--"))
    .map((l) => ({
      id: l.id,
      address: l.address,
      city: l.city,
      stateCode: l.stateCode,
    }));
}
