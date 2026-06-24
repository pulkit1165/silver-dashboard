"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Creates a draft invoice from a sales order's dispatched-but-uninvoiced qty,
// then opens it. Usable from the SO detail screen or a packing slip.
export default function GenerateInvoiceButton({
  soId,
  soNo,
  packingSlipId,
  label = "🧾 Generate invoice",
}: {
  soId?: number;
  soNo?: string;
  packingSlipId?: number;
  label?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function go() {
    setBusy(true); setErr(null);
    const res = await fetch("/api/erp/invoices", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ soId, soNo, packingSlipId }),
    }).then((r) => r.json()).catch(() => ({ ok: false, error: "Network error" }));
    if (!res.ok) { setBusy(false); setErr(res.error ?? "Could not create invoice"); return; }
    router.push(`/erp/invoices/${res.id}`);
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        onClick={go}
        disabled={busy}
        className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-bold text-white disabled:opacity-50"
      >
        {busy ? "Creating…" : label}
      </button>
      {err && <span className="text-xs font-semibold text-red-600">{err}</span>}
    </span>
  );
}
