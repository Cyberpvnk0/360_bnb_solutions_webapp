/**
 * What the operator sees: the cohort, the month's spend, the plans.
 *
 * SERVER ONLY, SECRET KEY. Everything here reads with the service role,
 * which sees every account's rows — which is the point, and the reason
 * nothing in this file may be imported by a client component or served
 * to a caller who is not on the staff list (see lib/auth/gate).
 *
 * MEASURED, NEVER MODELLED. The page this feeds used to be seeded: a
 * cohort of thirty-five hundred invented students, an MRR computed from
 * invented tier counts, a "data cost per user" typed in as a constant.
 * Every figure below is read from a table or derived from one by
 * arithmetic that is written down beside it. Where a number cannot be
 * measured yet — nothing has been billed, so there is no revenue to
 * report — the field says so rather than estimating.
 *
 * BOUNDED READS. The store answers at most a thousand rows a query,
 * which is far above a staff beta and far below a cohort. Each read
 * asks for one more than it will show and reports `truncated` when it
 * gets it, so a page that has stopped counting says it has.
 */

import { CREDIT_PACKS, TIERS, TIER_ORDER, type PackId, type TierId } from "@/config/app";
import { currentPeriod } from "@/lib/db/usage-period";

/** One account, as the operator sees it. */
export interface AdminAccount {
  id: string;
  name: string;
  email: string;
  tier: TierId;
  /** Distinct analyses this period, against the plan. */
  analysesUsed: number;
  /** Distinct markets opened this period. */
  marketsUsed: number;
  /** Pack analyses on the account. */
  credits: number;
  joinedAt: string;
}

export interface AdminMetrics {
  /** The month the usage figures describe, YYYY-MM. */
  period: string;
  accounts: number;
  tierCounts: { tier: TierId; count: number }[];
  /** Accounts on any paid plan. */
  paying: number;
  /**
   * What the paying accounts' plans list for, per month, if every one
   * of them were billed monthly at today's prices. Not revenue: nothing
   * has been charged yet, and annual billing would make it lower. It is
   * the ceiling the cohort's plans describe.
   */
  listMrr: number;
  /** Distinct analyses bought this period, across every account. */
  analysesThisPeriod: number;
  /** Distinct markets opened this period, across every account. */
  marketsThisPeriod: number;
  /** Pack analyses outstanding across every account. */
  creditsOutstanding: number;
  /** Packs granted this period, by pack. */
  packsThisPeriod: { pack: PackId; count: number }[];
  /** Analyses and markets by period, oldest first, for the trailing year. */
  byPeriod: { period: string; analyses: number; markets: number }[];
  /** Newest accounts first. */
  accountsList: AdminAccount[];
  /** True when a read hit the row ceiling and the figures undercount. */
  truncated: boolean;
  /** Set when the store could not be read at all. */
  error: string | null;
}

/** One more than the store's default page, so a full page is detectable. */
const PAGE = 1000;
const TIMEOUT_MS = 6_000;

function config(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return { url: url.replace(/\/+$/, ""), key };
}

type Row = Record<string, unknown>;

async function rows(cfg: { url: string; key: string }, query: string): Promise<Row[]> {
  const res = await fetch(`${cfg.url}/rest/v1/${query}`, {
    headers: {
      apikey: cfg.key,
      authorization: `Bearer ${cfg.key}`,
      // Ask for one page and read how many came back; the store's own
      // ceiling is whatever it is, and a full page is the signal.
      range: `0-${PAGE - 1}`,
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 160);
    throw new Error(`${query.split("?")[0]}: ${detail || `HTTP ${res.status}`}`);
  }
  const body = (await res.json()) as unknown;
  return Array.isArray(body) ? (body as Row[]) : [];
}

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const len = (v: unknown): number => (Array.isArray(v) ? v.length : 0);

function tierOf(v: unknown): TierId {
  return typeof v === "string" && v in TIERS ? (v as TierId) : "free";
}

/** YYYY-MM for n months before the given period, n ≥ 0. */
function periodsBack(period: string, n: number): string {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 - n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** The empty answer, with the reason. */
export function emptyMetrics(period: string, error: string): AdminMetrics {
  return {
    period,
    accounts: 0,
    tierCounts: TIER_ORDER.map((tier) => ({ tier, count: 0 })),
    paying: 0,
    listMrr: 0,
    analysesThisPeriod: 0,
    marketsThisPeriod: 0,
    creditsOutstanding: 0,
    packsThisPeriod: [],
    byPeriod: [],
    accountsList: [],
    truncated: false,
    error,
  };
}

export async function readAdminMetrics(now = new Date()): Promise<AdminMetrics> {
  const period = currentPeriod(now);
  const cfg = config();
  if (!cfg) return emptyMetrics(period, "no store configured");

  const since = periodsBack(period, 11);
  try {
    const [profiles, usage, balances, ledger] = await Promise.all([
      rows(cfg, "profiles?select=id,email,full_name,tier,created_at&order=created_at.desc"),
      rows(
        cfg,
        `usage?select=user_id,period,analysis_keys,market_slugs&period=gte.${since}&order=period.desc`
      ),
      rows(cfg, "credit_balance?select=user_id,balance"),
      rows(
        cfg,
        `credit_ledger?select=user_id,reason,created_at&reason=like.pack:*&created_at=gte.${period}-01T00:00:00Z`
      ),
    ]);
    const truncated = [profiles, usage, balances, ledger].some((r) => r.length >= PAGE);

    const counts = new Map<TierId, number>(TIER_ORDER.map((t) => [t, 0]));
    for (const p of profiles) {
      const t = tierOf(p.tier);
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    const tierCounts = TIER_ORDER.map((tier) => ({ tier, count: counts.get(tier) ?? 0 }));
    const paying = tierCounts
      .filter((t) => TIERS[t.tier].priceMonthly > 0)
      .reduce((s, t) => s + t.count, 0);
    const listMrr = tierCounts.reduce(
      (s, t) => s + t.count * TIERS[t.tier].priceMonthly,
      0
    );

    // This period per account, and every period for the chart.
    const thisPeriod = new Map<string, { analyses: number; markets: number }>();
    const byPeriodMap = new Map<string, { analyses: number; markets: number }>();
    for (const u of usage) {
      const p = str(u.period);
      const a = len(u.analysis_keys);
      const m = len(u.market_slugs);
      const agg = byPeriodMap.get(p) ?? { analyses: 0, markets: 0 };
      agg.analyses += a;
      agg.markets += m;
      byPeriodMap.set(p, agg);
      if (p === period) thisPeriod.set(str(u.user_id), { analyses: a, markets: m });
    }
    const byPeriod = Array.from({ length: 12 }, (_, i) => periodsBack(period, 11 - i)).map(
      (p) => ({ period: p, ...(byPeriodMap.get(p) ?? { analyses: 0, markets: 0 }) })
    );
    const current = byPeriodMap.get(period) ?? { analyses: 0, markets: 0 };

    const balanceBy = new Map<string, number>();
    for (const b of balances) balanceBy.set(str(b.user_id), num(b.balance));
    const creditsOutstanding = [...balanceBy.values()].reduce((s, v) => s + v, 0);

    const packCounts = new Map<PackId, number>();
    for (const l of ledger) {
      const id = str(l.reason).replace(/^pack:/, "");
      if (id in CREDIT_PACKS) {
        const pack = id as PackId;
        packCounts.set(pack, (packCounts.get(pack) ?? 0) + 1);
      }
    }
    const packsThisPeriod = [...packCounts.entries()]
      .map(([pack, count]) => ({ pack, count }))
      .sort((a, b) => CREDIT_PACKS[a.pack].price - CREDIT_PACKS[b.pack].price);

    const accountsList: AdminAccount[] = profiles.map((p) => {
      const id = str(p.id);
      const use = thisPeriod.get(id);
      const email = str(p.email);
      return {
        id,
        name: str(p.full_name) || email || "—",
        email,
        tier: tierOf(p.tier),
        analysesUsed: use?.analyses ?? 0,
        marketsUsed: use?.markets ?? 0,
        credits: balanceBy.get(id) ?? 0,
        joinedAt: str(p.created_at),
      };
    });

    return {
      period,
      accounts: profiles.length,
      tierCounts,
      paying,
      listMrr,
      analysesThisPeriod: current.analyses,
      marketsThisPeriod: current.markets,
      creditsOutstanding,
      packsThisPeriod,
      byPeriod,
      accountsList,
      truncated,
      error: null,
    };
  } catch (error) {
    return emptyMetrics(
      period,
      error instanceof Error ? error.message : "store unreachable"
    );
  }
}
