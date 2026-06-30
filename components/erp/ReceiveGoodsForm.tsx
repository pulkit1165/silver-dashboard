"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PoLine } from "@/lib/erp/types";

type WH = { id: number; code: string; name: string };

export default function ReceiveGoodsForm({ poId, lines, warehouses }: { poId: number; lines: PoLine[]; warehouses: WH[] }) {
  const router = useRouter();
  const [whId, setWhId] = useState<number>(warehouses[0]?.id ?? 0);
  const [qty, setQty] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  function setLineQty(lineId: number, v: string) {
    setQty((q) => ({ ...q, [lineId]: v }));
  }

  async function receive() {
    setErr("");
    const payload = lines
      .map((l) => ({ poLineId: l.id, skuId: l.sku_id, qty: Number(qty[l.id] || 0) }))
      .filter((l) => l.qty > 0);
    if (payload.length === 0) { setErr("Enter a qty for at least one line."); return; }
    setBusy(true);
    const r = await fetch(`/api/erp/purchase/${poId}/receive`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ warehouseId: whId, lines: payload }),
    });
    const d = await r.json();
    setBusy(false);
    if (d.ok) { setQty({}); router.refresh(); }
    else setErr(d.error ?? "Failed to receive goods");
  }

  return (
    <section className="panel">
      <div className="panel-hd">Receive goods</div>
      <div className="flex flex-col gap-3 p-4">
        <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--muted)] sm:w-64">
          Warehouse
          <select value={whId} onChange={(e) => setWhId(Number(e.target.value))}
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]">
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
          </select>
        </label>
        <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
          <table className="rtable">
            <thead><tr><th>SKU</th><th className="!text-right">Remaining</th><th className="!text-right">Qty received now</th></tr></thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id}>
                  <td><div className="font-semibold">{l.sku_name}</div><div className="font-mono text-xs text-[var(--muted)]">{l.sku_code}</div></td>
                  <td className="num-cell">{l.remaining}</td>
                  <td className="num-cell">
                    <input type="number" min={0} max={l.remaining} value={qty[l.id] ?? ""} onChange={(e) => setLineQty(l.id, e.target.value)}
                      placeholder="0" className="w-28 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm text-right outline-none focus:border-[var(--accent)]" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={receive} disabled={busy} className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white hover:bg-[var(--accent-strong)] disabled:opacity-60">
            {busy ? "Receiving…" : "✓ Receive goods"}
          </button>
          <span className="text-xs text-[var(--muted)]">Adds stock immediately and creates a GRN pending verification.</span>
          {err && <span className="text-xs font-semibold text-[var(--danger)]">{err}</span>}
        </div>
      </div>
    </section>
  );
}
