/**
 * The outline of a ZIP code, for the map.
 *
 * A ZIP search draws the ZIP: a red border around the area, the way
 * every property portal frames a searched neighbourhood, so a person
 * can see where the listings stop and why. The shapes are the Census
 * Bureau's ZIP Code Tabulation Areas — the public, keyless boundary
 * set the portals themselves approximate — read from TIGERweb, the
 * Bureau's own map service.
 *
 * THE LAYER IS DISCOVERED, NOT HARD-CODED. TIGERweb publishes the ZCTA
 * layer under an id that has moved between service revisions, in more
 * than one service. Asking the service for its layer list and picking
 * the one named for ZIP Code Tabulation Areas costs one cached request
 * per process and cannot go stale the way a number in this file would.
 *
 * Generalised to about thirty metres on the way out: a coastal ZIP's
 * full-resolution outline is megabytes of shoreline that draw as the
 * same line at any zoom the Deal Finder uses.
 *
 * Pure parsing lives here so it can be tested without the network; the
 * one function that fetches degrades to null, never throws, and the
 * map simply draws no outline.
 */

export interface PolygonGeometry {
  type: "Polygon";
  coordinates: number[][][];
}
export interface MultiPolygonGeometry {
  type: "MultiPolygon";
  coordinates: number[][][][];
}
export interface BoundaryFeature {
  type: "Feature";
  geometry: PolygonGeometry | MultiPolygonGeometry;
  properties: Record<string, unknown>;
}

/** [west, south, east, north] in degrees. */
export type Bbox = [number, number, number, number];

export interface ZipBoundary {
  zip: string;
  feature: BoundaryFeature;
  bbox: Bbox;
}

/** The services that carry ZCTA layers, in the order they are asked. */
export const TIGERWEB_SERVICES = [
  "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer",
  "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/PUMA_TAD_TAZ_UGA_ZCTA/MapServer",
] as const;

/**
 * The id of the ZCTA polygon layer in a service's layer list — the one
 * named for ZIP Code Tabulation Areas that is not its labels layer,
 * preferring the newest census where the list carries more than one.
 */
export function zctaLayerFrom(meta: unknown): { id: number; name: string } | null {
  const layers = (meta as { layers?: unknown })?.layers;
  if (!Array.isArray(layers)) return null;
  const candidates = layers
    .filter(
      (l): l is { id: number; name: string } =>
        !!l &&
        typeof l === "object" &&
        typeof (l as { id?: unknown }).id === "number" &&
        typeof (l as { name?: unknown }).name === "string"
    )
    .filter(
      (l) => /zip\s*code\s*tabulation|\bzcta/i.test(l.name) && !/label/i.test(l.name)
    );
  if (candidates.length === 0) return null;
  const year = (name: string) => Number(/\b(19|20)\d{2}\b/.exec(name)?.[0] ?? 0);
  candidates.sort((a, b) => year(b.name) - year(a.name));
  return { id: candidates[0].id, name: candidates[0].name };
}

export function zctaLayerIdFrom(meta: unknown): number | null {
  return zctaLayerFrom(meta)?.id ?? null;
}

/** The query for one ZIP's outline against a discovered layer. */
export function zctaQueryUrl(
  service: string,
  layerId: number,
  zip: string,
  opts: { field?: "ZCTA5" | "GEOID"; format?: "geojson" | "json" } = {}
): string {
  const field = opts.field ?? "ZCTA5";
  const params = new URLSearchParams({
    where: `${field}='${zip}'`,
    // Every attribute rather than a named few: naming one the layer
    // does not carry fails the whole query, and the row is small.
    outFields: "*",
    returnGeometry: "true",
    outSR: "4326",
    geometryPrecision: "5",
    // Degrees, since outSR is 4326: about thirty metres.
    maxAllowableOffset: "0.0003",
    f: opts.format ?? "geojson",
  });
  return `${service}/${layerId}/query?${params}`;
}

function isRing(v: unknown): v is number[][] {
  return (
    Array.isArray(v) &&
    v.length >= 4 &&
    v.every(
      (p) =>
        Array.isArray(p) &&
        p.length >= 2 &&
        typeof p[0] === "number" &&
        typeof p[1] === "number"
    )
  );
}

/** Shoelace area in degree² — sign is the winding. */
function signedArea(ring: number[][]): number {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return a / 2;
}

/**
 * A GeoJSON feature out of a GeoJSON query response, or null when the
 * body is not one (an error object, an empty result, an unexpected
 * shape). Takes the first polygon feature; a ZIP is one record.
 */
export function featureFromGeoJsonBody(body: unknown): BoundaryFeature | null {
  const features = (body as { features?: unknown })?.features;
  if (!Array.isArray(features)) return null;
  for (const f of features) {
    const geometry = (f as { geometry?: unknown })?.geometry as
      | { type?: unknown; coordinates?: unknown }
      | null
      | undefined;
    if (!geometry) continue;
    if (geometry.type === "Polygon" && Array.isArray(geometry.coordinates)) {
      const rings = geometry.coordinates.filter(isRing);
      if (rings.length === 0) continue;
      return { type: "Feature", geometry: { type: "Polygon", coordinates: rings }, properties: {} };
    }
    if (geometry.type === "MultiPolygon" && Array.isArray(geometry.coordinates)) {
      const polys = geometry.coordinates
        .filter((p): p is number[][][] => Array.isArray(p))
        .map((p) => p.filter(isRing))
        .filter((p) => p.length > 0);
      if (polys.length === 0) continue;
      return { type: "Feature", geometry: { type: "MultiPolygon", coordinates: polys }, properties: {} };
    }
  }
  return null;
}

/**
 * The same, out of an Esri JSON response — the format every ArcGIS
 * server speaks, kept as the fallback for one that declines GeoJSON.
 * Esri rings wind clockwise for an outer boundary and the other way for
 * a hole, and carry no other nesting, so the winding decides which
 * polygon each ring belongs to.
 */
export function esriToGeoJson(body: unknown): BoundaryFeature | null {
  const features = (body as { features?: unknown })?.features;
  if (!Array.isArray(features)) return null;
  for (const f of features) {
    const rings = (f as { geometry?: { rings?: unknown } })?.geometry?.rings;
    if (!Array.isArray(rings)) continue;
    const polygons: number[][][][] = [];
    for (const ring of rings) {
      if (!isRing(ring)) continue;
      // Clockwise in x-east/y-north terms is a negative shoelace area.
      const outer = signedArea(ring) < 0;
      if (outer || polygons.length === 0) polygons.push([ring]);
      else polygons[polygons.length - 1].push(ring);
    }
    if (polygons.length === 0) continue;
    return polygons.length === 1
      ? { type: "Feature", geometry: { type: "Polygon", coordinates: polygons[0] }, properties: {} }
      : { type: "Feature", geometry: { type: "MultiPolygon", coordinates: polygons }, properties: {} };
  }
  return null;
}

export function bboxOf(feature: BoundaryFeature): Bbox {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  const rings =
    feature.geometry.type === "Polygon"
      ? feature.geometry.coordinates
      : feature.geometry.coordinates.flat();
  for (const ring of rings) {
    for (const [x, y] of ring) {
      if (x < w) w = x;
      if (x > e) e = x;
      if (y < s) s = y;
      if (y > n) n = y;
    }
  }
  return [w, s, e, n];
}

/** A stored or relayed boundary, checked before it is trusted. */
export function isZipBoundary(value: unknown): value is ZipBoundary {
  const v = value as ZipBoundary | null;
  return (
    !!v &&
    typeof v === "object" &&
    typeof v.zip === "string" &&
    /^\d{5}$/.test(v.zip) &&
    Array.isArray(v.bbox) &&
    v.bbox.length === 4 &&
    v.bbox.every((n) => typeof n === "number" && Number.isFinite(n)) &&
    featureFromGeoJsonBody({ features: [v.feature] }) !== null
  );
}

/* ------------------------------------------------------------------ */
/* Fetching                                                            */
/* ------------------------------------------------------------------ */

/** A month: ZCTA boundaries change with a census, not a season. */
const REVALIDATE_SECONDS = 30 * 24 * 60 * 60;
const TIMEOUT_MS = 8_000;

/** Which service and layer answered, remembered per process. */
let zctaLayer: { service: string; layerId: number; name: string } | null = null;

type Fetched = { ok: true; body: unknown } | { ok: false; detail: string };

async function getJson(url: string): Promise<Fetched> {
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      next: { revalidate: REVALIDATE_SECONDS },
    });
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    const body = await res.json().catch(() => null);
    return body === null ? { ok: false, detail: "not JSON" } : { ok: true, body };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : "fetch failed" };
  }
}

/** The service's short name, for a diagnostic line. */
function serviceName(service: string): string {
  return service.split("/services/")[1] ?? service;
}

async function discoverZctaLayer(): Promise<
  { ok: true; service: string; layerId: number; name: string } | { ok: false; detail: string }
> {
  if (zctaLayer) return { ok: true, ...zctaLayer };
  const notes: string[] = [];
  for (const service of TIGERWEB_SERVICES) {
    const got = await getJson(`${service}?f=json`);
    if (!got.ok) {
      notes.push(`${serviceName(service)}: ${got.detail}`);
      continue;
    }
    const layer = zctaLayerFrom(got.body);
    if (layer) {
      zctaLayer = { service, layerId: layer.id, name: layer.name };
      return { ok: true, ...zctaLayer };
    }
    const count = (got.body as { layers?: unknown[] })?.layers?.length ?? 0;
    notes.push(`${serviceName(service)}: no ZCTA layer among ${count} layers`);
  }
  return { ok: false, detail: notes.join("; ") };
}

export type BoundaryLookup =
  | { ok: true; boundary: ZipBoundary }
  | {
      ok: false;
      reason: "bad-zip" | "no-layer" | "no-shape";
      /** What each step said, for the person reading the route's
       *  answer: which service, which layer, what each query returned.
       *  Service prose, never listing data. */
      detail: string;
    };

/**
 * One ZIP's outline, or the reason there is none: an unreachable
 * service, a ZIP the Bureau has no tabulation area for (some are
 * post-office boxes with no ground), an answer in a shape this does
 * not read. Nothing here throws.
 */
export async function lookupZipBoundary(zip: string): Promise<BoundaryLookup> {
  if (!/^\d{5}$/.test(zip)) return { ok: false, reason: "bad-zip", detail: "five digits" };
  const layer = await discoverZctaLayer();
  if (!layer.ok) return { ok: false, reason: "no-layer", detail: layer.detail };

  const attempts: Array<{ field: "ZCTA5" | "GEOID"; format: "geojson" | "json" }> = [
    { field: "ZCTA5", format: "geojson" },
    { field: "GEOID", format: "geojson" },
    { field: "ZCTA5", format: "json" },
    { field: "GEOID", format: "json" },
  ];
  const notes: string[] = [];
  for (const attempt of attempts) {
    const label = `${attempt.field}/${attempt.format}`;
    const got = await getJson(zctaQueryUrl(layer.service, layer.layerId, zip, attempt));
    if (!got.ok) {
      notes.push(`${label}: ${got.detail}`);
      continue;
    }
    // ArcGIS answers a bad query with 200 and an error object.
    const err = (got.body as { error?: { message?: string; details?: string[] } })?.error;
    if (err) {
      notes.push(`${label}: ${[err.message, ...(err.details ?? [])].filter(Boolean).join(" ")}`);
      continue;
    }
    const feature =
      attempt.format === "geojson" ? featureFromGeoJsonBody(got.body) : esriToGeoJson(got.body);
    if (feature) return { ok: true, boundary: { zip, feature, bbox: bboxOf(feature) } };
    const n = (got.body as { features?: unknown[] })?.features?.length;
    notes.push(`${label}: ${n === 0 ? "no record for this ZIP" : "no polygon in the answer"}`);
  }
  return {
    ok: false,
    reason: "no-shape",
    detail: `${serviceName(layer.service)} layer ${layer.layerId} "${layer.name}" — ${notes.join("; ")}`,
  };
}

/** The outline alone, for callers that do not need the reason. */
export async function fetchZipBoundary(zip: string): Promise<ZipBoundary | null> {
  const found = await lookupZipBoundary(zip);
  return found.ok ? found.boundary : null;
}
