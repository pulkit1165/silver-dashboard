// Client-only helper (no "server-only" import — used directly from "use client"
// components). Captures the browser's geolocation and best-effort logs it via
// POST /api/erp/location. Always fire-and-forget: a denied permission, an
// unsupported browser, or a network error must never block the login/scan the
// call rides along with — that's why nothing here is awaited by callers.
import type { LocationSource } from "./deviceLocations";

const DEVICE_ID_KEY = "erp_device_id";

export function getDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = (crypto.randomUUID?.() ?? `dev-${Date.now()}-${Math.random().toString(16).slice(2)}`);
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    return "unknown";
  }
}

export function pingLocation(source: LocationSource): void {
  try {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const body = JSON.stringify({
          source, deviceId: getDeviceId(),
          lat: pos.coords.latitude, lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
        fetch("/api/erp/location", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => {});
      },
      () => { /* permission denied / position unavailable — silently skip */ },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 },
    );
  } catch { /* geolocation not supported in this context — skip */ }
}
