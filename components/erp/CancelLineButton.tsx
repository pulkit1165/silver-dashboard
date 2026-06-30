"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Formal write-off of a shortfall on one order line — legacy Cancellation
// slip (DTC107) equivalent. Click to open a small inline qty+reason form.
export default function CancelLineButton({ soLineId, remaining, skuCode }: { soLineId: number; remaining: number; skuCode: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState(remaining);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (remaining <= 0) return null;

  async function go() {
    if (!reason.trim()) { setErr("A reason is required."); return; }
    setBusy(true); setErr(null);
    const res = await fetch(`/api/erp/so-lines/${soLineId}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ qty, reason }),
    }).then((r) => r.json()).catch(() => ({ ok: false, error: "Network error" }));
    setBusy(false);
    if (!res.ok) { setErr(res.error ?? "Could not cancel"); return; }
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => { setOpen(true); setQty(remaining); setErr(null); }}
        className="text-[10px] font-semibold uppercase text-[var(--danger)] hover:underline"
        title={`Write off ${skuCode} as unfulfillable`}
      >
        Cancel
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1 rounded-lg border border-[var(--danger)] bg-[var(--danger-bg)] p-2 text-xs">
      <div className="flex items-center gap-1">
        <input
          type="number" min={1} max={remaining} value={qty}
          onChange={(e) => setQty(Number(e.target.value) || 0)}
          className="w-16 rounded border border-[var(--border)] px-1 py-0.5"
        />
        <span className="text-[var(--muted)]">of {remaining}</span>
      </div>
      <input
        value={reason} onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (e.g. out of stock)"
        className="rounded border border-[var(--border)] px-1 py-0.5"
      />
      {err && <span className="font-semibold text-[var(--danger)]">{err}</span>}
      <div className="flex items-center gap-1">
        <button type="button" disabled={busy} onClick={go} className="rounded bg-[var(--danger)] px-2 py-0.5 font-bold text-white disabled:opacity-60">
          {busy ? "…" : "Confirm"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded border border-[var(--border)] px-2 py-0.5 font-bold">
          Cancel
        </button>
      </div>
    </div>
  );
}
