/**
 * Property imagery, in order of honesty:
 *
 *   1. A real listing photo, when the feed carries one.
 *   2. Google Street View of the address — what the building actually
 *      looks like from the curb.
 *   3. The seeded sketch, clearly tagged, when neither exists.
 *
 * Street View runs through our own route so the Google key stays on the
 * server and each address is fetched at most once a month. Google bills
 * per image request; the free metadata probe tells us whether imagery
 * exists before we ever pay for a picture, so blank spots cost nothing.
 */

const STREET_VIEW = "https://maps.googleapis.com/maps/api/streetview";

/**
 * Every spelling this key might have been saved under.
 *
 * Names are cheap; a silent miss because the variable was called
 * something reasonable-but-different costs an afternoon, and this
 * product has now lost one to exactly that twice — once to a Supabase
 * variable renamed in the dashboard, once here.
 */
const KEY_NAMES = [
  "GOOGLE_MAPS_API_KEY",
  "GOOGLE_MAPS_SECRET",
  "GOOGLE_MAPS_KEY",
  "GOOGLE_API_KEY",
] as const;

export function googleMapsKey(): string | null {
  for (const name of KEY_NAMES) {
    const value = process.env[name];
    if (value) return value;
  }
  return null;
}

/** Which GOOGLE_* names this deployment can see. Names only, never
 *  values — a diagnostic that prints a key is worse than the confusion
 *  it clears up. */
export function googleKeyNamesSeen(): string[] {
  return Object.keys(process.env)
    .filter((k) => /^GOOGLE/i.test(k))
    .sort();
}

/** Street View imagery rarely changes — cache hard. */
export const PHOTO_REVALIDATE_SECONDS = 2_592_000; // 30 days

export function hasGoogleKey(): boolean {
  return googleMapsKey() !== null;
}

/** Free metadata probe: does Street View have this spot at all? */
export async function streetViewExists(
  lat: number,
  lon: number
): Promise<boolean> {
  const key = googleMapsKey();
  if (!key) return false;
  const params = new URLSearchParams({
    location: `${lat},${lon}`,
    key,
    source: "outdoor",
  });
  try {
    const res = await fetch(`${STREET_VIEW}/metadata?${params}`, {
      next: { revalidate: PHOTO_REVALIDATE_SECONDS },
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { status?: string };
    return body.status === "OK";
  } catch {
    return false;
  }
}

/** The billed image request — only ever made after the probe says OK. */
export async function fetchStreetView(
  lat: number,
  lon: number
): Promise<ArrayBuffer | null> {
  const key = googleMapsKey();
  if (!key) return null;
  const params = new URLSearchParams({
    location: `${lat},${lon}`,
    size: "640x360",
    fov: "80",
    return_error_code: "true",
    source: "outdoor",
    key,
  });
  try {
    const res = await fetch(`${STREET_VIEW}?${params}`, {
      next: { revalidate: PHOTO_REVALIDATE_SECONDS },
    });
    if (!res.ok) return null;
    return await res.arrayBuffer();
  } catch {
    return null;
  }
}
