/**
 * What the compressed figures mean, in the words a student needs.
 *
 * One place, because the same figure is printed on the analyzer, the
 * listing overlay and the Deal Finder card, and three explanations of
 * cushion that do not quite agree is worse than none. Plain sentences:
 * no jargon used to define jargon, no formula the reader has to solve
 * to get the point, and the consequence said out loud wherever the
 * number is one somebody could act on.
 */

export const HINTS = {
  cushion:
    "The room you have to spare. The market books a certain share of nights and you need a smaller share to cover your costs; the gap between them is the cushion, in percentage points. Twenty points means bookings could fall twenty points before this deal stops paying for itself. A negative cushion means the market does not book enough to cover the costs at all.",
  breakeven:
    "The share of nights you have to fill to cover rent and every other cost. Fill fewer and the month loses money; fill more and the rest is profit.",
  occupancy:
    "The share of nights comparable rentals nearby are actually booked, over the last twelve months. Not a target — what the area really runs.",
  adr: "The average nightly rate comparable rentals nearby actually charge, over the last twelve months.",
  revpar:
    "Revenue per available night: the nightly rate multiplied by occupancy. What an average night earns once the empty ones are counted too, which is why it is always below the rate.",
  grossRevenue:
    "Everything guests pay, before any of your costs. Rent, platform fees, utilities and cleaning all come out of this.",
  monthlyCosts:
    "Rent plus every cost you entered, including the platform's cut of each booking. Change any of them on the left and this follows.",
  netCashFlow:
    "What is left each month once every cost is paid. This is the number the deal lives or dies on.",
  annualProfit:
    "Monthly cash flow times twelve, at the occupancy the market actually runs. Not a promise for a first year, which usually starts slower.",
  startupCapital:
    "The cash you put in before the first guest: the deposit, the furnishing budget, and the first month's rent unless the landlord waives it.",
  cashOnCash:
    "Annual profit measured against the cash you put in. A 50% return means the money you spent starting up comes back in two years.",
  furnishingPayback:
    "How many months of cash flow it takes to earn back what you spent furnishing the place.",
  marginOfSafety:
    "Market occupancy minus your breakeven, in percentage points. The same idea as cushion, stated against the figures on this page.",
  netProfitRange:
    "A bracket, not an analysis. It is what a property of this size and rent tends to net in this area; running the numbers replaces it with this property's own figure.",
  compAverage:
    "The plain average of the comps listed here, and exactly the rate and occupancy the projection above is built on. Remove a comp and this moves.",
  revenueRange:
    "Where this projection sits among the rentals nearby. The shaded stretch is the middle half of them, so a projection outside it is unusual for the area and worth a second look.",
  seasonality:
    "This address's own month-by-month pattern, applied to the year's average occupancy. Months that earn are gold; months that cost money are red, and the figure beside them is what you need on hand to carry them.",
} as const;

export type HintKey = keyof typeof HINTS;
