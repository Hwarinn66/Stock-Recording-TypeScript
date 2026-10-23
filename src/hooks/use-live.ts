"use client";
import { useSyncExternalStore } from "react";
// Satu sumber update per tab dipakai bersama oleh semua komponen. Browser membatasi
// ±6 koneksi HTTP/1.1 per host; koneksi SSE ganda per halaman cepat menghabiskannya.
// Di Vercel koneksi yang terbuka terus dihitung sebagai jam server, jadi build Vercel
// memakai cek berkala setiap LIVE_POLL_SECONDS detik (lihat next.config.ts).
export const livePollSeconds = Number(process.env.LIVE_POLL_SECONDS) || 0;
type Live = { version: number; connected: boolean };
const offline: Live = { version: 0, connected: false };
let snapshot = offline;
const listeners = new Set<() => void>();
let events: EventSource | null = null;
let fallback: ReturnType<typeof setInterval> | undefined;
let closing: ReturnType<typeof setTimeout> | undefined;
let polling = false;
let checking = false;
let poller: ReturnType<typeof setTimeout> | undefined;
let revision = "";
function emit(next: Partial<Live>) {
  snapshot = { ...snapshot, ...next };
  listeners.forEach((listener) => listener());
}
function openStream() {
  events = new EventSource("/api/events");
  events.onopen = () => emit({ connected: true });
  events.addEventListener("update", () =>
    emit({ connected: true, version: snapshot.version + 1 }),
  );
  events.addEventListener("expired", () => {
    location.href = "/login";
  });
  events.addEventListener("retrying", () => emit({ connected: false }));
  events.onerror = () => emit({ connected: false });
  fallback = setInterval(() => {
    if (!snapshot.connected) emit({ version: snapshot.version + 1 });
  }, 5000);
}
async function poll() {
  if (checking) return;
  clearTimeout(poller);
  checking = true;
  try {
    // Tab tersembunyi tidak dicek; saat terlihat lagi langsung dicek (onVisible).
    if (document.visibilityState !== "visible") return;
    const response = await fetch("/api/events?poll=1", {
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (response.status === 401) {
      polling = false;
      location.href = "/login";
      return;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const { data } = (await response.json()) as { data: { revision: string } };
    const known = revision;
    revision = data.revision;
    // Muat ulang data bila stok berubah, atau setelah sempat terputus.
    const stale = known !== "" && (known !== revision || !snapshot.connected);
    emit({ connected: true, version: snapshot.version + (stale ? 1 : 0) });
  } catch {
    emit({ connected: false });
  } finally {
    checking = false;
    if (polling) poller = setTimeout(poll, livePollSeconds * 1000);
  }
}
function onVisible() {
  if (polling && document.visibilityState === "visible") void poll();
}
function open() {
  if (!livePollSeconds) return openStream();
  polling = true;
  document.addEventListener("visibilitychange", onVisible);
  void poll();
}
function close() {
  events?.close();
  events = null;
  clearInterval(fallback);
  polling = false;
  clearTimeout(poller);
  document.removeEventListener("visibilitychange", onVisible);
  snapshot = { ...snapshot, connected: false };
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  clearTimeout(closing);
  if (!events && !polling) open();
  return () => {
    listeners.delete(listener);
    // Tunda penutupan agar pindah halaman tidak memutus lalu membuka ulang koneksi.
    if (!listeners.size)
      closing = setTimeout(() => {
        if (!listeners.size) close();
      }, 1000);
  };
}
export function useLive() {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => offline,
  );
}
