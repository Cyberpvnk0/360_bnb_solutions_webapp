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

/**
 * What went wrong with the setup, in words someone can act on.
 *
 * SERVER ONLY — process.env in the browser holds nothing but the
 * NEXT_PUBLIC_ values Next inlined at build time, so a client-side
 * version of this could never see the variable that was named wrong.
 *
 * The prefix is the point. Next inlines only NEXT_PUBLIC_* into the
 * browser bundle; anything else exists solely in Node. A variable named
 * NEXT_SUPABASE_URL is perfectly readable on the server and simply
 * undefined on the client, so auth fails with no error anywhere — the
 * form posts into a client built with an empty URL.
 */
export function authSetupProblem(): string | null {
  if (authConfigured()) return null;

  const seen = Object.keys(process.env).filter((k) => /SUPABASE/i.test(k));
  const nearMiss = seen.filter((k) => !k.startsWith("NEXT_PUBLIC_"));

  const missing = [
    SUPABASE_URL ? null : "NEXT_PUBLIC_SUPABASE_URL",
    SUPABASE_ANON_KEY ? null : "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  ].filter(Boolean);

  return (
    `Sign-in is not configured: missing ${missing.join(" and ")}. ` +
    (nearMiss.length > 0
      ? `This deployment has ${nearMiss.join(", ")} — the NEXT_PUBLIC_ prefix is not a naming style, it is what tells Next to send the value to the browser. Without it the value exists on the server and is undefined in the sign-in form. Rename, then redeploy. `
      : "") +
    "Environment changes only reach a NEW deployment."
  );
}
