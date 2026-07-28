"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Editable logistics + notes card on the order detail page (Shopify-style):
// transporter allocated, tracking id, and order notes — saved via PATCH.
export default function OrderMetaEditor({
  soId, transporter, trackingId, notes, editable,
}: {
  soId: number; transporter: string; trackingId: string; notes: string; editable: boolean;
}) {
  const router = useRouter();
  const [tp, setTp] = useState(transporter);
  const [tk, setTk] = useState(trackingId);
  const [nt, setNt] = useState(notes);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const dirty = tp !== transporter || tk !== trackingId || nt !== notes;

  async function save() {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`/api/erp/sales-orders/${soId}`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ transporter: tp, tracking_id: tk, remarks: nt }),
      });
      const d = await r.json();
      if (d.ok) { setMsg("Saved ✓"); router.refresh(); setTimeout(() => setMsg(null), 2000); }
      else setMsg(d.error || "Failed");
    } catch { setMsg("Network error"); } finally { setBusy(false); }
  }

  const label = "text-[10px] font-bold uppercase tracking-wide text-[var(--muted-2)]";
  const inp = "mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)] disabled:opacity-60";

  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className={label}>Transporter allocated</div>
        <input className={inp} value={tp} onChange={(e) => setTp(e.target.value)} placeholder="e.g. Perfect Roadlines" disabled={!editable} />
      </div>
      <div>
        <div className={label}>Tracking / LR id</div>
        <input className={inp} value={tk} onChange={(e) => setTk(e.target.value)} placeholder="e.g. LR-48213" disabled={!editable} />
      </div>
      <div>
        <div className={label}>Notes</div>
        <textarea className={`${inp} h-20 resize-y`} value={nt} onChange={(e) => setNt(e.target.value)} placeholder="Internal notes for this order…" disabled={!editable} />
      </div>
      {editable && (
        <div className="flex items-center gap-3">
          <button onClick={save} disabled={busy || !dirty}
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white hover:bg-[var(--accent-strong)] disabled:opacity-50">
            {busy ? "Saving…" : "Save"}
          </button>
          {msg && <span className={`text-xs font-bold ${msg.includes("✓") ? "text-[var(--accent-2)]" : "text-[var(--danger)]"}`}>{msg}</span>}
        </div>
      )}
    </div>
  );
}
