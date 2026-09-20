"use client";

import { useEffect } from "react";
import { pingLocation } from "@/lib/erp/deviceLocationClient";

// Periodic "device is still here" location heartbeat while the ERP stays open
// in the foreground — same visibility-aware setTimeout pattern as LiveSync.tsx.
// A backgrounded tab is never pinged (battery), and there's no way for a
// browser to report location once the app is fully closed — see
// lib/erp/deviceLocationClient.ts for the fire-and-forget capture itself.
//
// This mounts fresh on every full page load of the authenticated app (the
// login form does a full `window.location.href` redirect, not a client-side
// route change) — so firing once immediately on mount, tagged "login", is the
// reliable way to capture "location at login" without racing that redirect.
const PING_INTERVAL_MS = 5 * 60 * 1000;

export default function LocationPing() {
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = () => {
      if (!document.hidden) pingLocation("ping");
      if (!stopped) timer = setTimeout(tick, PING_INTERVAL_MS);
    };
    pingLocation("login");
    timer = setTimeout(tick, PING_INTERVAL_MS);

    const onVis = () => {
      // Coming back to a tab that's been hidden for a while — catch up now
      // rather than waiting out the rest of the interval.
      if (!document.hidden) { clearTimeout(timer); tick(); }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => { stopped = true; clearTimeout(timer); document.removeEventListener("visibilitychange", onVis); };
  }, []);

  return null;
}
