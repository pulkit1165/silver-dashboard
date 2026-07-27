"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

type Customer = { id: number; code: string | null; name: string | null };
type Salesman = { id: number; name: string; territory: string };
type Sku = { id: number; sku_code: string; name: string; price: number; stdPack: number };
type Line = { key: number; sku: Sku; qty: number };

const inr = (n: number) => (n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
let keySeq = 1;

export default function ManualOrderBuilder({
  customers, salesmen, defaultSalesman,
}: {
  customers: Customer[];
  salesmen: Salesman[];
  defaultSalesman: string;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [step, setStep] = useState<"build" | "review" | "done">("build");

  const [customerId, setCustomerId] = useState<number | "">("");
  const [salesmanName, setSalesmanName] = useState(defaultSalesman ?? "");
  const [orderDate, setOrderDate] = useState(today);
  const [requiredBy, setRequiredBy] = useState("");
  const [remarks, setRemarks] = useState("");
  const [lines, setLines] = useState<Line[]>([]);

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ so_no: string } | null>(null);

  const customer = customers.find((c) => c.id === customerId);
  const grandTotal = lines.reduce((a, l) => a + l.qty * (l.sku.price || 0), 0);
  const totalQty = lines.reduce((a, l) => a + (l.qty || 0), 0);

  function addSku(sku: Sku) {
    setLines((ls) => {
      const existing = ls.find((l) => l.sku.id === sku.id);
      if (existing) return ls.map((l) => (l.sku.id === sku.id ? { ...l, qty: l.qty + 1 } : l));
      return [...ls, { key: keySeq++, sku, qty: 1 }];
    });
  }
  const setQty = (key: number, qty: number) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, qty } : l)));
  const removeLine = (key: number) => setLines((ls) => ls.filter((l) => l.key !== key));

  function toReview() {
    setError(null);
    if (!customerId) return setError("Choose a party first.");
    if (!salesmanName.trim()) return setError("Enter the salesman's name.");
    if (lines.length === 0) return setError("Add at least one item.");
    if (lines.some((l) => !(l.qty > 0))) return setError("Every item needs a quantity greater than 0.");
    setStep("review");
  }

  async function submit() {
    setBusy(true); setError(null);
    const res = await fetch("/api/erp/sales/decoded", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        customer_id: customerId, salesman_name: salesmanName.trim(), order_date: orderDate,
        required_by: requiredBy || "", remarks: remarks.trim(),
        lines: lines.map((l) => ({ sku_id: l.sku.id, qty: l.qty })),
      }),
    }).then((r) => r.json()).catch(() => ({ ok: false, error: "Network error" }));
    setBusy(false);
    if (!res.ok) { setError(res.error ?? "Could not submit"); return; }
    setDone({ so_no: res.so_no }); setStep("done");
  }

  function reset() {
    setCustomerId(""); setSalesmanName(defaultSalesman ?? ""); setOrderDate(today);
    setRequiredBy(""); setRemarks(""); setLines([]); setDone(null); setError(null); setStep("build");
  }

  // ── Done ──
  if (step === "done" && done) {
    return (
      <section className="panel p-6 text-center">
        <div className="text-3xl">✅</div>
        <h2 className="mt-2 text-lg font-extrabold">Decoded order {done.so_no} submitted</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          It's now waiting in <b>Decode Orders</b>. A reviewer can promote it to an open sales order and punch it.
        </p>
        <div className="mt-5 flex justify-center gap-3">
          <Link href="/erp/sales/decoded" className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white">Go to Decode Orders →</Link>
          <button onClick={reset} className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-bold hover:bg-[var(--surface-2)]">✍️ Write another</button>
        </div>
      </section>
    );
  }

  // ── Stepper ──
  const Stepper = (
    <div className="mb-4 flex items-center gap-2 text-xs font-bold">
      <span className={`rounded-full px-3 py-1 ${step === "build" ? "bg-[var(--accent)] text-white" : "bg-[var(--surface-2)] text-[var(--muted)]"}`}>1 · Write order</span>
      <span className="text-[var(--muted-2)]">→</span>
      <span className={`rounded-full px-3 py-1 ${step === "review" ? "bg-[var(--accent)] text-white" : "bg-[var(--surface-2)] text-[var(--muted)]"}`}>2 · Review &amp; submit</span>
    </div>
  );

  // ── Review ──
  if (step === "review") {
    return (
      <>
        {Stepper}
        {error && <div className="mb-3 rounded-lg bg-[var(--danger-bg)] px-3 py-2 text-sm font-semibold text-[var(--danger)]">{error}</div>}
        <section className="panel mb-4">
          <div className="panel-hd">Review order</div>
          <div className="grid grid-cols-2 gap-3 p-4 text-sm sm:grid-cols-4">
            <Field label="Party" value={customer ? `${customer.name}${customer.code ? ` (${customer.code})` : ""}` : "—"} />
            <Field label="Salesman" value={salesmanName} />
            <Field label="Order date" value={orderDate} />
            <Field label="Required by" value={requiredBy || "—"} />
          </div>
          {remarks && <div className="border-t border-[var(--border)] p-4 text-sm"><span className="text-[10px] font-bold uppercase text-[var(--muted-2)]">Remarks</span><div>{remarks}</div></div>}
        </section>
        <section className="panel">
          <div className="overflow-x-auto">
            <table className="rtable">
              <thead><tr><th>#</th><th>SKU</th><th>Item</th><th className="!text-right">MRP</th><th className="!text-right">Qty ordered</th><th className="!text-right">Std Pack 🔒</th><th className="!text-right">Line total</th></tr></thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={l.key}>
                    <td>{i + 1}</td>
                    <td className="font-mono text-xs">{l.sku.sku_code}</td>
                    <td>{l.sku.name}</td>
                    <td className="num-cell">{inr(l.sku.price)}</td>
                    <td className="num-cell font-semibold">{l.qty}</td>
                    <td className="num-cell text-[var(--muted)]">{l.sku.stdPack || "—"}</td>
                    <td className="num-cell">{inr(l.qty * l.sku.price)}</td>
                  </tr>
                ))}
                <tr className="bg-[var(--accent-bg)] font-extrabold">
                  <td colSpan={4} className="uppercase text-[var(--accent-strong)]">Total</td>
                  <td className="num-cell">{totalQty}</td>
                  <td></td>
                  <td className="num-cell">₹{inr(grandTotal)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
        <p className="mt-2 text-xs text-[var(--muted)]">Prices shown are current MRP; the reviewer applies party discounts when punching.</p>
        <div className="mt-4 flex gap-3">
          <button onClick={() => setStep("build")} disabled={busy} className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-bold hover:bg-[var(--surface-2)]">← Edit order</button>
          <button onClick={submit} disabled={busy} className="rounded-lg bg-[var(--accent-2)] px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{busy ? "Submitting…" : "✓ Submit decoded order"}</button>
        </div>
      </>
    );
  }

  // ── Build ──
  return (
    <>
      {Stepper}
      {error && <div className="mb-3 rounded-lg bg-[var(--danger-bg)] px-3 py-2 text-sm font-semibold text-[var(--danger)]">{error}</div>}
      <section className="panel mb-4">
        <div className="panel-hd">Order header</div>
        <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block text-xs">
            <span className="font-semibold text-[var(--muted)]">Party *</span>
            <select className="ctl" value={customerId} onChange={(e) => setCustomerId(e.target.value ? Number(e.target.value) : "")}>
              <option value="">— choose party —</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}{c.code ? ` (${c.code})` : ""}</option>)}
            </select>
          </label>
          <label className="block text-xs">
            <span className="font-semibold text-[var(--muted)]">Salesman *</span>
            <input className="ctl" list="salesmen-list" value={salesmanName} onChange={(e) => setSalesmanName(e.target.value)} placeholder="Your name" />
            <datalist id="salesmen-list">{salesmen.map((s) => <option key={s.id} value={s.name} />)}</datalist>
          </label>
          <label className="block text-xs">
            <span className="font-semibold text-[var(--muted)]">Order date</span>
            <input type="date" className="ctl" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
          </label>
          <label className="block text-xs">
            <span className="font-semibold text-[var(--muted)]">Required by (optional)</span>
            <input type="date" className="ctl" value={requiredBy} onChange={(e) => setRequiredBy(e.target.value)} />
          </label>
        </div>
      </section>

      <section className="panel mb-4">
        <div className="panel-hd">Items</div>
        <div className="p-4">
          <SkuPicker onPick={addSku} />
          <div className="mt-3 overflow-x-auto">
            <table className="rtable">
              <thead><tr><th>#</th><th>SKU</th><th>Item</th><th className="!text-right">MRP</th><th className="!text-right">Qty ordered</th><th className="!text-right" title="Standard packing of this item (locked)">Std Pack 🔒</th><th className="!text-right">Line total</th><th></th></tr></thead>
              <tbody>
                {lines.length === 0 && <tr><td colSpan={8} className="!py-5 text-center text-[var(--muted)]">Search and add items above.</td></tr>}
                {lines.map((l, i) => (
                  <tr key={l.key}>
                    <td>{i + 1}</td>
                    <td className="font-mono text-xs">{l.sku.sku_code}</td>
                    <td>{l.sku.name}</td>
                    <td className="num-cell">{inr(l.sku.price)}</td>
                    <td className="num-cell">
                      <input type="number" min={1} className="w-20 rounded-md border border-[var(--border)] px-2 py-1 text-right" value={l.qty}
                        onChange={(e) => setQty(l.key, Math.max(0, Number(e.target.value)))} />
                    </td>
                    <td className="num-cell bg-[var(--surface-2)] text-[var(--muted)]" title="Standard packing (from item master — read only)">{l.sku.stdPack || "—"}</td>
                    <td className="num-cell">{inr(l.qty * l.sku.price)}</td>
                    <td className="num-cell"><button onClick={() => removeLine(l.key)} className="text-red-600 hover:underline">✕</button></td>
                  </tr>
                ))}
                {lines.length > 0 && (
                  <tr className="bg-[var(--accent-bg)] font-extrabold">
                    <td colSpan={4} className="uppercase text-[var(--accent-strong)]">Total</td>
                    <td className="num-cell">{totalQty}</td>
                    <td></td>
                    <td className="num-cell">₹{inr(grandTotal)}</td><td></td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="panel mb-4">
        <div className="panel-hd">Special remarks / notes</div>
        <div className="p-4">
          <textarea className="ctl" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Any special instructions for this order…" />
        </div>
      </section>

      <div className="flex justify-end">
        <button onClick={toReview} className="rounded-lg bg-[var(--accent)] px-5 py-2 text-sm font-bold text-white">Review order →</button>
      </div>
    </>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase text-[var(--muted-2)]">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}

// Debounced SKU search → dropdown → onPick adds a line.
function SkuPicker({ onPick }: { onPick: (s: Sku) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Sku[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const run = useCallback(async (term: string) => {
    if (term.trim().length < 2) { setResults([]); return; }
    setSearching(true);
    try {
      const d = await fetch(`/api/erp/skus?q=${encodeURIComponent(term.trim())}`).then((r) => r.json());
      const skus = Array.isArray(d.skus) ? d.skus : [];
      setResults(skus.slice(0, 25).map((s: Record<string, unknown>) => ({
        id: Number(s.id), sku_code: String(s.sku_code), name: String(s.name), price: Number(s.price) || 0,
        stdPack: Number(s.master_qty) || 0,
      })));
    } catch { /* keep */ } finally { setSearching(false); }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => run(q), 250);
    return () => clearTimeout(t);
  }, [q, run]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div ref={boxRef} className="relative max-w-xl">
      <input
        className="ctl" value={q} placeholder="Search item by code or name (min 2 chars)…"
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
      />
      {open && (q.trim().length >= 2) && (
        <div className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-[var(--border)] bg-[var(--surface)] p-1 shadow-lg">
          {searching && <div className="px-3 py-2 text-sm text-[var(--muted)]">Searching…</div>}
          {!searching && results.length === 0 && <div className="px-3 py-2 text-sm text-[var(--muted)]">No matches.</div>}
          {results.map((s) => (
            <button key={s.id} onClick={() => { onPick(s); setQ(""); setOpen(false); }}
              className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-1.5 text-left text-sm hover:bg-[var(--surface-2)]">
              <span><span className="font-mono text-xs">{s.sku_code}</span> · {s.name}</span>
              <span className="whitespace-nowrap text-xs text-[var(--muted)]">{s.stdPack ? `pack ${s.stdPack} · ` : ""}₹{inr(s.price)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
