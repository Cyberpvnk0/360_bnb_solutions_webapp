/**
 * Payload shape describer for setup diagnostics: returns a vendor
 * response's key names and value TYPES, never its values. Lets us pin a
 * mapper to a real schema with one request, without logging or leaking
 * listing data.
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
