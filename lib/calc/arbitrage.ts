/**
 * Rental-arbitrage underwriting math.
 *
 * Pure functions only. No imports from components, no side effects.
 * Every number displayed anywhere in the product is derived from this file,
 * so the formulas are documented inline and covered by unit tests in
 * `arbitrage.test.ts`.
 *
 * Conventions
 * -----------
 * - All percentages are fractions: 0.15 means 15%.
 * - All money is dollars per the unit stated in the field name.
 * - A "month" is 30.4 nights (365 / 12), the standard STR convention.
 */

export const NIGHTS_PER_MONTH = 30.4;

/* ------------------------------------------------------------------ */
/* Inputs                                                              */
/* ------------------------------------------------------------------ */

/** Everything the user can edit in the deal calculator. */
export interface DealInputs {
  /** Monthly lease rent paid to the landlord. */
  monthlyRent: number;
  /** One-time refundable security deposit. */
  securityDeposit: number;
  /** One-time furnishing and setup budget. */
  furnishingBudget: number;
  /** Monthly utilities (electric, water, gas, trash). */
  utilitiesMonthly: number;
  /** Monthly internet. */
  internetMonthly: number;
  /** What you pay a cleaner per turnover. Guests are charged the same
   *  amount as a cleaning fee, so cleaning is a pass-through except for
   *  the platform's cut (see revenue model below). */
  cleaningCostPerTurnover: number;
  /** Average guest stay length in nights. Drives turnovers per month. */
  avgStayNights: number;
  /** Monthly consumables: linens, soap, coffee, small replacements. */
  suppliesMonthly: number;
  /** Monthly short-term-rental insurance. */
  insuranceMonthly: number;
  /** Booking platform's host fee as a fraction of gross booking revenue
   *  (nightly rate + cleaning fee). Airbnb's simplified host fee is ~3%,
   *  host-only fee ~15%. */
  platformFeePct: number;
  /** Optional co-host / property manager fee as a fraction of gross
   *  booking revenue. 0 if self-managed. */
  mgmtFeePct: number;
  /** Landlord concession: the first month's rent is waived. Cuts startup
   *  capital only — steady-state monthly costs and breakeven don't move. */
  firstMonthFree: boolean;
}

/** What the market data (comps) says about the unit's earning power. */
export interface MarketAssumptions {
  /** Average daily rate the unit can command, from STR comps. */
  adr: number;
  /** The market's actual observed occupancy, from STR comps (fraction). */
  marketOccupancy: number;
}

/* ------------------------------------------------------------------ */
/* Revenue model                                                       */
/* ------------------------------------------------------------------ */
/*
 * At occupancy `occ`:
 *
 *   occupiedNights = occ × 30.4
 *   turnovers      = occupiedNights / avgStayNights
 *
 * Gross booking revenue (what guests pay, before platform fees):
 *
 *   gross = ADR × occupiedNights + cleaningFee × turnovers
 *
 * where cleaningFee charged to guests equals cleaningCostPerTurnover
 * (pass-through pricing).
 *
 * Variable costs, all proportional to occupancy:
 *
 *   platformFees = platformFeePct × gross
 *   mgmtFees     = mgmtFeePct × gross
 *   cleaning     = cleaningCostPerTurnover × turnovers
 *
 * Fixed monthly costs, owed whether or not anyone books:
 *
 *   fixed = rent + utilities + internet + supplies + insurance
 *
 * Net cash flow:
 *
 *   net(occ) = gross − platformFees − mgmtFees − cleaning − fixed
 */

/** Fixed monthly costs — owed even at zero occupancy. */
export function fixedMonthlyCosts(i: DealInputs): number {
  return (
    i.monthlyRent +
    i.utilitiesMonthly +
    i.internetMonthly +
    i.suppliesMonthly +
    i.insuranceMonthly
  );
}

/** Occupied nights in a 30.4-night month at the given occupancy. */
export function occupiedNights(occupancy: number): number {
  return occupancy * NIGHTS_PER_MONTH;
}

/** Turnovers (check-outs needing a clean) per month at the given occupancy. */
export function turnoversPerMonth(i: DealInputs, occupancy: number): number {
  if (i.avgStayNights <= 0) return 0;
  return occupiedNights(occupancy) / i.avgStayNights;
}

/**
 * Gross booking revenue per month at the given occupancy:
 * nightly revenue plus cleaning fees collected from guests.
 */
export function grossRevenue(
  i: DealInputs,
  m: MarketAssumptions,
  occupancy: number
): number {
  const nights = occupiedNights(occupancy);
  const turns = turnoversPerMonth(i, occupancy);
  return m.adr * nights + i.cleaningCostPerTurnover * turns;
}

/** Platform + management fees per month at the given occupancy. */
export function feeCosts(
  i: DealInputs,
  m: MarketAssumptions,
  occupancy: number
): number {
  return (i.platformFeePct + i.mgmtFeePct) * grossRevenue(i, m, occupancy);
}

/** Cleaning payouts per month at the given occupancy. */
export function cleaningCosts(i: DealInputs, occupancy: number): number {
  return i.cleaningCostPerTurnover * turnoversPerMonth(i, occupancy);
}

/** All monthly costs (fixed + variable) at the given occupancy. */
export function totalMonthlyCosts(
  i: DealInputs,
  m: MarketAssumptions,
  occupancy: number
): number {
  return (
    fixedMonthlyCosts(i) + feeCosts(i, m, occupancy) + cleaningCosts(i, occupancy)
  );
}

/** Net monthly cash flow at the given occupancy. */
export function netCashFlow(
  i: DealInputs,
  m: MarketAssumptions,
  occupancy: number
): number {
  return grossRevenue(i, m, occupancy) - totalMonthlyCosts(i, m, occupancy);
}

/* ------------------------------------------------------------------ */
/* Breakeven occupancy — the product's hero metric                     */
/* ------------------------------------------------------------------ */
/*
 * Breakeven is the occupancy where net cash flow is exactly zero.
 *
 * Each occupied night contributes, after fees and cleaning:
 *
 *   contribution/night = ADR × (1 − pf − mf)
 *                      + (cleanFee × (1 − pf − mf) − cleanCost) / avgStay
 *
 * With pass-through cleaning (cleanFee = cleanCost) the cleaning term
 * simplifies to −(pf + mf) × cleanCost / avgStay: the platform and manager
 * take their cut of the cleaning fee, so each turnover costs you a little.
 *
 * Setting net(occ) = 0:
 *
 *   breakevenOcc = fixedMonthly / (contributionPerNight × 30.4)
 *
 * This matches the plain-language formula
 *   fixed costs ÷ (ADR × 30.4 × (1 − platform fee))
 * with the cleaning-revenue / cleaning-cost correction applied via
 * average stay length.
 */

/** Dollars each occupied night adds to cash flow, after fees and cleaning. */
export function contributionPerNight(i: DealInputs, m: MarketAssumptions): number {
  const feePct = i.platformFeePct + i.mgmtFeePct;
  const nightly = m.adr * (1 - feePct);
  const cleaningPerNight =
    i.avgStayNights > 0
      ? (i.cleaningCostPerTurnover * (1 - feePct) - i.cleaningCostPerTurnover) /
        i.avgStayNights
      : 0;
  return nightly + cleaningPerNight;
}

/**
 * The occupancy at which the unit exactly covers all costs.
 * Below this, the deal loses money every month.
 * Returns Infinity when a night can never contribute positively.
 */
export function breakevenOccupancy(i: DealInputs, m: MarketAssumptions): number {
  const contribution = contributionPerNight(i, m);
  if (contribution <= 0) return Infinity;
  return fixedMonthlyCosts(i) / (contribution * NIGHTS_PER_MONTH);
}

/**
 * Margin of safety in occupancy points (fraction): how far the market's
 * actual occupancy sits above your breakeven. Negative means the market
 * doesn't clear your costs.
 */
export function marginOfSafety(i: DealInputs, m: MarketAssumptions): number {
  return m.marketOccupancy - breakevenOccupancy(i, m);
}

/* ------------------------------------------------------------------ */
/* Capital and returns                                                 */
/* ------------------------------------------------------------------ */

/**
 * Cash out of pocket before the first guest checks in:
 * security deposit + furnishing budget + first month's rent —
 * unless the landlord waived the first month (firstMonthFree).
 */
export function startupCapital(i: DealInputs): number {
  return (
    i.securityDeposit +
    i.furnishingBudget +
    (i.firstMonthFree ? 0 : i.monthlyRent)
  );
}

/** Annual profit at the given occupancy (12 × monthly net). */
export function annualProfit(
  i: DealInputs,
  m: MarketAssumptions,
  occupancy: number
): number {
  return netCashFlow(i, m, occupancy) * 12;
}

/**
 * Cash-on-cash return: annual profit ÷ startup capital.
 * The lens investors use to compare this deal against any other use of
 * the same money. Returns NaN if startup capital is zero.
 */
export function cashOnCashReturn(
  i: DealInputs,
  m: MarketAssumptions,
  occupancy: number
): number {
  const capital = startupCapital(i);
  if (capital <= 0) return NaN;
  return annualProfit(i, m, occupancy) / capital;
}

/**
 * Months of net cash flow needed to earn back the furnishing budget.
 * Returns Infinity when cash flow is zero or negative.
 */
export function furnishingPaybackMonths(
  i: DealInputs,
  m: MarketAssumptions,
  occupancy: number
): number {
  const net = netCashFlow(i, m, occupancy);
  if (net <= 0) return Infinity;
  return i.furnishingBudget / net;
}

/* ------------------------------------------------------------------ */
/* Full projection                                                     */
/* ------------------------------------------------------------------ */

/** Everything the results panel displays, computed in one pass. */
export interface DealProjection {
  breakevenOccupancy: number;
  marketOccupancy: number;
  /** marketOccupancy − breakevenOccupancy, in occupancy fraction. */
  marginOfSafety: number;
  /** Gross booking revenue per month at market occupancy. */
  monthlyRevenue: number;
  /** Fixed + variable costs per month at market occupancy. */
  monthlyCosts: number;
  /** Revenue − costs at market occupancy. */
  netCashFlow: number;
  annualProfit: number;
  startupCapital: number;
  /** Fraction, e.g. 0.42 = 42%. NaN if startup capital is zero. */
  cashOnCash: number;
  /** Months to recover the furnishing budget. Infinity if not cash-flowing. */
  furnishingPaybackMonths: number;
  /** Nights per month the unit is occupied at market occupancy. */
  occupiedNights: number;
  /** Cleans per month at market occupancy. */
  turnovers: number;
  fixedCosts: number;
  feeCosts: number;
  cleaningCosts: number;
}

/** Run the whole underwriting model at the market's actual occupancy. */
export function projectDeal(i: DealInputs, m: MarketAssumptions): DealProjection {
  const occ = m.marketOccupancy;
  return {
    breakevenOccupancy: breakevenOccupancy(i, m),
    marketOccupancy: occ,
    marginOfSafety: marginOfSafety(i, m),
    monthlyRevenue: grossRevenue(i, m, occ),
    monthlyCosts: totalMonthlyCosts(i, m, occ),
    netCashFlow: netCashFlow(i, m, occ),
    annualProfit: annualProfit(i, m, occ),
    startupCapital: startupCapital(i),
    cashOnCash: cashOnCashReturn(i, m, occ),
    furnishingPaybackMonths: furnishingPaybackMonths(i, m, occ),
    occupiedNights: occupiedNights(occ),
    turnovers: turnoversPerMonth(i, occ),
    fixedCosts: fixedMonthlyCosts(i),
    feeCosts: feeCosts(i, m, occ),
    cleaningCosts: cleaningCosts(i, occ),
  };
}

/* ------------------------------------------------------------------ */
/* Market-level identities                                             */
/* ------------------------------------------------------------------ */

/**
 * RevPAR (revenue per available night) = ADR × occupancy.
 * Always computed, never stored, so it can't drift out of sync.
 */
export function revpar(adr: number, occupancy: number): number {
  return adr * occupancy;
}

/**
 * Annual gross revenue implied by an ADR/occupancy pair — used for comp
 * rows so listed annual revenue always agrees with listed ADR × occupancy.
 */
export function annualRevenueFromAdr(adr: number, occupancy: number): number {
  return adr * occupancy * 365;
}
