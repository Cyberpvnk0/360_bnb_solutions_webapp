/** Synthetic values in the schema measured by the Boston pageShape probe. */
export const FURNISHED_BOSTON = "https://www.redfin.com/city/1826/MA/Boston/rentals/filter/is-furnished";
export const RENTAL_CACHE_KEY = "/stingray/api/v1/search/rentals?isRentals=true&is_furnished=true&region_id=1826&region_type=6&num_homes=350";
export const PRIVATE_PROSE = "Listing prose must stay inside the parser, even when it says unfurnished.";
export const PRIVATE_PHOTO = "https://photos.example.test/do-not-copy.jpg";

export function rentalHome(id = 1) {
  return {
    homeData: {
      propertyId: String(id), propertyType: 6,
      url: `/MA/Boston/${id}-Example-St-02108/home/${id}`,
      addressInfo: {
        formattedStreetLine: `${id} Example St`, city: "Boston", state: "MA", zip: "02108",
        centroid: { centroid: { latitude: 42.35, longitude: -71.06 } },
      },
      photosInfo: { photoUrl: PRIVATE_PHOTO }, staticMapUrl: PRIVATE_PHOTO,
    },
    rentalExtension: {
      rentPriceRange: { min: 2500, max: 4000 }, bedRange: { min: 2, max: 3 },
      bathRange: { min: 1.5, max: 2 }, sqftRange: { min: 800, max: 1200 },
      description: PRIVATE_PROSE,
      keyFacts: [{ description: "Unfurnished" }],
    },
  };
}

export function rentalPage(
  homes: unknown[] = [rentalHome()],
  opts: { key?: string; total?: number; extra?: Record<string, unknown> } = {}
) {
  const cache = {
    [opts.key ?? RENTAL_CACHE_KEY]: {
      res: { text: JSON.stringify({ homes, numMatchedHomes: opts.total ?? homes.length, numMatchedUnits: homes.length }) },
    },
    ...opts.extra,
  };
  return `<script>root.__reactServerState.InitialContext = ${JSON.stringify({
    "ReactServerAgent.cache": { dataCache: cache },
  })};</script>`;
}
