/**
 * One generic-endpoint read of a furnished Redfin search, for operators.
 * The HTML and embedded JSON stay local. Only schema and request metadata
 * leave this function; there is deliberately no speculative listing mapper.
 */
import { arraysOfObjects, atPath, decodeJsonValues, findJsonBlobs } from "./redfin-page-json";
import { describeFields } from "./shape";
import {
  readRedfinPage,
  redfinRentalsUrlFor,
  redfinScrapeTier,
  type RedfinScrapeTier,
} from "./redfin";
import type { Market } from "@/lib/mock/types";

function shapeOf(value: unknown) {
  return {
    fields: describeFields([value], 5),
    arrays: arraysOfObjects(value, 1, 10).map((array) => ({
      ...array,
      fields: describeFields(atPath(value, array.path) as unknown[], 7),
    })),
  };
}

export async function probeRedfinPage(
  market: Market,
  cityId: number,
  opts: {
    tier?: RedfinScrapeTier;
    path?: "rentals" | "apartments-for-rent";
  } = {}
) {
  const tier = opts.tier ?? redfinScrapeTier();
  const searchUrl = redfinRentalsUrlFor(market, cityId, { furnished: true })
    .replace("/rentals/", `/${opts.path ?? "apartments-for-rent"}/`);
  const result = await readRedfinPage(searchUrl, tier, (doc) =>
    findJsonBlobs(doc, 0).map((blob) => {
      const decoded = decodeJsonValues(blob.value);
      const cache = atPath(decoded, '["ReactServerAgent.cache"].dataCache');
      const searches = cache && typeof cache === "object"
        ? Object.entries(cache).filter(([key]) => key.startsWith("/stingray/api/v1/search/rentals?"))
          .map(([key, entry]) => ({ key, fields: describeFields([atPath(entry, "res.text")], 2) }))
        : [];
      return {
        marker: blob.marker,
        bytes: blob.bytes,
        ...shapeOf(decoded),
        searches,
      };
    })
  );
  return {
    market: market.slug,
    searchUrl,
    tier,
    status: 200,
    bytes: result.bytes,
    credits: result.credits,
    blobs: result.data,
  };
}
