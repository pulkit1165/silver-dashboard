"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function IndentActions({ indentId, pending, vendors }: { indentId: number; pending: number; vendors: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function generate() {
    if (!confirm(`Generate ${vendors} purchase order(s) for ${pending} line(s)?`)) return;
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/erp/purchase/quotations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "generatePO", indentId }) });
      const d = await r.json();
      if (d.ok) { setMsg(`✓ Created: ${d.pos.map((p: { poNo: string }) => p.poNo).join(", ")}`); router.refresh(); }
      else setMsg(d.error || "Failed");
    } catch (e) { setMsg(String(e)); } finally { setBusy(false); }
  }

  return (
    <div className="panel mb-4 flex flex-wrap items-center gap-3">
      <button onClick={generate} disabled={busy} className="rounded-lg bg-[var(--accent)] px-5 py-2 text-sm font-bold text-white disabled:opacity-50">
        {busy ? "Generating…" : `Generate PO(s) — ${pending} line(s), ${vendors} vendor(s)`}
      </button>
      <span className="text-xs text-[var(--muted)]">One PO per vendor; drafts appear in <a href="/erp/purchase" className="text-[var(--accent)] underline">Purchase Orders</a>.</span>
      {msg && <span className="text-sm font-bold text-[var(--accent-2)]">{msg}</span>}
    </div>
  );
}
