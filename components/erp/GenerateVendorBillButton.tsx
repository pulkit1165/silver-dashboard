"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function GenerateVendorBillButton({ poId, label = "🧾 Bill now" }: { poId: number; label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function go() {
    setBusy(true); setErr(null);
    const res = await fetch("/api/erp/vendor-bills", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ poId }),
    }).then((r) => r.json()).catch(() => ({ ok: false, error: "Network error" }));
    if (!res.ok) { setBusy(false); setErr(res.error ?? "Could not create vendor bill"); return; }
    router.refresh();
    setBusy(false);
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
