/**
 * What the assistant is looking at.
 *
 * The property a result page priced, or the rentals a search turned
 * up: the page says which, the server writes it into the prompt, and
 * every answer is about that and nothing else. It travels with each
 * message rather than living anywhere, so a thread needs no table and
 * a reload loses nothing the page cannot rebuild.
 *
 * Read defensively on the server: it arrives from the browser, and a
 * hand-built body must produce a refusal, not a prompt with somebody's
 * paragraph in it. Every string is bounded, every number checked, and
 * the rows are capped.
 */

export interface Regulated {
  status: string;
  note: string;
}

export interface MarketBrief {
  name: string;
  stateCode: string;
  regulation?: Regulated;
}

export interface PropertyFigures {
  /** Nightly rate and the share of nights booked, at this size. */
  adr: number;
  occupancy: number;
  /** How many nearby short-term rentals the figures were read from,
   *  and whether they were measured there or modelled from the market. */
  comps: number;
  measured: boolean;
  monthlyRevenue: number;
  netCashFlow: number;
  /** Fraction, or null when no occupancy clears the costs. */
  breakeven: number | null;
  cushionPts: number;
  grade: string;
  /** Where the net is likely to land, for a property not yet analyzed. */
  netRange?: { low: number; high: number } | null;
}

export interface PropertyContext {
  kind: "property";
  /** Stable for the property: the thread's key. */
  id: string;
  address: string;
  city: string;
  stateCode: string;
  zip?: string;
  bedrooms: number;
  bathrooms: number;
  /** Absent when no listing stated it. */
  propertyType?: string;
  rentMonthly: number;
  rentSource: "listing" | "estimate";
  sourceUrl?: string;
  point?: { lat: number; lon: number };
  market: MarketBrief;
  figures?: PropertyFigures;
}

export interface SearchRow {
  address: string;
  city: string;
  stateCode: string;
  zip?: string;
  bedrooms: number;
  bathrooms: number;
  rentMonthly: number;
  /** The net projection, or the range an estimate brackets. */
  net?: number;
  netRange?: { low: number; high: number } | null;
  grade?: string;
  analyzed?: boolean;
  sourceUrl?: string;
}

export interface SearchContext {
  kind: "search";
  id: string;
  /** "Jacksonville, FL" or "ZIP 33604". */
  label: string;
  market: MarketBrief | null;
  /** How many rentals match, of which `rows` are the first. */
  total: number;
  rows: SearchRow[];
  /** The address of the row open on the map, when one is. */
  selected?: string;
}

export type AssistantContext = PropertyContext | SearchContext;

export const MAX_ROWS = 15;
const MAX_TEXT = 200;
const MAX_NOTE = 400;

type Row = Record<string, unknown>;
const isRow = (v: unknown): v is Row => !!v && typeof v === "object" && !Array.isArray(v);

function text(v: unknown, max = MAX_TEXT): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  return t.length > 0 && t.length <= max ? t : null;
}

function num(v: unknown, lo = -1e9, hi = 1e9): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : null;
}

function link(v: unknown): string | undefined {
  const t = text(v, 500);
  return t && /^https:\/\/[^\s]+$/.test(t) ? t : undefined;
}

function point(v: unknown): { lat: number; lon: number } | undefined {
  if (!isRow(v)) return undefined;
  const lat = num(v.lat, -90, 90);
  const lon = num(v.lon, -180, 180);
  return lat !== null && lon !== null ? { lat, lon } : undefined;
}

function market(v: unknown): MarketBrief | null {
  if (!isRow(v)) return null;
  const name = text(v.name);
  const stateCode = text(v.stateCode, 2);
  if (!name || !stateCode) return null;
  const reg = isRow(v.regulation) ? v.regulation : null;
  const status = reg ? text(reg.status, 40) : null;
  const note = reg ? text(reg.note, MAX_NOTE) : null;
  return {
    name,
    stateCode: stateCode.toUpperCase(),
    ...(status && note ? { regulation: { status, note } } : {}),
  };
}

function range(v: unknown): { low: number; high: number } | null {
  if (!isRow(v)) return null;
  const low = num(v.low);
  const high = num(v.high);
  return low !== null && high !== null ? { low, high } : null;
}

function figures(v: unknown): PropertyFigures | undefined {
  if (!isRow(v)) return undefined;
  const adr = num(v.adr, 0);
  const occupancy = num(v.occupancy, 0, 1);
  const comps = num(v.comps, 0, 10_000);
  const monthlyRevenue = num(v.monthlyRevenue);
  const netCashFlow = num(v.netCashFlow);
  const cushionPts = num(v.cushionPts, -1000, 1000);
  const grade = text(v.grade, 40);
  if (
    adr === null || occupancy === null || comps === null || monthlyRevenue === null ||
    netCashFlow === null || cushionPts === null || !grade
  ) {
    return undefined;
  }
  const breakeven = v.breakeven === null ? null : num(v.breakeven, 0, 10);
  return {
    adr,
    occupancy,
    comps,
    measured: v.measured === true,
    monthlyRevenue,
    netCashFlow,
    breakeven: breakeven === undefined ? null : breakeven,
    cushionPts,
    grade,
    netRange: range(v.netRange),
  };
}

function searchRow(v: unknown): SearchRow | null {
  if (!isRow(v)) return null;
  const address = text(v.address);
  const city = text(v.city);
  const stateCode = text(v.stateCode, 2);
  const bedrooms = num(v.bedrooms, 0, 50);
  const bathrooms = num(v.bathrooms, 0, 50);
  const rentMonthly = num(v.rentMonthly, 0);
  if (!address || !city || !stateCode || bedrooms === null || bathrooms === null || rentMonthly === null) {
    return null;
  }
  const zip = text(v.zip, 5);
  const net = num(v.net);
  const grade = text(v.grade, 40);
  return {
    address,
    city,
    stateCode: stateCode.toUpperCase(),
    ...(zip && /^\d{5}$/.test(zip) ? { zip } : {}),
    bedrooms,
    bathrooms,
    rentMonthly,
    ...(net !== null ? { net } : {}),
    netRange: range(v.netRange),
    ...(grade ? { grade } : {}),
    analyzed: v.analyzed === true,
    ...(link(v.sourceUrl) ? { sourceUrl: link(v.sourceUrl) } : {}),
  };
}

/** The context as the browser sent it, or null for anything that is
 *  not one. */
export function readContext(raw: unknown): AssistantContext | null {
  if (!isRow(raw)) return null;
  const id = text(raw.id, 240);
  if (!id) return null;

  if (raw.kind === "property") {
    const address = text(raw.address);
    const city = text(raw.city);
    const stateCode = text(raw.stateCode, 2);
    const bedrooms = num(raw.bedrooms, 0, 50);
    const bathrooms = num(raw.bathrooms, 0, 50);
    const rentMonthly = num(raw.rentMonthly, 0);
    const mk = market(raw.market);
    if (!address || !city || !stateCode || bedrooms === null || bathrooms === null || rentMonthly === null || !mk) {
      return null;
    }
    const zip = text(raw.zip, 5);
    const type = text(raw.propertyType, 20);
    return {
      kind: "property",
      id,
      address,
      city,
      stateCode: stateCode.toUpperCase(),
      ...(zip && /^\d{5}$/.test(zip) ? { zip } : {}),
      bedrooms,
      bathrooms,
      ...(type ? { propertyType: type } : {}),
      rentMonthly,
      rentSource: raw.rentSource === "listing" ? "listing" : "estimate",
      ...(link(raw.sourceUrl) ? { sourceUrl: link(raw.sourceUrl) } : {}),
      ...(point(raw.point) ? { point: point(raw.point) } : {}),
      market: mk,
      ...(figures(raw.figures) ? { figures: figures(raw.figures) } : {}),
    };
  }

  if (raw.kind === "search") {
    const label = text(raw.label);
    const total = num(raw.total, 0, 1_000_000);
    if (!label || total === null || !Array.isArray(raw.rows)) return null;
    const rows = raw.rows.slice(0, MAX_ROWS).map(searchRow).filter((r): r is SearchRow => r !== null);
    const selected = text(raw.selected);
    return {
      kind: "search",
      id,
      label,
      market: market(raw.market),
      total,
      rows,
      ...(selected ? { selected } : {}),
    };
  }

  return null;
}

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const pct = (f: number) => `${Math.round(f * 100)}%`;

function placeLine(p: { address: string; city: string; stateCode: string; zip?: string }): string {
  return `${p.address}, ${p.city}, ${p.stateCode}${p.zip ? ` ${p.zip}` : ""}`;
}

function regulationLine(m: MarketBrief): string {
  if (!m.regulation) return "";
  return `\nShort-term rental rules in ${m.name} (this app's note, may be dated): ${m.regulation.status} — ${m.regulation.note}`;
}

/** The context, written for the model. */
export function renderContext(ctx: AssistantContext): string {
  if (ctx.kind === "property") {
    const lines = [
      "PROPERTY IN VIEW",
      `Address: ${placeLine(ctx)}`,
      `Size: ${ctx.bedrooms} bd / ${ctx.bathrooms} ba${ctx.propertyType ? ` · ${ctx.propertyType}` : ""}`,
      `Rent: ${money(ctx.rentMonthly)}/mo (${ctx.rentSource === "listing" ? "the listing's asking rent" : "estimated from nearby leases"})`,
    ];
    if (ctx.sourceUrl) lines.push(`Listing page already known: ${ctx.sourceUrl}`);
    if (ctx.point) lines.push(`Coordinates: ${ctx.point.lat.toFixed(5)}, ${ctx.point.lon.toFixed(5)}`);
    if (ctx.figures) {
      const f = ctx.figures;
      lines.push(
        "",
        `THIS APP'S PROJECTION (${f.measured ? `measured from ${f.comps} nearby short-term rentals` : "modelled from the market"})`,
        `Nightly rate ${money(f.adr)} · occupancy ${pct(f.occupancy)}`,
        `Gross bookings ${money(f.monthlyRevenue)}/mo · net cash flow ${money(f.netCashFlow)}/mo after rent, fees and cleaning`,
        `Breakeven occupancy ${f.breakeven === null ? "none — no occupancy clears the costs" : pct(f.breakeven)} · ${f.cushionPts >= 0 ? `${Math.round(f.cushionPts)} pts of cushion` : `${Math.abs(Math.round(f.cushionPts))} pts short`}`,
        `Grade: ${f.grade}${f.netRange ? ` · likely net ${money(f.netRange.low)} to ${money(f.netRange.high)}/mo once analyzed` : ""}`
      );
    }
    lines.push("", `Market: ${ctx.market.name}, ${ctx.market.stateCode}${regulationLine(ctx.market)}`);
    return lines.join("\n");
  }

  const lines = [
    "RENTALS IN VIEW",
    `Search: ${ctx.label} · ${ctx.total} rental${ctx.total === 1 ? "" : "s"} match, first ${ctx.rows.length} below (best spread first)`,
  ];
  if (ctx.selected) lines.push(`Open on the map: ${ctx.selected}`);
  ctx.rows.forEach((r, i) => {
    const net =
      r.net !== undefined && r.analyzed
        ? `net ${money(r.net)}/mo (analyzed)`
        : r.netRange
          ? `likely net ${money(r.netRange.low)} to ${money(r.netRange.high)}/mo`
          : r.net !== undefined
            ? `net about ${money(r.net)}/mo`
            : "";
    lines.push(
      `${i + 1}. ${placeLine(r)} · ${r.bedrooms} bd / ${r.bathrooms} ba · ${money(r.rentMonthly)}/mo` +
        `${net ? ` · ${net}` : ""}${r.grade ? ` · ${r.grade}` : ""}${r.sourceUrl ? ` · page: ${r.sourceUrl}` : ""}`
    );
  });
  if (ctx.market) lines.push("", `Market: ${ctx.market.name}, ${ctx.market.stateCode}${regulationLine(ctx.market)}`);
  return lines.join("\n");
}

/** The line under the panel's title. */
export function contextTitle(ctx: AssistantContext): string {
  return ctx.kind === "property" ? ctx.address : ctx.label;
}

/** Openers, for an empty thread. */
export function suggestionsFor(ctx: AssistantContext): string[] {
  if (ctx.kind === "property") {
    return [
      "Find the original listing for this rental",
      "Who manages or owns this property?",
      "What are the short-term rental rules here?",
      "Is this a good deal, and what's the risk?",
    ];
  }
  return [
    "Which of these is the best deal, and why?",
    ctx.selected ? `Find the original listing for ${ctx.selected}` : "Find the original listing for the top rental",
    "What are the short-term rental rules here?",
    "Write a short pitch I can send a landlord",
  ];
}
