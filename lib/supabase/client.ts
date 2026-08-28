"use client";

/**
 * The browser's Supabase client, for auth.
 *
 * One instance per tab: the client keeps the session in memory and
 * refreshes it on a timer, and making a second one gives you two
 * refresh loops racing to use the same rotating token.
 */

import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";

let client: ReturnType<typeof createBrowserClient> | null = null;

export function supabaseBrowser() {
  client ??= createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return client;
}
