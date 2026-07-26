"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Hands a draft/open order to the warehouse — only after this does it appear in
// the packing queue / dispatch screen. label lets an "open" (promoted-from-decode)
// order show "Punch order" instead of the plain draft "Confirm".
export default function ConfirmOrderButton({ soId, label }: { soId: number; label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function go() {
    setBusy(true); setErr(null);
    const res = await fetch(`/api/erp/sales-orders/${soId}/confirm`, { method: "POST" })
      .then((r) => r.json())
      .catch(() => ({ ok: false, error: "Network error" }));
    setBusy(false);
    if (!res.ok) { setErr(res.error ?? "Could not confirm order"); return; }
    router.refresh();
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        onClick={go}
        disabled={busy}
        className="rounded-lg bg-[var(--accent-2)] px-3 py-1.5 text-sm font-bold text-white disabled:opacity-50"
      >
        {busy ? "Confirming…" : (label ?? "✓ Confirm order — send to packing")}
      </button>
      {err && <span className="text-xs font-semibold text-red-600">{err}</span>}
    </span>
  );
}
