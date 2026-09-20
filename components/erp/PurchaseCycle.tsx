"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Vendor = { id: number; name: string; creditDays: number | null; leadDays: number | null };
type IndentLine = {
  id: number; sku_id: number | null; sku_code: string | null; item_name: string; qty: number;
  movement: string | null; on_hand: number | null; sold: number | null; target_days: number | null;
  vendor_id: number | null; vendor_name: string; unit_price: number; credit_days: number; lead_days: number;
  po_id: number | null; po_no: string | null;
};
type Quote = { id: number; vendor_id: number; vendor_name: string; unit_price: number; credit_days: number; lead_days: number; moq: number; note: string };
type QuoLine = {
  id: number; sku_id: number | null; sku_code: string | null; item_name: string; qty: number; uom: string;
  selected_quote_id: number | null; quotes: Quote[];
  movement: string | null; on_hand: number | null; sold: number | null; target_days: number | null;
};
type Quo = { id: number; quo_no: string; status: string; decision_note: string; decided_by: string | null; indent_id: number | null };
type Indent = { id: number; indent_no: string; status: string; created_by: string; created_at: string };

const inr = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const MOVEMENT_BADGE: Record<string, string> = {
  fast: "bg-teal-100 text-teal-800", medium: "bg-amber-100 text-amber-800",
  slow: "bg-orange-100 text-orange-800", dead: "bg-gray-200 text-gray-600", none: "bg-gray-100 text-gray-500",
};
function MovementBadge({ m, days }: { m: string | null; days: number | null }) {
  if (!m) return null;
  return <span className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${MOVEMENT_BADGE[m] ?? ""}`}>{m}{days ? ` · ${days}d cover` : ""}</span>;
}

// One screen for the whole indent -> quotation -> approval -> PO lifecycle —
// no separate quotation list/detail pages. Which sections render depends on
// how far this indent has gotten (draft / quoting / pending / approved / ordered).
export default function PurchaseCycle({
  indent, indentLines, quotation, vendors, isAdmin, canEdit,
}: {
  indent: Indent;
  indentLines: IndentLine[];
  quotation: { quo: Quo; lines: QuoLine[] } | null;
  vendors: Vendor[];
  isAdmin: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [decideNote, setDecideNote] = useState("");

  async function post(body: Record<string, unknown>, tag = "x") {
    setBusy(tag); setMsg("");
    try {
      const r = await fetch("/api/erp/purchase/quotations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json();
      if (d.ok) router.refresh(); else setMsg(d.error || "Failed");
      return d;
    } catch (e) { setMsg(String(e)); return { ok: false }; }
    finally { setBusy(""); }
  }

  const inp = "rounded border border-[var(--border)] bg-white px-2 py-1 text-sm";
  const canEditQuo = canEdit && quotation?.quo.status === "draft";

  return (
    <div className="flex flex-col gap-4">
      {msg && <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm font-semibold">{msg}</div>}

      {/* 1 — indent lines (auto-generated from sales velocity + stock cover). Shown
          plain until a quotation exists — after that the same context (movement/
          on-hand/sold/target-days) rides along on each quotation line instead, so
          there's no redundant duplicate table. */}
      {!quotation && (
        <section className="panel !p-0 overflow-hidden">
          <div className="border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-2 text-sm font-bold">Indent lines — from sales velocity + stock cover</div>
          <div className="overflow-x-auto">
            <table className="rtable">
              <thead><tr><th>SKU</th><th>Item</th><th className="!text-right">On hand</th><th className="!text-right">Sold (window)</th><th>Movement</th><th className="!text-right">Suggested qty</th></tr></thead>
              <tbody>
                {indentLines.map((l) => (
                  <tr key={l.id}>
                    <td className="font-mono text-xs font-bold text-[var(--muted)]">{l.sku_code || "—"}</td>
                    <td>{l.item_name}</td>
                    <td className="num-cell">{l.on_hand ?? "—"}</td>
                    <td className="num-cell">{l.sold ?? "—"}</td>
                    <td><MovementBadge m={l.movement} days={l.target_days} /></td>
                    <td className="num-cell font-semibold">{l.qty}</td>
                  </tr>
                ))}
                {indentLines.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-[var(--muted)]">Nothing is below its target stock cover right now.</td></tr>}
              </tbody>
            </table>
          </div>
          {canEdit && indentLines.length > 0 && (
            <div className="border-t border-[var(--border)] bg-[var(--surface)] px-4 py-3">
              <RaiseQuotation indentId={indent.id} onCreate={(b) => post(b, "raise")} busy={busy === "raise"} />
            </div>
          )}
        </section>
      )}

      {/* 2 — quotation: multi-vendor comparison per line, once raised */}
      {quotation && (
        <>
          {quotation.quo.status === "pending" && !isAdmin && <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">Submitted — awaiting admin approval.</div>}
          {quotation.quo.status === "approved" && <div className="rounded-lg bg-teal-50 px-3 py-2 text-sm font-semibold text-teal-800">Approved — generate PO(s) below.</div>}
          {quotation.quo.status === "ordered" && <div className="rounded-lg bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-800">PO(s) generated.</div>}
          {quotation.quo.status === "rejected" && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">Rejected by {quotation.quo.decided_by}. {quotation.quo.decision_note}</div>}

          {quotation.lines.map((l, i) => {
            const prices = l.quotes.map((q) => q.unit_price).filter((n) => n > 0);
            const minPrice = prices.length ? Math.min(...prices) : 0;
            const maxCredit = Math.max(0, ...l.quotes.map((q) => q.credit_days));
            const leads = l.quotes.map((q) => q.lead_days).filter((n) => n > 0);
            const minLead = leads.length ? Math.min(...leads) : 0;
            return (
              <section key={l.id} className="panel !p-0 overflow-hidden">
                <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-2">
                  <div className="text-sm font-bold">
                    {i + 1}. {l.item_name || "(item)"} {l.sku_code && <span className="font-mono text-xs text-[var(--muted)]">· {l.sku_code}</span>}
                    <span className="ml-2 text-xs font-normal text-[var(--muted)]">Qty {l.qty} {l.uom}</span>
                    <MovementBadge m={l.movement} days={l.target_days} />
                    {l.on_hand != null && <span className="ml-2 text-xs font-normal text-[var(--muted)]">on hand {l.on_hand} · sold {l.sold}</span>}
                  </div>
                  {canEditQuo && <button onClick={() => post({ action: "deleteLine", lineId: l.id }, `dl${l.id}`)} className="text-xs font-bold text-[var(--danger)] hover:underline">Remove item</button>}
                </div>
                <div className="overflow-x-auto">
                  <table className="rtable">
                    <thead><tr>
                      {canEditQuo && <th style={{ width: 40 }}>Pick</th>}{!canEditQuo && <th style={{ width: 40 }}></th>}
                      <th>Vendor</th><th className="!text-right">Unit price</th><th className="!text-right">Line total</th>
                      <th className="!text-right">Credit</th><th className="!text-right">Delivery</th><th>Note</th>{canEditQuo && <th></th>}
                    </tr></thead>
                    <tbody>
                      {l.quotes.map((q) => {
                        const sel = l.selected_quote_id === q.id;
                        return (
                          <tr key={q.id} className={sel ? "bg-[var(--accent-bg)]" : ""}>
                            <td className="text-center">
                              {canEditQuo
                                ? <input type="radio" name={`pick-${l.id}`} checked={sel} onChange={() => post({ action: "select", lineId: l.id, quoteId: q.id }, `s${q.id}`)} />
                                : sel ? <span className="text-[var(--accent-2)] font-bold">✓</span> : null}
                            </td>
                            <td className="font-semibold">{q.vendor_name}</td>
                            <td className="num-cell font-semibold">{inr(q.unit_price)} {q.unit_price > 0 && q.unit_price === minPrice && <span title="Lowest price" className="ml-1 rounded bg-teal-100 px-1 text-[10px] font-bold text-teal-800">💰 best</span>}</td>
                            <td className="num-cell">{inr(q.unit_price * l.qty)}</td>
                            <td className="num-cell">{q.credit_days}d {q.credit_days > 0 && q.credit_days === maxCredit && <span title="Best credit" className="ml-1 rounded bg-amber-100 px-1 text-[10px] font-bold text-amber-800">💳</span>}</td>
                            <td className="num-cell">{q.lead_days}d {q.lead_days > 0 && q.lead_days === minLead && <span title="Fastest delivery" className="ml-1 rounded bg-blue-100 px-1 text-[10px] font-bold text-blue-800">⚡</span>}</td>
                            <td className="text-xs text-[var(--muted)]">{q.note}</td>
                            {canEditQuo && <td><button onClick={() => post({ action: "deleteQuote", quoteId: q.id }, `dq${q.id}`)} className="text-xs text-[var(--danger)] hover:underline">✕</button></td>}
                          </tr>
                        );
                      })}
                      {l.quotes.length === 0 && <tr><td colSpan={canEditQuo ? 8 : 7} className="px-3 py-3 text-center text-xs text-[var(--muted)]">No vendor quotes yet.</td></tr>}
                    </tbody>
                  </table>
                </div>
                {canEditQuo && <AddQuoteRow lineId={l.id} skuId={l.sku_id} vendors={vendors} onAdd={(body) => post(body, `aq${l.id}`)} busy={busy === `aq${l.id}`} />}
              </section>
            );
          })}

          {canEditQuo && <AddLineRow quotationId={quotation.quo.id} onAdd={(body) => post(body, "al")} busy={busy === "al"} />}

          {/* 3 — approval */}
          <div className="flex flex-wrap items-center gap-3">
            {canEditQuo && quotation.lines.length > 0 && (
              <button onClick={() => post({ action: "submit", quotationId: quotation.quo.id }, "submit")} disabled={busy === "submit"} className="rounded-lg bg-[var(--accent)] px-5 py-2 text-sm font-bold text-white disabled:opacity-50">{busy === "submit" ? "Submitting…" : "Submit for admin approval"}</button>
            )}
            {isAdmin && quotation.quo.status === "pending" && (
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
                <span className="text-sm font-bold">Admin decision:</span>
                <input value={decideNote} onChange={(e) => setDecideNote(e.target.value)} placeholder="note (optional)" className={inp} />
                <button onClick={() => post({ action: "decide", quotationId: quotation.quo.id, approve: true, note: decideNote }, "ap")} disabled={busy === "ap"} className="rounded-lg bg-[var(--accent-2)] px-4 py-1.5 text-sm font-bold text-white disabled:opacity-50">✓ Approve</button>
                <button onClick={() => post({ action: "decide", quotationId: quotation.quo.id, approve: false, note: decideNote }, "rj")} disabled={busy === "rj"} className="rounded-lg border border-[var(--danger)] px-4 py-1.5 text-sm font-bold text-[var(--danger)]">✕ Reject</button>
              </div>
            )}
          </div>
        </>
      )}

      {/* 4 — PO generation, once approved */}
      {(indent.status === "approved" || indent.status === "partial") && (canEdit || isAdmin) && (
        <GeneratePo indentId={indent.id} lines={indentLines} onPost={(b) => post(b, "genpo")} busy={busy === "genpo"} />
      )}
    </div>
  );
}

function RaiseQuotation({ indentId, onCreate, busy }: { indentId: number; onCreate: (b: Record<string, unknown>) => void; busy: boolean }) {
  return (
    <button onClick={() => onCreate({ action: "create", indentId })} disabled={busy} className="rounded-lg bg-[var(--accent-2)] px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
      {busy ? "Raising…" : "Raise Quotation for these items"}
    </button>
  );
}

type PostResult = { ok: boolean; error?: string; pos?: { poNo: string }[] };
function GeneratePo({ indentId, lines, onPost, busy }: { indentId: number; lines: IndentLine[]; onPost: (b: Record<string, unknown>) => Promise<PostResult>; busy: boolean }) {
  const [msg, setMsg] = useState("");
  const pending = lines.filter((l) => !l.po_id && l.sku_id);
  const vendorCount = new Set(pending.map((l) => l.vendor_id)).size;
  if (pending.length === 0) return null;
  async function generate() {
    if (!confirm(`Generate ${vendorCount} purchase order(s) for ${pending.length} line(s)?`)) return;
    const d = await onPost({ action: "generatePO", indentId });
    setMsg(d?.ok ? `✓ Created: ${(d.pos || []).map((p: { poNo: string }) => p.poNo).join(", ")}` : d?.error || "Failed");
  }
  return (
    <div className="panel flex flex-wrap items-center gap-3">
      <button onClick={generate} disabled={busy} className="rounded-lg bg-[var(--accent)] px-5 py-2 text-sm font-bold text-white disabled:opacity-50">
        {busy ? "Generating…" : `Generate PO(s) — ${pending.length} line(s), ${vendorCount} vendor(s)`}
      </button>
      <span className="text-xs text-[var(--muted)]">One PO per vendor; drafts appear in <a href="/erp/purchase" className="text-[var(--accent)] underline">Purchase Orders</a>.</span>
      {msg && <span className="text-sm font-bold text-[var(--accent-2)]">{msg}</span>}
    </div>
  );
}

function AddQuoteRow({ lineId, skuId, vendors, onAdd, busy }: { lineId: number; skuId: number | null; vendors: Vendor[]; onAdd: (b: Record<string, unknown>) => void; busy: boolean }) {
  const [vId, setVId] = useState(""); const [price, setPrice] = useState(""); const [credit, setCredit] = useState(""); const [lead, setLead] = useState(""); const [note, setNote] = useState("");
  const inp = "rounded border border-[var(--border)] bg-white px-2 py-1 text-sm";
  function add() {
    if (!vId) return;
    const v = vendors.find((x) => String(x.id) === vId);
    onAdd({ action: "addQuote", lineId, skuId, vendorId: Number(vId), unitPrice: Number(price) || 0, creditDays: Number(credit) || v?.creditDays || 0, leadDays: Number(lead) || v?.leadDays || 0, note });
    setVId(""); setPrice(""); setCredit(""); setLead(""); setNote("");
  }
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm">
      <span className="text-xs font-bold text-[var(--muted)]">+ Vendor quote:</span>
      <select value={vId} onChange={(e) => setVId(e.target.value)} className={inp}><option value="">Vendor…</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select>
      <input value={price} onChange={(e) => setPrice(e.target.value)} type="number" step="0.01" placeholder="₹ price (blank = use catalog cost)" className={`${inp} w-56`} />
      <input value={credit} onChange={(e) => setCredit(e.target.value)} type="number" placeholder="credit d" className={`${inp} w-20`} />
      <input value={lead} onChange={(e) => setLead(e.target.value)} type="number" placeholder="lead d" className={`${inp} w-20`} />
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="note" className={`${inp} w-32`} />
      <button onClick={add} disabled={busy || !vId} className="rounded bg-[var(--accent)] px-3 py-1 text-xs font-bold text-white disabled:opacity-50">Add</button>
    </div>
  );
}

function AddLineRow({ quotationId, onAdd, busy }: { quotationId: number; onAdd: (b: Record<string, unknown>) => void; busy: boolean }) {
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
    onAdd({ action: "addLine", quotationId, skuId: picked.id, itemName: picked.name, qty: Number(qty) || 1, uom });
    setQ(""); setResults([]); setPicked(null); setQty("1");
  }
  return (
    <div className="panel flex flex-wrap items-end gap-2">
      <div className="relative flex min-w-[280px] flex-1 flex-col gap-1">
        <span className="text-xs font-bold text-[var(--muted)]">Add an extra item (search SKU)</span>
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
