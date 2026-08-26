/**
 * The basemap style the maps load:  /api/map/style
 *
 * Served from here rather than pointed at directly, for two reasons.
 *
 * A NEXT_PUBLIC_ variable is inlined into the bundle at build time, so
 * choosing a provider that way costs a rebuild — and Vercel refuses the
 * prefix on a variable marked sensitive, which is how anyone sensibly
 * stores a vendor key. Read here instead, the setting takes effect on
 * the next request with no deploy at all.
 *
 * Worth being straight about what this does and does not protect. The
 * style it returns carries the vendor's tile URLs with the key inside,
 * because the browser fetches those tiles itself — so the key reaches
 * the browser either way and is not a secret. What guards a map key is
 * the domain allowlist in the vendor's own dashboard, which is worth
 * setting. What this does buy: the key stays out of the JS bundle and
 * out of the repo, and the provider changes without a release.
 *
 * Precedence: an explicit style URL, then a MapTiler key, then
 * OpenFreeMap, which needs no key at all. Every branch answers with a
 * usable style, so a missing key degrades to the free provider rather
 * than to a blank map.
 */

import { NextResponse } from "next/server";

/** Styles are static for long stretches; one fetch serves everyone. */
const REVALIDATE_SECONDS = 86_400;

const OPENFREEMAP = "https://tiles.openfreemap.org/styles/positron";

/** Light and low-contrast: a backdrop, not the subject. Dark mode
 *  inverts the canvas in CSS, so one style covers both themes. */
const maptiler = (key: string) =>
  `https://api.maptiler.com/maps/dataviz-light/style.json?key=${encodeURIComponent(key)}`;

/** Both spellings: the documented one, and the one you get when the
 *  platform won't accept NEXT_PUBLIC_ on a sensitive variable. */
function resolve(): { url: string; provider: string } {
  const explicit =
    process.env.MAP_STYLE_URL ?? process.env.NEXT_PUBLIC_MAP_STYLE_URL;
  if (explicit) return { url: explicit, provider: "the configured style" };

  const key =
    process.env.MAPTILER_KEY ??
    process.env.NEXT_MAPTILER_KEY ??
    process.env.NEXT_PUBLIC_MAPTILER_KEY;
  if (key) return { url: maptiler(key), provider: "MapTiler" };

  return { url: OPENFREEMAP, provider: "OpenFreeMap" };
}

export async function GET() {
  const { url, provider } = resolve();

  let res: Response;
  try {
    res = await fetch(url, { next: { revalidate: REVALIDATE_SECONDS } });
  } catch {
    return NextResponse.json(
      { error: `could not reach ${provider}`, provider },
      { status: 502 }
    );
  }

  if (!res.ok) {
    // The status is the whole diagnostic — a rejected key reads 401/403
    // here rather than as a silently empty map.
    return NextResponse.json(
      { error: `${provider} answered ${res.status}`, provider },
      { status: 502 }
    );
  }

  const style = await res.text();
  return new NextResponse(style, {
    headers: {
      "content-type": "application/json",
      // Long-lived and revalidated in the background: the style is the
      // first thing every map waits on.
      "cache-control": "public, max-age=3600, stale-while-revalidate=86400",
      // Not read by the map — this is for opening the route by hand to
      // see which provider a deployment actually resolved to.
      "x-basemap-provider": provider,
    },
  });
}
