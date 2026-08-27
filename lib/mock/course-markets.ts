/**
 * The markets the mentorship course actually teaches.
 *
 * Derived from the course city list — 78 cities across 27 states —
 * matched against this catalogue with the app's own search matcher, so
 * this is exactly the set a student following their coursework can
 * reach. Two of the 78 resolve to nothing: the PDF's combined
 * "Longboat Key/Siesta Key" line, where each name works on its own,
 * and "Cedar Hawke Springs, TN", which does not appear to be a real
 * place.
 *
 * WHY THIS EXISTS AS A LIST. Filling every market's measured figures
 * costs three billed calls each, 1,227 across the catalogue, at a
 * per-call price the vendor does not publish. These 75 are the ones
 * students are told to look at, which makes them the ones worth paying
 * for first — 225 calls instead of 1,227, for the markets that will
 * actually be opened.
 *
 * Regenerate rather than hand-edit if the course list changes: match
 * the cities through marketMatchesQuery + marketSearchText, exactly as
 * the search box does, so this cannot drift from what a student can
 * find.
 */
export const COURSE_MARKET_SLUGS: readonly string[] = [
  "augusta-ga",
  "austin",
  "bailey",
  "bakersfield",
  "berkeley-springs",
  "boise",
  "boone",
  "boston",
  "boulder",
  "brownsville",
  "carlsbad-nm",
  "cave-creek",
  "cedar-key",
  "chattanooga",
  "cincinnati",
  "columbia-sc",
  "columbus",
  "corvallis",
  "cripple-creek",
  "dayton",
  "detroit",
  "eagle-mountain-lake",
  "el-paso",
  "elizabethtown",
  "ellijay",
  "fayetteville-nc",
  "flagstaff",
  "fort-lauderdale",
  "fort-wayne",
  "fresno",
  "gainesville-fl",
  "gatlinburg",
  "grand-junction",
  "harpers-ferry",
  "hartford",
  "honolulu",
  "indianapolis",
  "jacksonville",
  "joshua-tree",
  "kailua-kona",
  "kissimmee",
  "lafayette",
  "las-cruces",
  "lincoln-ne",
  "logan-oh",
  "logan-ut",
  "memphis",
  "monterey",
  "montgomery",
  "nashville",
  "pensacola",
  "phoenix",
  "pigeon-forge",
  "portland-or",
  "princeville",
  "provo",
  "raleigh",
  "richmond",
  "san-antonio",
  "san-diego",
  "santa-clarita",
  "santa-fe",
  "scottsdale",
  "sedona",
  "sevierville",
  "sioux-falls",
  "spring-hill",
  "st-augustine",
  "st-louis",
  "stone-mountain",
  "tallahassee",
  "tampa",
  "tuscaloosa",
  "vero-beach",
  "zephyrhills",
] as const;

export const COURSE_MARKETS = new Set(COURSE_MARKET_SLUGS);
