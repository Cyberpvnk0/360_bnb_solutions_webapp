/**
 * The browser's side of push: the service worker registered, the
 * person asked, the subscription made and handed back to be stored.
 * Server-only knowledge (the private key) never comes near this file;
 * the public key is the one thing it needs, and it is public.
 */

export type PushRefusal = "unsupported" | "denied" | "failed";

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

function keyBytes(base64Url: string): Uint8Array {
  const padded = base64Url.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (base64Url.length % 4)) % 4);
  const raw = window.atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export async function subscribeToPush(
  publicKey: string
): Promise<{ ok: true; subscription: { endpoint: string; keys: { p256dh: string; auth: string } } } | { ok: false; reason: PushRefusal }> {
  if (!pushSupported()) return { ok: false, reason: "unsupported" };
  try {
    const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return { ok: false, reason: "denied" };
    const existing = await registration.pushManager.getSubscription();
    const sub =
      existing ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes(publicKey) as BufferSource,
      }));
    const json = sub.toJSON();
    const p256dh = json.keys?.p256dh;
    const auth = json.keys?.auth;
    if (!json.endpoint || !p256dh || !auth) return { ok: false, reason: "failed" };
    return { ok: true, subscription: { endpoint: json.endpoint, keys: { p256dh, auth } } };
  } catch {
    return { ok: false, reason: "failed" };
  }
}
