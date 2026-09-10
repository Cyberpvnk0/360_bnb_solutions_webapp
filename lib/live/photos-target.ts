/**
 * Where a "View photos" click lands, decided in one quick pass.
 *
 * In the order lib/live/listing-links sets out:
 *
 *   1. Redfin — the listing's own page, from the store or the ZIP's
 *      rentals, read within a few seconds and never the slow lookup
 *      (lib/live/redfin-page, fast).
 *   2. Zillow — the home's page when Zillow says it has one; its
 *      address page when Zillow could not be asked (lib/live/zillow-page).
 *   3. Google Images — pictures of the full address, when Zillow said
 *      it has no such home: the last resort, reached without another
 *      click. Realtor cannot be asked whether it has the home — it
 *      exposes no address URL and a search of it is a page of links,
 *      not a hit — so it stays on the menu and the finder page rather
 *      than in this chain.
 *
 * Redfin and Zillow are asked at the same time, so the click waits for
 * the slower of two short reads rather than the sum of them.
 */

import { addressSearchHref, photoSources, zillowHref, type Addressed } from "./listing-links";
import { resolveListingPage } from "./redfin-page";
import { checkZillow } from "./zillow-page";

export interface PhotosTarget {
  href: string;
  source: "redfin" | "zillow" | "google";
  /** True when the site itself said the page is this property's. */
  verified: boolean;
  /** For the person asking why: what each site said. */
  detail: string;
}

export async function photosTarget(place: Addressed): Promise<PhotosTarget | null> {
  if (photoSources(place).length === 0) return null;

  const [redfin, zillow] = await Promise.all([
    resolveListingPage(
      { address: place.address, city: place.city, stateCode: place.stateCode, zip: place.zip, point: place.point },
      { fast: true }
    ),
    checkZillow(place),
  ]);

  const notes = [
    `redfin: ${redfin.url ? "page" : redfin.detail ?? "no page"}`,
    `zillow: ${zillow.kind === "page" ? "page" : `${zillow.kind} (${zillow.detail})`}`,
  ];
  if (redfin.url) {
    return { href: redfin.url, source: "redfin", verified: true, detail: notes.join("; ") };
  }
  if (zillow.kind === "page") {
    return { href: zillow.url, source: "zillow", verified: true, detail: notes.join("; ") };
  }
  if (zillow.kind === "none") {
    const images = addressSearchHref(place);
    if (images) return { href: images, source: "google", verified: false, detail: notes.join("; ") };
  }
  const address = zillowHref(place);
  return address ? { href: address, source: "zillow", verified: false, detail: notes.join("; ") } : null;
}
