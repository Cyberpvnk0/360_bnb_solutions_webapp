/**
 * Turn a Redfin sitemap into REDFIN_CITY_ID entries.
 *
 * ScraperAPI can't proxy the rental-city sitemap — it's too large, and
 * every attempt came back 500 or timed out. A browser has no such
 * trouble, so the file gets fetched by hand once and parsed here. The
 * result is a static map committed to source: no runtime lookups, no
 * credits, and nothing that can break when an undocumented endpoint
 * changes.
 *
 *   node scripts/city-ids-from-sitemap.mjs <file.xml> [more.xml ...]
 *
 * Matching is the same verification the app uses — city name whole AND
 * state exact — because a wrong id hard-coded into source would ship,
 * and would look right.
 */

import { readFileSync } from "node:fs";
import { MARKETS } from "../lib/mock/markets.ts";
import { REDFIN_CITY_ID, normalizeCity } from "../lib/live/redfin-city.ts";

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: node scripts/city-ids-from-sitemap.mjs <file.xml> ...");
  process.exit(1);
}

/** `/city/8907/FL/Jacksonville/...` — id, state and name, anywhere. */
const CITY_URL = /\/city\/(\d+)\/([A-Z]{2})\/([^/"'<>\s]+)/g;

const byKey = new Map();
let urlsSeen = 0;

for (const file of files) {
  const xml = readFileSync(file, "utf8");
  for (const m of xml.matchAll(CITY_URL)) {
    urlsSeen++;
    const id = Number(m[1]);
    const key = `${m[2]}:${normalizeCity(m[3].replace(/-/g, " "))}`;
    if (Number.isFinite(id) && !byKey.has(key)) byKey.set(key, id);
  }
}

const resolved = {};
const missing = [];
for (const market of MARKETS) {
  const id = byKey.get(`${market.stateCode}:${normalizeCity(market.name)}`);
  if (id === undefined) missing.push(`${market.slug} (${market.name}, ${market.stateCode})`);
  else resolved[market.slug] = id;
}

const already = Object.keys(REDFIN_CITY_ID).length;
const conflicts = Object.entries(resolved).filter(
  ([slug, id]) => REDFIN_CITY_ID[slug] !== undefined && REDFIN_CITY_ID[slug] !== id
);

console.log(`city URLs scanned:   ${urlsSeen}`);
console.log(`distinct cities:     ${byKey.size}`);
console.log(`markets matched:     ${Object.keys(resolved).length} / ${MARKETS.length}`);
console.log(`already in the map:  ${already}`);
console.log(`conflicts with map:  ${conflicts.length}`);
for (const [slug, id] of conflicts) {
  console.log(`  ! ${slug}: committed ${REDFIN_CITY_ID[slug]} vs sitemap ${id}`);
}
console.log(`\nstill unmatched (${missing.length}):`);
for (const m of missing) console.log(`  ${m}`);

console.log("\n----- REDFIN_CITY_ID -----");
for (const slug of Object.keys(resolved).sort()) {
  const key = /^[a-z][a-z0-9]*$/.test(slug) ? slug : `"${slug}"`;
  console.log(`  ${key}: ${resolved[slug]},`);
}
