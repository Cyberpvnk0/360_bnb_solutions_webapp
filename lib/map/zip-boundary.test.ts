import { describe, expect, it } from "vitest";
import {
  bboxOf,
  esriToGeoJson,
  featureFromGeoJsonBody,
  isZipBoundary,
  zctaAtPointUrl,
  zctaLayerIdFrom,
  zctaQueryUrl,
  zipFromZctaBody,
} from "./zip-boundary";

describe("finding the ZCTA layer in a service's layer list", () => {
  it("takes the polygon layer named for ZIP Code Tabulation Areas, not its labels", () => {
    expect(
      zctaLayerIdFrom({
        layers: [
          { id: 0, name: "Census Tracts" },
          { id: 1, name: "2020 Census ZIP Code Tabulation Areas Labels" },
          { id: 2, name: "2020 Census ZIP Code Tabulation Areas" },
        ],
      })
    ).toBe(2);
  });

  it("prefers the newest census when the list carries more than one", () => {
    expect(
      zctaLayerIdFrom({
        layers: [
          { id: 4, name: "2010 Census ZIP Code Tabulation Areas" },
          { id: 7, name: "2020 Census ZIP Code Tabulation Areas" },
        ],
      })
    ).toBe(7);
  });

  it("recognises the Bureau's own abbreviation for the layer", () => {
    expect(zctaLayerIdFrom({ layers: [{ id: 5, name: "ZCTA5" }, { id: 6, name: "ZCTA5 Labels" }] })).toBe(5);
  });

  it("has no answer for a list without one, or for no list at all", () => {
    expect(zctaLayerIdFrom({ layers: [{ id: 0, name: "Counties" }] })).toBeNull();
    expect(zctaLayerIdFrom({ error: { code: 500 } })).toBeNull();
    expect(zctaLayerIdFrom(null)).toBeNull();
  });
});

describe("the query for one ZIP", () => {
  it("asks for that ZIP's geometry in longitude/latitude, generalised", () => {
    const url = new URL(zctaQueryUrl("https://x.test/MapServer", 2, "32225"));
    expect(url.pathname).toBe("/MapServer/2/query");
    expect(url.searchParams.get("where")).toBe("ZCTA5='32225'");
    expect(url.searchParams.get("outSR")).toBe("4326");
    expect(url.searchParams.get("outFields")).toBe("*");
    expect(url.searchParams.get("f")).toBe("geojson");
    expect(Number(url.searchParams.get("maxAllowableOffset"))).toBeGreaterThan(0);
  });

  it("can ask by GEOID and for Esri JSON, for a server that wants either", () => {
    const url = new URL(
      zctaQueryUrl("https://x.test/MapServer", 2, "32225", { field: "GEOID", format: "json" })
    );
    expect(url.searchParams.get("where")).toBe("GEOID='32225'");
    expect(url.searchParams.get("f")).toBe("json");
  });
});

/** Winds clockwise in lon/lat — Esri's direction for an outer ring. */
const SQUARE = [
  [-81.5, 30.3],
  [-81.5, 30.4],
  [-81.4, 30.4],
  [-81.4, 30.3],
  [-81.5, 30.3],
];
/** Winds the other way — Esri's direction for a hole. */
const HOLE = [
  [-81.47, 30.33],
  [-81.43, 30.33],
  [-81.43, 30.37],
  [-81.47, 30.37],
  [-81.47, 30.33],
];

describe("reading the outline out of an answer", () => {
  it("takes the first polygon feature of a GeoJSON answer", () => {
    const f = featureFromGeoJsonBody({
      type: "FeatureCollection",
      features: [{ type: "Feature", geometry: { type: "Polygon", coordinates: [SQUARE] }, properties: { ZCTA5: "32225" } }],
    });
    expect(f?.geometry.type).toBe("Polygon");
    expect(bboxOf(f!)).toEqual([-81.5, 30.3, -81.4, 30.4]);
  });

  it("reads a MultiPolygon and boxes all of it", () => {
    const east = SQUARE.map(([x, y]) => [x + 1, y]);
    const f = featureFromGeoJsonBody({
      features: [{ geometry: { type: "MultiPolygon", coordinates: [[SQUARE], [east]] } }],
    });
    expect(f?.geometry.type).toBe("MultiPolygon");
    expect(bboxOf(f!)).toEqual([-81.5, 30.3, -80.4, 30.4]);
  });

  it("has nothing for an error body, an empty result, or a point", () => {
    expect(featureFromGeoJsonBody({ error: { code: 400, message: "Invalid field" } })).toBeNull();
    expect(featureFromGeoJsonBody({ features: [] })).toBeNull();
    expect(
      featureFromGeoJsonBody({ features: [{ geometry: { type: "Point", coordinates: [1, 2] } }] })
    ).toBeNull();
  });

  it("converts Esri rings, keeping a hole with its outer ring", () => {
    const f = esriToGeoJson({ features: [{ geometry: { rings: [SQUARE, HOLE] } }] });
    expect(f?.geometry.type).toBe("Polygon");
    expect((f!.geometry as { coordinates: number[][][] }).coordinates).toHaveLength(2);
  });

  it("converts two Esri outer rings into a MultiPolygon", () => {
    const east = SQUARE.map(([x, y]) => [x + 1, y]);
    const f = esriToGeoJson({ features: [{ geometry: { rings: [SQUARE, east] } }] });
    expect(f?.geometry.type).toBe("MultiPolygon");
    expect((f!.geometry as { coordinates: number[][][][] }).coordinates).toHaveLength(2);
  });
});

describe("a stored boundary is checked before it is trusted", () => {
  it("accepts the shape this module writes and nothing looser", () => {
    const f = featureFromGeoJsonBody({ features: [{ geometry: { type: "Polygon", coordinates: [SQUARE] } }] })!;
    expect(isZipBoundary({ zip: "32225", feature: f, bbox: bboxOf(f) })).toBe(true);
    expect(isZipBoundary({ zip: "3222", feature: f, bbox: bboxOf(f) })).toBe(false);
    expect(isZipBoundary({ zip: "32225", feature: { type: "Feature" }, bbox: [0, 0, 0, 0] })).toBe(false);
    expect(isZipBoundary(null)).toBe(false);
  });
});

describe("the ZIP under a point", () => {
  it("asks the layer which area the point intersects, without the shape", () => {
    const url = new URL(zctaAtPointUrl("https://svc/MapServer", 7, { lat: 27.99, lon: -82.44 }));
    expect(url.pathname).toBe("/MapServer/7/query");
    expect(url.searchParams.get("geometry")).toBe("-82.44,27.99");
    expect(url.searchParams.get("geometryType")).toBe("esriGeometryPoint");
    expect(url.searchParams.get("spatialRel")).toBe("esriSpatialRelIntersects");
    expect(url.searchParams.get("returnGeometry")).toBe("false");
  });

  it("reads the five digits under whichever field the layer files them", () => {
    expect(zipFromZctaBody({ features: [{ attributes: { ZCTA5: "33604", NAME: "ZCTA5 33604" } }] })).toBe("33604");
    expect(zipFromZctaBody({ features: [{ attributes: { GEOID: "33604" } }] })).toBe("33604");
    expect(zipFromZctaBody({ features: [{ properties: { BASENAME: "33604" } }] })).toBe("33604");
    expect(zipFromZctaBody({ features: [{ attributes: { NAME: "nothing here" } }] })).toBeNull();
    expect(zipFromZctaBody({ features: [] })).toBeNull();
    expect(zipFromZctaBody({ error: { message: "bad" } })).toBeNull();
  });
});
