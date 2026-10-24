/**
 * Sign-in by access code: one code, no email, no password.
 *
 * Built for counsel's audit — a person who needs the whole product,
 * admin panel included, without setting up an account. The code opens
 * a dedicated account (lib/auth/access-account) that the server marks
 * as an admin in its app_metadata, which only the secret key can write.
 *
 * WHAT THE CODE IS WORTH. Whoever holds it holds a full admin: every
 * member's account, every figure, every control. So:
 *
 *   - The code itself is not in this repository. What is here is a
 *     salted scrypt hash of it, and the code carries about 79 bits of
 *     randomness, so the hash cannot be walked back to it.
 *   - ADMIN_ACCESS_CODE, when set, REPLACES the built-in code. Changing
 *     the code is a variable in the deployment, not a release.
 *   - ACCESS_CODE_LOGIN=off turns the whole thing off, and also strips
 *     admin from sessions the code already opened (lib/auth/gate reads
 *     accessCodeEnabled on every request).
 *   - Attempts are throttled per address, so the code cannot be guessed
 *     by hammering the form.
 *
 * Typing is forgiving: case, spaces and dashes are ignored.
 *
 * Server only.
 */

import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

/** The built-in code's hash. The code is in the owner's hands, not here. */
const BUILT_IN = {
  salt: "ddd2375c5da7eccdffe3e8682b529625",
  hash: "04f46a005e7f0081e8eab92e95f8c1930c79c712af73574023991a8d86442e93",
};

const SCRYPT: ScryptOptions = { N: 16384, r: 8, p: 1 };
const KEY_LEN = 32;

/** The app_metadata flag that marks the access-code account an admin.
 *  Only the secret key can write app_metadata. */
export const ACCESS_ROLE_KEY = "aircore_role";
export const ACCESS_ROLE = "admin";

/** On unless the deployment says ACCESS_CODE_LOGIN=off (or false / 0). */
export function accessCodeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.ACCESS_CODE_LOGIN?.trim().toLowerCase();
  return !(raw === "off" || raw === "false" || raw === "0");
}

/** "abcd-EFGH ijkl" → "ABCDEFGHIJKL": what a person types, made comparable. */
export function normaliseCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function scrypt(value: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(value, salt, KEY_LEN, SCRYPT, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/**
 * Does this input open the door?
 *
 * Always runs the hash, even for an empty or absurd input, so a wrong
 * answer takes as long as a right one.
 */
export async function codeMatches(
  input: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<boolean> {
  if (!accessCodeEnabled(env)) return false;
  const given = normaliseCode(input.slice(0, 200));
  const custom = env.ADMIN_ACCESS_CODE?.trim();

  if (custom) {
    // A deployment-set code is hashed on the spot with a throwaway salt,
    // so both sides go through the same constant-time comparison.
    const salt = randomBytes(16);
    const [a, b] = await Promise.all([scrypt(given, salt), scrypt(normaliseCode(custom), salt)]);
    return given.length > 0 && timingSafeEqual(a, b);
  }

  const key = await scrypt(given, Buffer.from(BUILT_IN.salt, "hex"));
  return given.length > 0 && timingSafeEqual(key, Buffer.from(BUILT_IN.hash, "hex"));
}

/* ------------------------------------------------------------------ */
/* Throttle                                                            */
/* ------------------------------------------------------------------ */

const WINDOW_MS = 10 * 60 * 1000;
export const MAX_ATTEMPTS = 8;

const attempts = new Map<string, number[]>();

/**
 * May this caller try again? Counts every attempt, right or wrong.
 *
 * Per server instance, so it is a brake rather than a lock — but the
 * code's length is the lock, and this only has to make guessing slow.
 */
export function allowAttempt(caller: string, now: number = Date.now()): boolean {
  const recent = (attempts.get(caller) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_ATTEMPTS) {
    attempts.set(caller, recent);
    return false;
  }
  recent.push(now);
  attempts.set(caller, recent);
  if (attempts.size > 5_000) {
    for (const [k, v] of attempts) if (v.every((t) => now - t >= WINDOW_MS)) attempts.delete(k);
  }
  return true;
}

/** Test seam. */
export function resetAttemptsForTests(): void {
  attempts.clear();
}
