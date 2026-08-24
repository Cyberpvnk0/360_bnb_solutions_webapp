/**
 * The one feature miner.
 *
 * Every source of descriptive text — a feed's amenity array, a feed's
 * remarks, a scraped listing page — runs through this and nothing else,
 * so "Furnished" means exactly the same thing wherever it appears in the
 * product. Adding a vendor never adds a second definition.
 *
 * Two rules make the output safe to filter on:
 *
 *   Unknown is not none. `mineFeatures` returns null when it was handed
 *   no text at all. An empty array would read as "this rental has none
 *   of these", which is a different and unearned claim.
 *
 *   A negated mention is not a feature. "Unfurnished", "not furnished",
 *   and "furnished optional" all contain the word a naive matcher wants.
 *   A wrong Furnished tag costs a student a call on a unit they'd have
 *   to furnish themselves, so anything ambiguous is dropped.
 */

/** Feature words worth surfacing, and the phrases that imply them. */
export const FEATURE_PATTERNS: [string, RegExp][] = [
  ["Furnished", /\bfully[- ]?furnished\b|\bfurnished\b/i],
  ["Pet friendly", /\bpets?[- ]?(?:friendly|allowed|ok)\b|\bdogs? ok\b/i],
  ["Private pool", /\b(?:private )?pool\b/i],
  ["Waterfront", /\bwaterfront\b|\bwater ?front\b/i],
  ["Ocean view", /\bocean ?view\b|\bbeach ?front\b/i],
  ["Mountain view", /\bmountain ?view\b/i],
  ["Hot tub", /\bhot ?tub\b|\bjacuzzi\b|\bspa\b/i],
  ["Washer & dryer", /\bwasher\b.{0,12}\bdryer\b|\bw\/d\b|\blaundry in unit\b/i],
  ["Garage", /\bgarage\b/i],
  ["Balcony", /\bbalcony\b|\bpatio\b/i],
  ["Fenced yard", /\bfenced\b.{0,10}\byard\b/i],
  ["Renovated", /\brenovated\b|\bremodeled\b|\bupdated\b/i],
  ["Gated community", /\bgated\b/i],
  ["Near transit", /\bnear (?:transit|subway|metro)\b/i],
];

/**
 * Phrases that disqualify a feature even when its positive pattern hit.
 *
 * These fire on the WHOLE text, not on the neighbourhood of the match,
 * which is deliberately blunt: a page that says both "unfurnished" and
 * "furnished units available in our sister building" is ambiguous, and
 * the honest answer to an ambiguous page is no tag rather than a guess.
 */
export const FEATURE_NEGATIONS: Record<string, RegExp> = {
  Furnished:
    /\bunfurnished\b|\bnot\s+furnished\b|\bno\s+furniture\b|\bfurniture\s+not\s+included\b|\bfurnish(?:ed|ing)?\s+(?:is\s+)?optional\b|\bcan\s+be\s+furnished\b|\bunfurnished\s+only\b/i,
  "Pet friendly": /\bno\s+pets?\b|\bpets?\s+not\s+allowed\b|\bno\s+dogs?\b/i,
  "Private pool": /\bno\s+pool\b|\bcommunity\s+pool\s+only\b/i,
  "Washer & dryer": /\bno\s+(?:washer|laundry)\b|\blaundry\s+(?:on\s+site|nearby)\b/i,
  Garage: /\bno\s+garage\b|\bstreet\s+parking\s+only\b/i,
};

/**
 * Feature tags mined from every scrap of descriptive text a source gave
 * us. Null means "we were handed nothing" — see the unknown-is-not-none
 * rule above. An empty array means we read real text and it described
 * none of these.
 */
export function mineFeatures(
  texts: readonly (string | null | undefined)[]
): string[] | null {
  const usable = texts.filter(
    (t): t is string => typeof t === "string" && t.trim() !== ""
  );
  if (usable.length === 0) return null;

  const haystack = usable.join(" \n ");
  const found = FEATURE_PATTERNS.filter(([label, positive]) => {
    if (!positive.test(haystack)) return false;
    const negation = FEATURE_NEGATIONS[label];
    return !negation?.test(haystack);
  }).map(([label]) => label);

  return [...new Set(found)];
}
