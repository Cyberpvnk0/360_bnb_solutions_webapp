/**
 * Who a first unit would actually be bidding against here.
 *
 * WHY A MEDIAN IS NOT A TARGET. Every revenue figure on a market page
 * is what the listings there achieve. Who achieves it matters: a market
 * run by management companies hits its median with dynamic pricing,
 * cleaning crews and round-the-clock guest response, and a first-timer
 * with one unit and a day job is not competing on level ground. The
 * number is real either way. What it means for the person reading it is
 * not the same, and nothing on the page said so.
 *
 * This is expectation-setting, not arithmetic. It moves no projection
 * and grades no market — a professional field is a reason to plan for
 * the lower end of a range, never a reason not to take a good deal.
 *
 * FREE, like the areas, the sizes and the amenities: read off the pool
 * every analysis already fills. Only comps that actually carried the
 * flags are counted, so a market whose pool predates them says nothing
 * rather than reporting everyone as an amateur.
 */

/** Comps needed before the mix is worth reporting at all. */
export const MIN_COMPS = 8;

/** One comp, reduced to what this question needs. */
export interface CompetitionComp {
  /** Run by a management company, when the feed said. */
  pm?: boolean;
  /** Badged by the platform, when the feed said. */
  sh?: boolean;
}

export interface CompetitionReading {
  /** Comps that carried the professional-management flag, and the
   *  share of them that are professionally run. */
  managedOf: number;
  managed: number;
  /** The same for the platform's host badge. */
  badgedOf: number;
  badged: number;
}

/** Above this share of professionally run listings, a first unit is
 *  the amateur in a professional field. */
export const PROFESSIONAL_FIELD = 0.5;
/** Below this, the field is mostly individual hosts. */
export const AMATEUR_FIELD = 0.2;

export function readCompetition(
  comps: readonly CompetitionComp[]
): CompetitionReading | null {
  const managedSaid = comps.filter((c) => typeof c.pm === "boolean");
  const badgedSaid = comps.filter((c) => typeof c.sh === "boolean");
  if (managedSaid.length < MIN_COMPS && badgedSaid.length < MIN_COMPS) return null;

  const share = (rows: CompetitionComp[], pick: (c: CompetitionComp) => boolean) =>
    rows.length === 0 ? 0 : Math.round((rows.filter(pick).length / rows.length) * 1000) / 1000;

  return {
    managedOf: managedSaid.length,
    managed: share(managedSaid, (c) => c.pm === true),
    badgedOf: badgedSaid.length,
    badged: share(badgedSaid, (c) => c.sh === true),
  };
}

/**
 * What that mix means for somebody leasing their first unit here.
 *
 * Deliberately three plain readings rather than a score. A grade would
 * invite reading this as a verdict on the market, which it is not — it
 * is a statement about who else is in it.
 */
export type Field = "professional" | "mixed" | "individual";

export function fieldOf(reading: CompetitionReading): Field | null {
  if (reading.managedOf < MIN_COMPS) return null;
  if (reading.managed >= PROFESSIONAL_FIELD) return "professional";
  if (reading.managed <= AMATEUR_FIELD) return "individual";
  return "mixed";
}

export const FIELD_NOTE: Record<Field, string> = {
  professional:
    "Most listings here are run by management companies. The figures above are what they achieve — plan a first unit against the lower end of the range, not the middle.",
  mixed:
    "Management companies and individual hosts both run listings here, so the figures above are a blend of what each achieves.",
  individual:
    "Most listings here are run by individual hosts, so the figures above are broadly what one operator with one unit achieves.",
};
