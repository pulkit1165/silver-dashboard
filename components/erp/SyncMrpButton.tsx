"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// "Pull MRPs from Oracle" — fills SKU MRPs from the Oracle label master
// (A_LABELPRINT), versioned & dated. Only-missing keeps any MRP already set.
export default function SyncMrpButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run(onlyMissing: boolean) {
    if (!confirm(onlyMissing
      ? "Fill MRPs from Oracle for items that don't have one yet? Existing MRPs are kept."
      : "Refresh ALL MRPs from Oracle (overwrites current MRPs with the latest Oracle value)? A new dated version is kept for each change."))
      return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/erp/masters/mrp/sync", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ only_missing: onlyMissing }),
      });
      const d = await r.json();
      if (d.ok) { setMsg(`✓ Updated ${d.updated} MRP(s) (${d.matched} matched Oracle).`); router.refresh(); }
      else setMsg(`✕ ${d.error || "Failed"}`);
    } catch { setMsg("✕ Network error"); } finally { setBusy(false); }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button onClick={() => run(true)} disabled={busy}
        className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white hover:bg-[var(--accent-strong)] disabled:opacity-50">
        {busy ? "Pulling…" : "⭳ Pull MRPs from Oracle"}
      </button>
      <button onClick={() => run(false)} disabled={busy}
        className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-bold hover:bg-[var(--surface-2)] disabled:opacity-50"
        title="Overwrite all MRPs with the latest Oracle value (keeps history)">
        Refresh all
      </button>
      {msg && <span className={`text-xs font-bold ${msg.startsWith("✓") ? "text-[var(--accent-2)]" : "text-[var(--danger)]"}`}>{msg}</span>}
    </div>
  );
}
