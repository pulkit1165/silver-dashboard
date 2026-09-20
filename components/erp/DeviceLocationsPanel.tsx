"use client";

import { useMemo, useState } from "react";
import type { DeviceLocationRow } from "@/lib/erp/deviceLocations";

const SOURCE_LABEL: Record<string, string> = { login: "Login", scan: "Scan", ping: "Heartbeat" };

function mapUrl(lat: number, lng: number) {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

export default function DeviceLocationsPanel({
  initialLatest, initialRecent,
}: { initialLatest: DeviceLocationRow[]; initialRecent: DeviceLocationRow[] }) {
  const [latest, setLatest] = useState(initialLatest);
  const [recent, setRecent] = useState(initialRecent);
  const [busy, setBusy] = useState(false);
  const [quick, setQuick] = useState("");

  async function refresh() {
    setBusy(true);
    try {
      const r = await fetch("/api/erp/location", { cache: "no-store" });
      const d = await r.json();
      if (d.ok) { setLatest(d.latest); setRecent(d.recent); }
    } finally { setBusy(false); }
  }

  const filteredRecent = useMemo(() => {
    if (!quick.trim()) return recent;
    const q = quick.trim().toLowerCase();
    return recent.filter((r) => (r.user_name ?? "").toLowerCase().includes(q));
  }, [recent, quick]);

  const inp = "rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 text-sm outline-none focus:border-[var(--accent)]";

  return (
    <div className="flex flex-col gap-4">
      <section className="panel">
        <div className="panel-hd flex items-center justify-between">
          <span>Last known location per device ({latest.length})</span>
          <button onClick={refresh} disabled={busy} className="rounded-lg border border-[var(--border)] bg-white px-3 py-1.5 text-xs font-bold hover:bg-[var(--surface-2)] disabled:opacity-50">{busy ? "Refreshing…" : "↻ Refresh"}</button>
        </div>
        <div className="overflow-x-auto">
          <table className="rtable">
            <thead><tr><th>User</th><th>Role</th><th>Device</th><th>Source</th><th>When</th><th className="!text-right">Accuracy</th><th></th></tr></thead>
            <tbody>
              {latest.map((r) => (
                <tr key={r.id}>
                  <td className="font-semibold">{r.user_name || "—"}</td>
                  <td><span className="tag n">{r.role || "—"}</span></td>
                  <td className="font-mono text-[10px] text-[var(--muted)]">{(r.device_id || "—").slice(0, 12)}</td>
                  <td>{SOURCE_LABEL[r.source] ?? r.source}</td>
                  <td className="text-xs text-[var(--muted)]">{r.created_at}</td>
                  <td className="num-cell">{r.accuracy != null ? `±${Math.round(r.accuracy)}m` : "—"}</td>
                  <td className="text-right"><a href={mapUrl(r.lat, r.lng)} target="_blank" rel="noreferrer" className="text-xs font-bold text-[var(--accent)] hover:underline">View on map ↗</a></td>
                </tr>
              ))}
              {latest.length === 0 && <tr><td colSpan={7} className="!py-6 text-center text-[var(--muted)]">No location data yet — it appears once staff sign in and grant location permission on their device.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-hd flex items-center justify-between">
          <span>Recent log ({filteredRecent.length})</span>
          <input value={quick} onChange={(e) => setQuick(e.target.value)} placeholder="Filter by name…" className={inp} />
        </div>
        <div className="max-h-[420px] overflow-y-auto overflow-x-auto">
          <table className="rtable">
            <thead><tr><th>User</th><th>Source</th><th>When</th><th className="!text-right">Accuracy</th><th></th></tr></thead>
            <tbody>
              {filteredRecent.map((r) => (
                <tr key={r.id}>
                  <td className="font-semibold">{r.user_name || "—"}</td>
                  <td className="text-xs">{SOURCE_LABEL[r.source] ?? r.source}</td>
                  <td className="text-xs text-[var(--muted)]">{r.created_at}</td>
                  <td className="num-cell">{r.accuracy != null ? `±${Math.round(r.accuracy)}m` : "—"}</td>
                  <td className="text-right"><a href={mapUrl(r.lat, r.lng)} target="_blank" rel="noreferrer" className="text-xs font-bold text-[var(--accent)] hover:underline">Map ↗</a></td>
                </tr>
              ))}
              {filteredRecent.length === 0 && <tr><td colSpan={5} className="!py-6 text-center text-[var(--muted)]">No entries match.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
