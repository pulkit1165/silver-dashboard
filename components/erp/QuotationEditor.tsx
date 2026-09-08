"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Vendor = { id: number; name: string; creditDays: number | null; leadDays: number | null };
type Quote = { id: number; vendor_id: number; vendor_name: string; unit_price: number; credit_days: number; lead_days: number; moq: number; note: string };
type Line = { id: number; sku_id: number | null; sku_code: string | null; item_name: string; qty: number; uom: string; selected_quote_id: number | null; quotes: Quote[] };
type Quo = { id: number; quo_no: string; status: string; decision_note: string; decided_by: string | null; indent_id: number | null };

const inr = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export default function QuotationEditor({
  quo, lines, vendors, canEdit, isAdmin,
}: { quo: Quo; lines: Line[]; vendors: Vendor[]; canEdit: boolean; isAdmin: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [decideNote, setDecideNote] = useState("");

  async function post(body: Record<string, unknown>, tag = "x") {
    setBusy(tag); setMsg("");
    try {
      const r = await fetch("/api/erp/purchase/quotations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, quotationId: quo.id }) });
      const d = await r.json();
      if (d.ok) { router.refresh(); if (body.action === "decide") setMsg(body.approve ? `Approved → indent ${d.indentNo}` : "Rejected"); }
      else setMsg(d.error || "Failed");
      return d;
    } catch (e) { setMsg(String(e)); return { ok: false }; }
    finally { setBusy(""); }
  }

  const inp = "rounded border border-[var(--border)] bg-white px-2 py-1 text-sm";

  return (
    <div className="flex flex-col gap-4">
      {msg && <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm font-semibold">{msg}</div>}

      {/* status banners */}
      {quo.status === "pending" && !isAdmin && <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">Submitted — awaiting admin approval.</div>}
      {quo.status === "approved" && quo.indent_id && <div className="rounded-lg bg-teal-50 px-3 py-2 text-sm font-semibold text-teal-800">Approved. <a href={`/erp/purchase/indents/${quo.indent_id}`} className="underline">Open the indent →</a> to generate PO(s).</div>}
      {quo.status === "ordered" && quo.indent_id && <div className="rounded-lg bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-800">PO(s) generated. <a href={`/erp/purchase/indents/${quo.indent_id}`} className="underline">View indent →</a></div>}
      {quo.status === "rejected" && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">Rejected by {quo.decided_by}. {quo.decision_note}</div>}

      {/* lines + comparison */}
      {lines.map((l, i) => {
        const prices = l.quotes.map((q) => q.unit_price).filter((n) => n > 0);
        const minPrice = prices.length ? Math.min(...prices) : 0;
        const maxCredit = Math.max(0, ...l.quotes.map((q) => q.credit_days));
        const leads = l.quotes.map((q) => q.lead_days).filter((n) => n > 0);
        const minLead = leads.length ? Math.min(...leads) : 0;
        return (
          <section key={l.id} className="panel !p-0 overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-2">
              <div className="text-sm font-bold">{i + 1}. {l.item_name || "(item)"} {l.sku_code && <span className="font-mono text-xs text-[var(--muted)]">· {l.sku_code}</span>}
                <span className="ml-2 text-xs font-normal text-[var(--muted)]">Qty {l.qty} {l.uom}</span></div>
              {canEdit && <button onClick={() => post({ action: "deleteLine", lineId: l.id }, `dl${l.id}`)} className="text-xs font-bold text-[var(--danger)] hover:underline">Remove item</button>}
            </div>
            <div className="overflow-x-auto">
              <table className="rtable">
                <thead><tr>
                  {canEdit && <th style={{ width: 40 }}>Pick</th>}{!canEdit && <th style={{ width: 40 }}></th>}
                  <th>Vendor</th><th className="!text-right">Unit price</th><th className="!text-right">Line total</th>
                  <th className="!text-right">Credit</th><th className="!text-right">Delivery</th><th>Note</th>{canEdit && <th></th>}
                </tr></thead>
                <tbody>
                  {l.quotes.map((q) => {
                    const sel = l.selected_quote_id === q.id;
                    return (
                      <tr key={q.id} className={sel ? "bg-[var(--accent-bg)]" : ""}>
                        <td className="text-center">
                          {canEdit
                            ? <input type="radio" name={`pick-${l.id}`} checked={sel} onChange={() => post({ action: "select", lineId: l.id, quoteId: q.id }, `s${q.id}`)} />
                            : sel ? <span className="text-[var(--accent-2)] font-bold">✓</span> : null}
                        </td>
                        <td className="font-semibold">{q.vendor_name}</td>
                        <td className="num-cell font-semibold">{inr(q.unit_price)} {q.unit_price > 0 && q.unit_price === minPrice && <span title="Lowest price" className="ml-1 rounded bg-teal-100 px-1 text-[10px] font-bold text-teal-800">💰 best</span>}</td>
                        <td className="num-cell">{inr(q.unit_price * l.qty)}</td>
                        <td className="num-cell">{q.credit_days}d {q.credit_days > 0 && q.credit_days === maxCredit && <span title="Best credit" className="ml-1 rounded bg-amber-100 px-1 text-[10px] font-bold text-amber-800">💳</span>}</td>
                        <td className="num-cell">{q.lead_days}d {q.lead_days > 0 && q.lead_days === minLead && <span title="Fastest delivery" className="ml-1 rounded bg-blue-100 px-1 text-[10px] font-bold text-blue-800">⚡</span>}</td>
                        <td className="text-xs text-[var(--muted)]">{q.note}</td>
                        {canEdit && <td><button onClick={() => post({ action: "deleteQuote", quoteId: q.id }, `dq${q.id}`)} className="text-xs text-[var(--danger)] hover:underline">✕</button></td>}
                      </tr>
                    );
                  })}
                  {l.quotes.length === 0 && <tr><td colSpan={canEdit ? 8 : 7} className="px-3 py-3 text-center text-xs text-[var(--muted)]">No vendor quotes yet.</td></tr>}
                </tbody>
              </table>
            </div>
            {canEdit && <AddQuoteRow lineId={l.id} vendors={vendors} onAdd={(body) => post(body, `aq${l.id}`)} busy={busy === `aq${l.id}`} />}
          </section>
        );
      })}
      {lines.length === 0 && <p className="px-1 text-sm text-[var(--muted)]">No items yet{canEdit ? " — add the first item below." : "."}</p>}

      {/* add line */}
      {canEdit && <AddLineRow onAdd={(body) => post(body, "al")} busy={busy === "al"} />}

      {/* actions */}
      <div className="flex flex-wrap items-center gap-3">
        {canEdit && lines.length > 0 && (
          <button onClick={() => post({ action: "submit" }, "submit")} disabled={busy === "submit"} className="rounded-lg bg-[var(--accent)] px-5 py-2 text-sm font-bold text-white disabled:opacity-50">{busy === "submit" ? "Submitting…" : "Submit for admin approval"}</button>
        )}
        {isAdmin && quo.status === "pending" && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
            <span className="text-sm font-bold">Admin decision:</span>
            <input value={decideNote} onChange={(e) => setDecideNote(e.target.value)} placeholder="note (optional)" className={inp} />
            <button onClick={() => post({ action: "decide", approve: true, note: decideNote }, "ap")} disabled={busy === "ap"} className="rounded-lg bg-[var(--accent-2)] px-4 py-1.5 text-sm font-bold text-white disabled:opacity-50">✓ Approve → create indent</button>
            <button onClick={() => post({ action: "decide", approve: false, note: decideNote }, "rj")} disabled={busy === "rj"} className="rounded-lg border border-[var(--danger)] px-4 py-1.5 text-sm font-bold text-[var(--danger)]">✕ Reject</button>
          </div>
        )}
      </div>
    </div>
  );
}

function AddQuoteRow({ lineId, vendors, onAdd, busy }: { lineId: number; vendors: Vendor[]; onAdd: (b: Record<string, unknown>) => void; busy: boolean }) {
  const [vId, setVId] = useState(""); const [price, setPrice] = useState(""); const [credit, setCredit] = useState(""); const [lead, setLead] = useState(""); const [note, setNote] = useState("");
  const inp = "rounded border border-[var(--border)] bg-white px-2 py-1 text-sm";
  function add() {
    if (!vId) return;
    const v = vendors.find((x) => String(x.id) === vId);
    onAdd({ action: "addQuote", lineId, vendorId: Number(vId), unitPrice: Number(price) || 0, creditDays: Number(credit) || v?.creditDays || 0, leadDays: Number(lead) || v?.leadDays || 0, note });
    setVId(""); setPrice(""); setCredit(""); setLead(""); setNote("");
  }
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm">
      <span className="text-xs font-bold text-[var(--muted)]">+ Vendor quote:</span>
      <select value={vId} onChange={(e) => setVId(e.target.value)} className={inp}><option value="">Vendor…</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select>
      <input value={price} onChange={(e) => setPrice(e.target.value)} type="number" step="0.01" placeholder="₹ price" className={`${inp} w-24`} />
      <input value={credit} onChange={(e) => setCredit(e.target.value)} type="number" placeholder="credit d" className={`${inp} w-20`} />
      <input value={lead} onChange={(e) => setLead(e.target.value)} type="number" placeholder="lead d" className={`${inp} w-20`} />
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="note" className={`${inp} w-32`} />
      <button onClick={add} disabled={busy || !vId} className="rounded bg-[var(--accent)] px-3 py-1 text-xs font-bold text-white disabled:opacity-50">Add</button>
    </div>
  );
}

function AddLineRow({ onAdd, busy }: { onAdd: (b: Record<string, unknown>) => void; busy: boolean }) {
  const [q, setQ] = useState(""); const [results, setResults] = useState<{ id: number; sku_code: string; name: string }[]>([]);
  const [picked, setPicked] = useState<{ id: number; sku_code: string; name: string } | null>(null);
  const [qty, setQty] = useState("1"); const [uom, setUom] = useState("PCS");
  const inp = "rounded border border-[var(--border)] bg-white px-2 py-1 text-sm";
  async function search(v: string) {
    setQ(v); setPicked(null);
    if (v.trim().length < 2) { setResults([]); return; }
    try { const r = await fetch(`/api/erp/skus?q=${encodeURIComponent(v.trim())}`); const d = await r.json(); setResults((d.skus || []).slice(0, 8)); } catch { setResults([]); }
  }
  function add() {
    if (!picked) return;
    onAdd({ action: "addLine", skuId: picked.id, itemName: picked.name, qty: Number(qty) || 1, uom });
    setQ(""); setResults([]); setPicked(null); setQty("1");
  }
  return (
    <div className="panel flex flex-wrap items-end gap-2">
      <div className="relative flex min-w-[280px] flex-1 flex-col gap-1">
        <span className="text-xs font-bold text-[var(--muted)]">Add item (search SKU)</span>
        <input value={picked ? `${picked.sku_code} · ${picked.name}` : q} onChange={(e) => search(e.target.value)} placeholder="type code or name…" className={inp} />
        {results.length > 0 && !picked && (
          <div className="absolute top-full z-10 mt-1 max-h-52 w-full overflow-auto rounded-lg border border-[var(--border)] bg-white shadow">
            {results.map((s) => (
              <button key={s.id} onClick={() => { setPicked(s); setResults([]); }} className="block w-full px-3 py-1.5 text-left text-sm hover:bg-[var(--surface-2)]">
                <span className="font-mono font-bold">{s.sku_code}</span> · {s.name}
              </button>
            ))}
          </div>
        )}
      </div>
      <label className="flex flex-col gap-1 text-xs font-bold text-[var(--muted)]">Qty<input value={qty} onChange={(e) => setQty(e.target.value)} type="number" className={`${inp} w-20`} /></label>
      <label className="flex flex-col gap-1 text-xs font-bold text-[var(--muted)]">Unit<input value={uom} onChange={(e) => setUom(e.target.value)} className={`${inp} w-20`} /></label>
      <button onClick={add} disabled={busy || !picked} className="rounded-lg bg-[var(--accent-2)] px-4 py-2 text-sm font-bold text-white disabled:opacity-50">+ Add item</button>
    </div>
  );
}
