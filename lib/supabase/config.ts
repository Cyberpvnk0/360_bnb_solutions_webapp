/**
 * The public Supabase credentials, for auth only.
 *
 * These are the PUBLISHABLE pair and are meant to reach the browser —
 * unlike SUPABASE_SECRET_KEY, which is the privileged key the caching
 * layer uses server-side and must never be exposed. Two different keys
 * doing two different jobs, and mixing them up is the whole ballgame:
 * the secret one in a browser bundle hands every visitor full database
 * access.
 *
 * Row-level security is what makes the publishable key safe. Every
 * user table below carries a policy tying rows to auth.uid(), so this
 * key can only ever read and write the signed-in person's own data.
 */

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "";

/** Whether auth can work at all. Checked before rendering a sign-in
 *  form that could not possibly succeed. */
export function authConfigured(): boolean {
  return SUPABASE_URL !== "" && SUPABASE_ANON_KEY !== "";
}

/** Names only — for the setup diagnostic, never values. */
export function authEnvSeen(): string[] {
  return Object.keys(process.env)
    .filter((k) => /^NEXT_PUBLIC_SUPABASE/i.test(k))
    .sort();
}
