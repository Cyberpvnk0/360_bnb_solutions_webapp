/**
 * A Supabase client for server components and route handlers.
 *
 * `cookies()` is async in this version of Next, and the returned store
 * is read-only inside a Server Component — writes there throw. The
 * session is refreshed in proxy.ts instead, which is the one place
 * allowed to set them, so the setAll below tolerates failure rather
 * than crashing a page that only wanted to know who was signed in.
 */

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";

export async function supabaseServer() {
  const store = await cookies();

  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) {
            store.set(name, value, options);
          }
        } catch {
          // A Server Component cannot set cookies. Proxy already
          // refreshed the session for this request, so there is
          // nothing lost by letting this go.
        }
      },
    },
  });
}

/** The signed-in user, or null. Uses getUser() rather than getSession()
 *  because only getUser revalidates the token with the auth server —
 *  getSession trusts a cookie the browser could have edited. */
export async function currentUser() {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.getUser();
  return error ? null : data.user;
}
