"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function GenerateIndentButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function generate() {
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/erp/purchase/quotations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "generateIndent" }) });
      const d = await r.json();
      if (d.ok) router.push(`/erp/purchase/indents/${d.id}`);
      else setMsg(d.error || "Failed");
    } catch (e) { setMsg(String(e)); } finally { setBusy(false); }
  }

  return (
    <div className="mb-4 flex items-center gap-3">
      <button onClick={generate} disabled={busy} className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50">
        {busy ? "Analyzing sales & stock…" : "+ Generate today's indent"}
      </button>
      <span className="text-xs text-[var(--muted)]">Suggests what to reorder from sales velocity + current stock cover.</span>
      {msg && <span className="text-xs font-bold text-[var(--danger)]">{msg}</span>}
    </div>
  );
}
