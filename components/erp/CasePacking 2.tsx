"use client";

import { useState } from "react";
import Scanner from "./Scanner";
import type { OrderPacking, PackingLine } from "@/lib/erp/types";

type OrderOpt = { id: number; so_no: string; customer_name?: string; status: string };
type LogEntry = { ts: string; ok: boolean; text: string };
type Pending = { code: string; line: PackingLine; qty: number };

export default function CasePacking({
  orders,
  initial,
}: {
  orders: OrderOpt[];
  initial: OrderPacking | null;
}) {
  const [orderId, setOrderId] = useState<number | null>(initial?.id ?? orders[0]?.id ?? null);
  const [packing, setPacking] = useState<OrderPacking | null>(initial);
  const [caseNo, setCaseNo] = useState("1");
  const [pending, setPending] = useState<Pending | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [busy, setBusy] = useState(false);

  function pushLog(ok: boolean, text: string) {
    setLog((l) => [{ ts: new Date().toLocaleTimeString(), ok, text }, ...l].slice(0, 50));
    if (!ok && typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(180);
  }

  async function loadPacking(id: number) {
    const r = await fetch(`/api/erp/packing/${id}`);
    const d = await r.json();
    if (d.ok) setPacking(d.packing);
    return d.ok ? (d.packing as OrderPacking) : null;
  }

  async function selectOrder(id: number) {
    setOrderId(id);
    setPending(null);
    setLog([]);
    setPacking(null);
    await loadPacking(id);
  }

  function onDetect(raw: string) {
    const code = raw.trim();
    if (!packing) return;
    if (!caseNo.trim()) return pushLog(false, "Enter a case number first.");
    const line = packing.lines.find((l) => l.qr_token === code || code.includes(l.qr_token));
    if (!line) return pushLog(false, "Scanned item is not on this order.");
    if (line.remaining <= 0) return pushLog(false, `${line.sku_code} is already fully packed.`);
    setPending({ code, line, qty: line.remaining });
  }

  async function packPending() {
    if (!pending || !packing || !caseNo.trim()) return;
    const qty = Number(pending.qty);
    if (!Number.isFinite(qty) || qty <= 0) return pushLog(false, "Enter a valid quantity.");
    setBusy(true);
    try {
      const r = await fetch("/api/erp/scan/action", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code: pending.code,
          action: "pack_case",
          refDoc: packing.so_no,
          packageNo: caseNo.trim(),
          qty,
          device: "packing",
        }),
      });
      const d = await r.json();
      if (d.ok) {
        pushLog(true, d.message ?? `Packed ${qty} ${pending.line.sku_code} into Case ${caseNo.trim()}`);
        setPending(null);
        await loadPacking(packing.id);
      } else {
        pushLog(false, d.error ?? "Rejected");
      }
    } finally {
      setBusy(false);
    }
  }

  const allPacked = !!packing && packing.lines.length > 0 && packing.lines.every((l) => l.remaining <= 0);

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      {/* LEFT — pick order, set case, scan, set qty */}
      <section className="panel">
        <div className="panel-hd">Pack into case</div>
        <div className="flex flex-col gap-3 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
            <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--muted)]">
              Sales order
              <select
                value={orderId ?? ""}
                onChange={(e) => selectOrder(Number(e.target.value))}
                className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
              >
                {orders.length === 0 && <option>No orders ready for dispatch</option>}
                {orders.map((o) => (
                  <option key={o.id} value={o.id}>{o.so_no} — {o.customer_name} ({o.status})</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--muted)]">
              Case no
              <input
                value={caseNo}
                onChange={(e) => setCaseNo(e.target.value)}
                placeholder="1"
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-bold outline-none focus:border-[var(--accent)] sm:w-28"
              />
            </label>
          </div>

          {!caseNo.trim() && (
            <p className="rounded-lg px-3 py-2 text-xs font-semibold"
              style={{ background: "var(--danger-bg)", color: "var(--danger)" }}>
              Enter a case number before scanning.
            </p>
          )}

          {packing && <Scanner onDetect={onDetect} continuous />}

          {/* pending scan — confirm qty into the case */}
          {pending && (
            <div className="rounded-xl border border-[var(--accent)] bg-[var(--surface)] p-3">
              <div className="text-sm font-bold">{pending.line.sku_name}</div>
              <div className="font-mono text-xs text-[var(--muted)]">{pending.line.sku_code}</div>
              <div className="mt-1 text-xs text-[var(--muted)]">
                Remaining to pack: <b className="text-[var(--ink,inherit)]">{pending.line.remaining}</b>
                {" · "}On hand: {pending.line.on_hand}
              </div>
              <div className="mt-3 flex items-end gap-2">
                <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--muted)]">
                  Qty packed in Case {caseNo.trim()}
                  <input
                    type="number"
                    min={1}
                    max={pending.line.remaining}
                    value={pending.qty}
                    onChange={(e) => setPending({ ...pending, qty: Number(e.target.value) })}
                    autoFocus
                    className="w-28 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-bold outline-none focus:border-[var(--accent)]"
                  />
                </label>
                <button
                  onClick={packPending}
                  disabled={busy}
                  className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white hover:bg-[var(--accent-strong)] disabled:opacity-60"
                >
                  {busy ? "Packing…" : `Pack into Case ${caseNo.trim()}`}
                </button>
                <button
                  onClick={() => setPending(null)}
                  className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-semibold text-[var(--muted)] hover:bg-[var(--surface-2)]"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* scan log */}
          <div>
            <div className="mb-2 text-xs font-extrabold uppercase tracking-wide text-[var(--muted)]">Activity</div>
            <div className="flex max-h-48 flex-col gap-1 overflow-auto">
              {log.length === 0 && <p className="text-sm text-[var(--muted)]">Scan an item to pack it into the chosen case.</p>}
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

      {/* RIGHT — packed cases + what's left */}
      <section className="panel">
        <div className="panel-hd">{packing ? `${packing.so_no} · ${packing.customer_name}` : "Order"}</div>
        <div className="p-4">
          {allPacked && (
            <div className="mb-3 rounded-xl border px-4 py-3 text-sm font-extrabold"
              style={{ borderColor: "var(--accent-2)", background: "var(--accent-2-bg)", color: "var(--accent-2)" }}>
              ✓ Everything packed — order ready for dispatch
            </div>
          )}

          {/* remaining to pack */}
          <div className="mb-2 text-xs font-extrabold uppercase tracking-wide text-[var(--muted)]">Remaining to pack</div>
          <table className="rtable">
            <thead>
              <tr><th>Item</th><th className="!text-right">Ordered</th><th className="!text-right">Packed</th><th className="!text-right">Left</th></tr>
            </thead>
            <tbody>
              {!packing && <tr><td colSpan={4} className="!py-6 text-center text-[var(--muted)]">Select an order.</td></tr>}
              {packing?.lines.map((l) => (
                <tr key={l.so_line_id} style={l.remaining <= 0 ? { opacity: 0.5 } : undefined}>
                  <td><div className="font-semibold">{l.sku_name}</div><div className="font-mono text-xs text-[var(--muted)]">{l.sku_code}</div></td>
                  <td className="num-cell">{l.ordered}</td>
                  <td className="num-cell">{l.packed}</td>
                  <td className="num-cell font-bold" style={{ color: l.remaining > 0 ? "var(--accent)" : "var(--accent-2)" }}>
                    {l.remaining > 0 ? l.remaining : "✓"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* packed cases */}
          <div className="mt-5 mb-2 text-xs font-extrabold uppercase tracking-wide text-[var(--muted)]">
            Packed cases {packing && packing.cases.length > 0 ? `(${packing.cases.length})` : ""}
          </div>
          {packing && packing.cases.length === 0 && <p className="text-sm text-[var(--muted)]">No cases packed yet.</p>}
          <div className="flex flex-col gap-3">
            {packing?.cases.map((c) => (
              <div key={c.package_id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-extrabold">Case {c.case_no}</span>
                  <span className="text-xs font-semibold text-[var(--muted)]">{c.total_qty} pcs · {c.items.length} item(s)</span>
                </div>
                <div className="flex flex-col gap-1">
                  {c.items.map((it, i) => (
                    <div key={i} className="flex items-center justify-between text-sm">
                      <span><span className="font-mono text-xs text-[var(--muted)]">{it.sku_code}</span> {it.sku_name}</span>
                      <span className="font-bold tabular-nums">×{it.qty}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
