/**
 * Number and date formatting used across the product.
 * All money is USD. All percentages are passed as fractions (0.62 = 62%).
 */

const usd0 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const usd2 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const num0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** $1,234 — whole-dollar money, the default across the app. */
export function fmtMoney(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return usd0.format(value);
}

/** $8.33 — money with cents, used for pricing. */
export function fmtMoneyCents(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return usd2.format(value);
}

/** 62% — percentage from a fraction, whole points. */
export function fmtPct(fraction: number, digits = 0): string {
  if (!Number.isFinite(fraction)) return "—";
  return `${(fraction * 100).toFixed(digits)}%`;
}

/** 12,480 — plain number with thousands separators. */
export function fmtNum(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return num0.format(value);
}

/** $37.7K / $1.2M — compact money for axis labels and dense readouts. */
export function fmtMoneyShort(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (abs >= 1_000) {
    return `$${(value / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  }
  return usd0.format(value);
}

/** +4.2% / −1.3% — signed delta in percentage points from a fraction. */
export function fmtDeltaPts(fraction: number, digits = 1): string {
  if (!Number.isFinite(fraction)) return "—";
  const pts = fraction * 100;
  const sign = pts > 0 ? "+" : pts < 0 ? "−" : "";
  return `${sign}${Math.abs(pts).toFixed(digits)} pts`;
}

/** +$120 / −$85 — signed money delta. */
export function fmtDeltaMoney(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${usd0.format(Math.abs(value))}`;
}

/** +3.1% / −0.8% — signed relative change from a fraction. */
export function fmtDeltaPct(fraction: number, digits = 1): string {
  if (!Number.isFinite(fraction)) return "—";
  const pct = fraction * 100;
  const sign = pct > 0 ? "+" : pct < 0 ? "−" : "";
  return `${sign}${Math.abs(pct).toFixed(digits)}%`;
}

/**
 * The line under a listing's address: the neighbourhood, and the city
 * only when the address line has not already said it.
 *
 * Feed addresses usually arrive fully postal — "506 Lexington Pkwy N
 * Unit 1, St Paul, MN 55104" — so a second line reading "St. Paul, MN"
 * under it is the same fact twice and reads as padding. Null means
 * print nothing at all.
 */
export function localityLine(
  address: string,
  city: string,
  stateCode: string,
  submarketName?: string
): string | null {
  // Word by word, not character by character. "St. Paul" in one feed
  // against "St Paul" in another is the same city, so the punctuation
  // has to go — but a plain substring test on the stripped letters then
  // finds "Ada" inside "1 Nevada Ave" and silently drops a line that
  // should have printed. Whole words, in order, is both.
  const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const cityWords = words(city);
  const addressWords = words(address);
  const alreadySaid =
    cityWords.length > 0 &&
    addressWords.some((_, i) =>
      cityWords.every((w, j) => addressWords[i + j] === w)
    );
  const cityState = `${city}, ${stateCode}`;
  if (submarketName) {
    return alreadySaid ? submarketName : `${submarketName} · ${cityState}`;
  }
  return alreadySaid ? null : cityState;
}

/** Mar 14, 2026 */
export function fmtDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Mar 14 — for a stamp whose year is never in doubt. */
export function fmtDayMonth(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/** Mar 2026 */
export function fmtMonth(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
  });
}

/** 3.2 mi */
export function fmtMiles(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return `${value.toFixed(1)} mi`;
}

/** 14 mo — months, rounded to one decimal under 10. */
export function fmtMonths(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "—";
  return value < 10 ? `${value.toFixed(1)} mo` : `${Math.round(value)} mo`;
}
