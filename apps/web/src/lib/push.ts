/**
 * The weekly diary reminder as a phone notification (Web Push). The reader turns it on in Study → Diary; the browser
 * gives an address for this device, kept in push_subscriptions (migration 0011, the reader's own rows only). Once a
 * week the diary-reminder function sends a reminder to readers whose diary is due (supabase/functions/diary-reminder).
 * Only that address and the reader's time zone are stored: never anything they wrote.
 *
 * On iPhone, notifications work once Boekenwurm is on the Home Screen (iOS 16.4 or later).
 */
import { getState } from "./store.ts";
import { supabase } from "./supabase.ts";

export const VAPID_PUBLIC_KEY: string = import.meta.env.VITE_VAPID_PUBLIC_KEY ?? "";

export type PushState = "unsupported" | "install-first" | "no-account" | "off-in-build" | "denied" | "off" | "on";

const supported = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
const standalone = () => window.matchMedia?.("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

/** Where this device stands with reminders. */
export async function pushState(): Promise<PushState> {
  if (!VAPID_PUBLIC_KEY || !supabase) return "off-in-build";
  if (!supported()) return isIos() && !standalone() ? "install-first" : "unsupported";
  if (!getState().user) return "no-account";
  if (Notification.permission === "denied") return "denied";
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub ? "on" : "off";
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Turn the weekly reminder on for this device (asks for permission). */
export async function turnOn(): Promise<PushState> {
  if (!supabase) return "off-in-build";
  if ((await Notification.requestPermission()) !== "granted") return "denied";
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) }));
  const j = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  const { error } = await supabase.from("push_subscriptions").upsert(
    { endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Amsterdam" },
    { onConflict: "endpoint" },
  );
  if (error) {
    await sub.unsubscribe();
    throw new Error(error.message);
  }
  return "on";
}

/** Turn it off for this device: the address is removed from the account. */
export async function turnOff(): Promise<PushState> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await supabase?.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
    await sub.unsubscribe();
  }
  return "off";
}
