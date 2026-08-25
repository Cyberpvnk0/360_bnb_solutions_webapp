/**
 * Payload shape describers for setup diagnostics: they report a vendor
 * response's FIELD NAMES and value TYPES, never its values, so a mapper
 * can be pinned to a real schema with one request and nothing sensitive
 * is logged or leaked.
 */

/** What one field looks like across a whole sample of rows. */
export interface FieldReport {
  /** Value types seen at this path, e.g. ["string"] or ["number","string"]. */
  types: string[];
  /** How many rows carried a non-null value here. */
  present: number;
  /** Longest string seen. Absent for non-strings. This is the tell that
   *  separates prose from a label without revealing a single word of it. */
  maxLength?: number;
}

function record(
  out: Map<string, FieldReport>,
  path: string,
  type: string,
  length?: number
): void {
  const cur = out.get(path) ?? { types: [], present: 0 };
  if (!cur.types.includes(type)) cur.types.push(type);
  cur.present += 1;
  if (length !== undefined) {
    cur.maxLength = Math.max(cur.maxLength ?? 0, length);
  }
  out.set(path, cur);
}

/** Keys that are DATA, not schema: dates, ids, numeric indexes. A feed
 *  keyed by date (RentCast's `history`) would otherwise report one field
 *  path per day and bury the actual schema in tens of thousands of
 *  lines — the report has to describe the shape, not the contents. */
const DYNAMIC_KEY = /^(?:\d{4}-\d{2}-\d{2}|\d+|[0-9a-f]{8,})$/i;

function normalizeKey(key: string): string {
  return DYNAMIC_KEY.test(key) ? "*" : key;
}

function walk(
  value: unknown,
  path: string,
  depth: number,
  maxDepth: number,
  out: Map<string, FieldReport>
): void {
  // A null or absent value tells us nothing about the field, so it is
  // not recorded — `present` then counts real occurrences only.
  if (value === null || value === undefined) return;

  if (Array.isArray(value)) {
    record(out, path, "array");
    if (depth < maxDepth) {
      for (const item of value.slice(0, 5)) {
        walk(item, `${path}[]`, depth + 1, maxDepth, out);
      }
    }
    return;
  }

  if (typeof value === "object") {
    if (depth >= maxDepth) {
      record(out, path, "object");
      return;
    }
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const key = normalizeKey(k);
      walk(v, path ? `${path}.${key}` : key, depth + 1, maxDepth, out);
    }
    return;
  }

  record(
    out,
    path,
    typeof value,
    typeof value === "string" ? value.length : undefined
  );
}

/**
 * Every field the vendor ships, unioned across the WHOLE sample.
 *
 * Unioning matters: JSON feeds omit null fields per row, so a field the
 * vendor carries on one listing in fifty is invisible in the first row.
 * Describing only `rows[0]` would answer "does this feed carry
 * descriptions?" with a confident false no.
 */
export function describeFields(
  rows: unknown[],
  maxDepth = 3
): Record<string, FieldReport> {
  const out = new Map<string, FieldReport>();
  for (const row of rows) walk(row, "", 0, maxDepth, out);
  return Object.fromEntries(
    [...out.entries()].sort(([a], [b]) => a.localeCompare(b))
  );
}

/**
 * Every array in a payload, by dotted path and length.
 *
 * This is the "where are the records?" question, answered without
 * knowing the schema. A probe that only describes the array it already
 * found teaches nothing when extraction misses — which is exactly how a
 * live Redfin response came back reporting an empty shape rather than
 * naming the container it actually used.
 */
export function arrayPaths(
  value: unknown,
  path = "",
  depth = 0,
  out: { path: string; length: number }[] = []
): { path: string; length: number }[] {
  if (depth > 6 || out.length > 40) return out;
  if (Array.isArray(value)) {
    out.push({ path: path || "(root)", length: value.length });
    // Records usually sit in the first array found; don't recurse into
    // every element, just the first, to keep the report short.
    if (value.length > 0) arrayPaths(value[0], `${path}[0]`, depth + 1, out);
    return out;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      arrayPaths(v, path ? `${path}.${k}` : k, depth + 1, out);
    }
  }
  return out;
}

/**
 * Short string values under status-ish keys — a vendor explaining
 * itself, not record content. When a payload carries no records at all,
 * this is usually where it says why.
 */
export function statusStrings(
  value: unknown,
  depth = 0,
  out: Record<string, string> = {}
): Record<string, string> {
  if (depth > 4 || Object.keys(out).length > 12) return out;
  if (Array.isArray(value)) return out;
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (
        typeof v === "string" &&
        v.length <= 200 &&
        /error|message|status|detail|reason|warning|info/i.test(k)
      ) {
        out[k] = v;
      } else {
        statusStrings(v, depth + 1, out);
      }
    }
  }
  return out;
}

/** Past this length a string is prose, not a label: comfortably beyond
 *  "Single Family", a formatted address, or an agent's name. */
export const PROSE_MIN_LENGTH = 80;

/** Fields holding free text long enough for a description miner to read. */
export function proseFields(fields: Record<string, FieldReport>): string[] {
  return Object.entries(fields)
    .filter(
      ([, f]) => f.types.includes("string") && (f.maxLength ?? 0) >= PROSE_MIN_LENGTH
    )
    .map(([path]) => path);
}

/** Fields whose NAME suggests amenity or description content, whatever
 *  their length — a short `amenities` array is as good as prose. */
export function amenityFields(fields: Record<string, FieldReport>): string[] {
  return Object.keys(fields).filter((path) =>
    /amenit|feature|description|remark|marketing|highlight/i.test(path)
  );
}

/**
 * Legacy single-value describer: key names and types for one object.
 * Still used where a single representative row is the whole question.
 */
export function describeShape(value: unknown, depth = 0): unknown {
  if (Array.isArray(value)) {
    return depth > 3
      ? `array(${value.length})`
      : { array: value.length, first: describeShape(value[0], depth + 1) };
  }
  if (value && typeof value === "object") {
    if (depth > 3) return "object";
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        describeShape(v, depth + 1),
      ])
    );
  }
  return typeof value;
}
