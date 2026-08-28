/**
 * Session refresh and route protection, before any page renders.
 *
 * NOT middleware.ts. That convention is deprecated in Next 16 and
 * renamed to proxy.ts with a `proxy` export — every Supabase auth guide
 * still says middleware, and a file by that name here would simply
 * never run, leaving sessions unrefreshed and routes unguarded with no
 * error to notice.
 *
 * Two jobs, in order:
 *
 * 1. Refresh the auth token. Access tokens are short-lived; without a
 *    refresh on each request the user is signed out mid-session. This
 *    is the only place allowed to write cookies, which is why the
 *    server client's own setAll is permitted to fail quietly.
 *
 * 2. Send signed-out visitors to the sign-in page, and signed-in ones
 *    away from it.
 */

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** Everything a signed-out visitor may see. */
const PUBLIC_PATHS = ["/login", "/signup", "/auth", "/"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || (p !== "/" && pathname.startsWith(`${p}/`))
  );
}

export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Unconfigured means every route stays open rather than every route
  // locking out: a missing variable should not present as a site-wide
  // outage with no explanation.
  if (!url || !key) return NextResponse.next();

  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // getUser, not getSession: this revalidates the token against the
  // auth server. getSession reads a cookie and believes it, which is
  // not a check.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (!user && !isPublic(pathname)) {
    const to = request.nextUrl.clone();
    to.pathname = "/login";
    // Come back here once they are in, rather than dumping everyone on
    // the dashboard regardless of what they clicked.
    to.searchParams.set("next", pathname + request.nextUrl.search);
    return NextResponse.redirect(to);
  }

  if (user && (pathname === "/login" || pathname === "/signup")) {
    const to = request.nextUrl.clone();
    to.pathname = "/dashboard";
    to.search = "";
    return NextResponse.redirect(to);
  }

  return response;
}

export const config = {
  /**
   * Everything except static assets and images. The auth token has to
   * be refreshed on real navigations; running this for every font and
   * icon would be pure latency.
   */
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|woff2?)$).*)",
  ],
};
