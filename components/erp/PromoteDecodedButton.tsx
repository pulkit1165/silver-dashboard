"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Promote a decoded slip → an open sales order, or discard it. Both refresh the list.
export default function PromoteDecodedButton({ id }: { id: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"promote" | "discard" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function promote() {
    setBusy("promote"); setErr(null);
    const res = await fetch(`/api/erp/sales/decoded/${id}/promote`, { method: "POST" })
      .then((r) => r.json()).catch(() => ({ ok: false, error: "Network error" }));
    if (!res.ok) { setBusy(null); setErr(res.error ?? "Could not promote"); return; }
    router.push(`/erp/sales/${res.soId}`); // open the new sales order for review + punch
  }

  async function discard() {
    if (!confirm("Discard this decoded order? This cannot be undone.")) return;
    setBusy("discard"); setErr(null);
    const res = await fetch(`/api/erp/sales/decoded/${id}`, { method: "DELETE" })
      .then((r) => r.json()).catch(() => ({ ok: false, error: "Network error" }));
    setBusy(null);
    if (!res.ok) { setErr(res.error ?? "Could not discard"); return; }
    router.refresh();
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button onClick={promote} disabled={!!busy} className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">
        {busy === "promote" ? "Opening…" : "→ Move to open SO"}
      </button>
      <button onClick={discard} disabled={!!busy} className="rounded-lg border border-red-300 px-2.5 py-1.5 text-xs font-bold text-red-600 hover:bg-red-50">
        {busy === "discard" ? "…" : "Discard"}
      </button>
      {err && <span className="text-xs font-semibold text-red-600">{err}</span>}
    </span>
  );
}
