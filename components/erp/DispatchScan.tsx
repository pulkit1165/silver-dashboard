"use client";

import { useState } from "react";
import Scanner from "./Scanner";

type Line = {
  id: number; sku_id: number; sku_code?: string; sku_name?: string; qr_token?: string;
  qty: number; picked_qty: number; packed_qty: number; dispatched_qty: number;
};
type Order = {
  id: number; so_no: string; customer_name?: string; status: string; invoice_no: string | null; lines: Line[];
};
type LogEntry = { ts: string; ok: boolean; text: string };

export default function DispatchScan({ orders }: { orders: Order[] }) {
  const [orderId, setOrderId] = useState<number | null>(orders[0]?.id ?? null);
  const [order, setOrder] = useState<Order | null>(orders[0] ?? null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [busy, setBusy] = useState(false);

  function selectOrder(id: number) {
    setOrderId(id);
    setOrder(orders.find((o) => o.id === id) ?? null);
    setLog([]);
  }

  async function refresh(id: number) {
    const r = await fetch(`/api/erp/sales-orders/${id}`);
    const d = await r.json();
    if (d.ok) setOrder(d.order);
  }

  async function onDetect(code: string) {
    if (!order) return;
    setBusy(true);
    try {
      const r = await fetch("/api/erp/scan/action", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, action: "dispatch", refDoc: order.so_no, qty: 1, device: "dispatch" }),
      });
      const d = await r.json();
      const stamp = new Date().toLocaleTimeString();
      if (d.ok) {
        setLog((l) => [{ ts: stamp, ok: true, text: `${d.sku?.sku_code ?? "item"} → ${d.message}` }, ...l].slice(0, 40));
        await refresh(order.id);
      } else {
        if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(180);
        setLog((l) => [{ ts: stamp, ok: false, text: d.error ?? "Rejected" }, ...l].slice(0, 40));
      }
    } finally {
      setBusy(false);
    }
  }

  const done = order?.lines.every((l) => l.dispatched_qty >= l.qty);

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <section className="panel">
        <div className="panel-hd">Scan to dispatch</div>
        <div className="p-4">
          <label className="mb-3 flex flex-col gap-1 text-xs font-semibold text-[var(--muted)]">
            Sales order
            <select
              value={orderId ?? ""}
              onChange={(e) => selectOrder(Number(e.target.value))}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
            >
              {orders.length === 0 && <option>No orders ready for dispatch</option>}
              {orders.map((o) => (
                <option key={o.id} value={o.id}>{o.so_no} — {o.customer_name} ({o.status})</option>
              ))}
            </select>
          </label>
          {order && <Scanner onDetect={onDetect} continuous />}
          {busy && <p className="mt-2 text-xs text-[var(--muted)]">Processing scan…</p>}
        </div>
      </section>

      <section className="panel">
        <div className="panel-hd">{order ? `${order.so_no} · ${order.customer_name}` : "Order"}</div>
        <div className="p-4">
          {done && (
            <div className="mb-3 rounded-xl border px-4 py-3 text-sm font-extrabold"
              style={{ borderColor: "var(--accent-2)", background: "var(--accent-2-bg)", color: "var(--accent-2)" }}>
              ✓ All items dispatched — order complete
            </div>
          )}
          <table className="rtable">
            <thead>
              <tr><th>SKU</th><th className="!text-right">Ordered</th><th className="!text-right">Dispatched</th><th className="!text-right">Progress</th></tr>
            </thead>
            <tbody>
              {order?.lines.map((l) => {
                const pct = Math.min(100, Math.round((l.dispatched_qty / l.qty) * 100));
                return (
                  <tr key={l.id}>
                    <td><div className="font-semibold">{l.sku_name}</div><div className="font-mono text-xs text-[var(--muted)]">{l.sku_code}</div></td>
                    <td className="num-cell">{l.qty}</td>
                    <td className="num-cell">{l.dispatched_qty}</td>
                    <td className="num-cell">
                      <div className="flex items-center justify-end gap-2">
                        <div className="h-2 w-16 overflow-hidden rounded-full bg-[var(--surface-2)]">
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: pct >= 100 ? "var(--accent-2)" : "var(--accent)" }} />
                        </div>
                        <span className="w-9 text-right tabular-nums">{pct}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="mt-4">
            <div className="mb-2 text-xs font-extrabold uppercase tracking-wide text-[var(--muted)]">Scan log</div>
            <div className="flex max-h-64 flex-col gap-1 overflow-auto">
              {log.length === 0 && <p className="text-sm text-[var(--muted)]">Scan items to see results here.</p>}
              {log.map((e, i) => (
                <div key={i} className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm"
                  style={{ background: e.ok ? "var(--accent-2-bg)" : "var(--danger-bg)", color: e.ok ? "var(--accent-2)" : "var(--danger)" }}>
                  <span className="font-bold">{e.ok ? "✓" : "✕"}</span>
                  <span className="flex-1 font-medium">{e.text}</span>
                  <span className="text-[10px] opacity-70">{e.ts}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
