"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function VerifyGoodsReceipt({ grnId }: { grnId: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function verify() {
    setBusy(true);
    setErr("");
    const r = await fetch(`/api/erp/grn/${grnId}/verify`, { method: "POST" });
    const d = await r.json();
    setBusy(false);
    if (d.ok) router.refresh();
    else setErr(d.error ?? "Failed to verify");
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={verify}
        disabled={busy}
        className="rounded-lg bg-[var(--accent-2)] px-4 py-2 text-sm font-bold text-white hover:opacity-90 disabled:opacity-60"
      >
        {busy ? "Verifying…" : "✓ Verify Goods Receipt"}
      </button>
      <span className="text-xs text-[var(--muted)]">Marks this receipt as vendor-billable.</span>
      {err && <span className="text-xs font-semibold text-[var(--danger)]">{err}</span>}
    </div>
  );
}
