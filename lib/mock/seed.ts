/**
 * Deterministic seeded randomness for mock data.
 *
 * Every mock module creates its own generator with a fixed seed, so the
 * data is identical on every import, on the server and in the browser
 * (no hydration mismatches), and across reloads.
 */

/** Mulberry32 PRNG — small, fast, deterministic. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  private next: () => number;

  constructor(seed: number) {
    this.next = mulberry32(seed);
  }

  /** Uniform float in [min, max). */
  float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Uniform integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return Math.floor(this.float(min, max + 1));
  }

  /** Random element of a non-empty array. */
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(0, arr.length - 1)];
  }

  /** value ± pct jitter (pct as fraction, e.g. 0.1 = ±10%). */
  jitter(value: number, pct: number): number {
    return value * this.float(1 - pct, 1 + pct);
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Shuffled copy (Fisher–Yates). */
  shuffle<T>(arr: readonly T[]): T[] {
    const out = [...arr];
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }
}

/** Round to the nearest step (e.g. step 25 → $1,675). */
export function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}

/** Clamp a number into [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * The mock world's fixed "today". Using a constant keeps generated dates
 * stable across renders; swap for real dates when live data lands.
 */
export const MOCK_TODAY = "2026-08-20";

/** ISO date string n days before MOCK_TODAY. */
export function daysAgo(n: number): string {
  const d = new Date(`${MOCK_TODAY}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/** ISO month strings (YYYY-MM-01) for the trailing n months, oldest first. */
export function trailingMonths(n: number): string[] {
  const out: string[] = [];
  const d = new Date(`${MOCK_TODAY}T00:00:00Z`);
  d.setUTCDate(1);
  for (let i = n - 1; i >= 0; i--) {
    const m = new Date(d);
    m.setUTCMonth(m.getUTCMonth() - i);
    out.push(m.toISOString().slice(0, 10));
  }
  return out;
}
