"use client";

import { useMemo, useState } from "react";
import { GST_STATE_CODES, gstStateName } from "@/lib/erp/gst-states";
import type { DiscountClassRow } from "@/lib/erp/discount-classes";

type Customer = {
  id: number; code: string; name: string; gst: string; email: string; phone: string;
  billing: string; credit_limit: number; payment_terms: string;
  state_code: string | null; pos_state_code: string | null; pincode: string | null;
  discount_class_id: number | null; discount_pct: number | null;
};

export default function CustomerGstManager({
  customers: initial, discountClasses: initialClasses, editable,
}: { customers: Customer[]; discountClasses: DiscountClassRow[]; editable: boolean }) {
  const [customers, setCustomers] = useState(initial);
  const [classes, setClasses] = useState(initialClasses);
  const [quick, setQuick] = useState("");
  const [gap, setGap] = useState<"all" | "missing">("all");
  const [showClasses, setShowClasses] = useState(false);
  const [edit, setEdit] = useState<Customer | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [newClass, setNewClass] = useState({ code: "", name: "", whole_order_pct: "" });
  const [classBusy, setClassBusy] = useState(false);

  const flash = (ok: boolean, text: string) => { setMsg({ ok, text }); setTimeout(() => setMsg(null), 4000); };
  const classById = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes]);

  const view = useMemo(() => {
    let v = customers;
    if (gap === "missing") v = v.filter((c) => !c.state_code || !c.discount_class_id);
    if (quick.trim()) {
      const q = quick.trim().toLowerCase();
      v = v.filter((c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q) || (c.gst || "").toLowerCase().includes(q));
    }
    return v;
  }, [customers, quick, gap]);

  async function saveEdit() {
    if (!edit) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/erp/customers/${edit.id}`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          gst: edit.gst, state_code: edit.state_code, pos_state_code: edit.pos_state_code,
          pincode: edit.pincode, discount_class_id: edit.discount_class_id, discount_pct: edit.discount_pct,
        }),
      });
      const d = await r.json();
      if (!r.ok || !d.ok) { flash(false, d.error || "Could not save."); return; }
      setCustomers((cs) => cs.map((c) => (c.id === edit.id ? { ...c, ...edit } : c)));
      flash(true, `Saved ${edit.name}.`);
      setEdit(null);
    } catch { flash(false, "Network error."); } finally { setBusy(false); }
  }

  async function createClass() {
    if (!newClass.code.trim() || !newClass.name.trim()) return;
    setClassBusy(true);
    try {
      const r = await fetch("/api/erp/discount-classes", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: newClass.code, name: newClass.name, whole_order_pct: Number(newClass.whole_order_pct || 0) }),
      });
      const d = await r.json();
      if (!r.ok || !d.ok) { flash(false, d.error || "Could not create class."); return; }
      setClasses((cs) => [...cs, { id: d.id, code: newClass.code.toUpperCase(), name: newClass.name, whole_order_pct: Number(newClass.whole_order_pct || 0), active: true, customer_count: 0 }]);
      setNewClass({ code: "", name: "", whole_order_pct: "" });
      flash(true, "Discount class created.");
    } catch { flash(false, "Network error."); } finally { setClassBusy(false); }
  }

  const inp = "rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 text-sm outline-none focus:border-[var(--accent)]";

  return (
    <>
      {editable && (
        <section className="panel mb-5">
          <button onClick={() => setShowClasses((s) => !s)} className="flex w-full items-center justify-between px-4 py-3 text-left">
            <span className="text-sm font-extrabold">⚙ Discount Classes ({classes.length})</span>
            <span className="text-xs font-semibold text-[var(--muted)]">{showClasses ? "Hide" : "Show"}</span>
          </button>
          {showClasses && (
            <div className="border-t border-[var(--border)] p-4">
              <table className="rtable mb-3">
                <thead><tr><th>Code</th><th>Name</th><th className="!text-right">% off MRP</th><th className="!text-right">Customers</th></tr></thead>
                <tbody>
                  {classes.map((c) => (
                    <tr key={c.id}><td className="font-mono text-xs">{c.code}</td><td className="font-semibold">{c.name}</td>
                      <td className="num-cell">{c.whole_order_pct.toFixed(2)}%</td><td className="num-cell">{c.customer_count}</td></tr>
                  ))}
                  {classes.length === 0 && <tr><td colSpan={4} className="!py-4 text-center text-[var(--muted)]">No discount classes yet.</td></tr>}
                </tbody>
              </table>
              <div className="flex flex-wrap items-end gap-2 rounded-xl border border-dashed border-[var(--border)] p-3">
                <label className="flex flex-col gap-1 text-[10px] font-bold uppercase text-[var(--muted-2)]">Code
                  <input className={inp} value={newClass.code} onChange={(e) => setNewClass({ ...newClass, code: e.target.value })} placeholder="STD" /></label>
                <label className="flex flex-col gap-1 text-[10px] font-bold uppercase text-[var(--muted-2)]">Name
                  <input className={inp} value={newClass.name} onChange={(e) => setNewClass({ ...newClass, name: e.target.value })} placeholder="Standard dealer" /></label>
                <label className="flex flex-col gap-1 text-[10px] font-bold uppercase text-[var(--muted-2)]">% off MRP
                  <input type="number" step="0.01" className={inp} value={newClass.whole_order_pct} onChange={(e) => setNewClass({ ...newClass, whole_order_pct: e.target.value })} placeholder="60.58" /></label>
                <button onClick={createClass} disabled={classBusy} className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white hover:bg-[var(--accent-strong)] disabled:opacity-60">+ Create class</button>
              </div>
            </div>
          )}
        </section>
      )}

      <section className="panel">
        <div className="panel-hd flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span>Customers</span>
            <select value={gap} onChange={(e) => setGap(e.target.value as typeof gap)} className={inp}>
              <option value="all">All</option>
              <option value="missing">Missing GST setup</option>
            </select>
            <input value={quick} onChange={(e) => setQuick(e.target.value)} placeholder="Quick filter…" className={inp} />
          </div>
          {msg && <span className={`text-xs font-bold ${msg.ok ? "text-[var(--accent-2)]" : "text-[var(--danger)]"}`}>{msg.ok ? "✓ " : "✕ "}{msg.text}</span>}
        </div>
        <div className="overflow-x-auto">
          <table className="rtable">
            <thead><tr>
              <th>Code</th><th>Name</th><th>GST</th><th>State</th><th>POS</th>
              <th>Discount class</th><th className="!text-right">Disc %</th><th className="!text-right">Credit limit</th>{editable && <th></th>}
            </tr></thead>
            <tbody>
              {view.map((c) => (
                <tr key={c.id}>
                  <td className="font-mono text-xs">{c.code}</td>
                  <td className="font-semibold">{c.name}</td>
                  <td className="font-mono text-xs">{c.gst || <span className="text-[var(--muted-2)]">—</span>}</td>
                  <td className="text-xs">{c.state_code ? `${c.state_code} · ${gstStateName(c.state_code)}` : <span className="tag">missing</span>}</td>
                  <td className="text-xs text-[var(--muted)]">{c.pos_state_code || "—"}</td>
                  <td className="text-xs">{c.discount_class_id ? (classById.get(c.discount_class_id)?.name ?? "—") : <span className="tag">unassigned</span>}</td>
                  <td className="num-cell">{c.discount_pct != null ? `${Number(c.discount_pct).toFixed(2)}%` : "—"}</td>
                  <td className="num-cell">{c.credit_limit.toLocaleString("en-IN")}</td>
                  {editable && (
                    <td className="text-right">
                      <button onClick={() => setEdit(c)} className="rounded-lg border border-[var(--border)] bg-white px-3 py-1.5 text-xs font-bold hover:bg-[var(--surface-2)]">Edit</button>
                    </td>
                  )}
                </tr>
              ))}
              {view.length === 0 && <tr><td colSpan={editable ? 9 : 8} className="!py-6 text-center text-[var(--muted)]">No customers match.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="border-t border-[var(--border)] p-3 text-xs text-[var(--muted)]">
          For bulk changes across many customers, use <b>Upload Master (Excel)</b> above instead of editing one by one.
        </p>
      </section>

      {edit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setEdit(null)}>
          <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--background)] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-extrabold">GST setup · {edit.name}</h2>
              <button onClick={() => setEdit(null)} className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-sm font-bold hover:bg-[var(--surface-2)]">✕</button>
            </div>
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-xs font-bold text-[var(--muted)]">GSTIN
                <input className={inp} value={edit.gst ?? ""} onChange={(e) => setEdit({ ...edit, gst: e.target.value.toUpperCase() })} maxLength={15} /></label>
              <label className="flex flex-col gap-1 text-xs font-bold text-[var(--muted)]">State (buyer's GST state)
                <select className={inp} value={edit.state_code ?? ""} onChange={(e) => {
                  const v = e.target.value;
                  setEdit((cur) => cur && { ...cur, state_code: v, pos_state_code: cur.pos_state_code || v });
                }}>
                  <option value="">— select —</option>
                  {GST_STATE_CODES.map((s) => <option key={s.code} value={s.code}>{s.code} — {s.name}</option>)}
                </select></label>
              <label className="flex flex-col gap-1 text-xs font-bold text-[var(--muted)]">Place of supply (defaults to state; change only if shipping elsewhere)
                <select className={inp} value={edit.pos_state_code ?? ""} onChange={(e) => setEdit({ ...edit, pos_state_code: e.target.value })}>
                  <option value="">— select —</option>
                  {GST_STATE_CODES.map((s) => <option key={s.code} value={s.code}>{s.code} — {s.name}</option>)}
                </select></label>
              <label className="flex flex-col gap-1 text-xs font-bold text-[var(--muted)]">Pincode
                <input className={inp} value={edit.pincode ?? ""} onChange={(e) => setEdit({ ...edit, pincode: e.target.value })} /></label>
              <label className="flex flex-col gap-1 text-xs font-bold text-[var(--muted)]">Discount class
                <select className={inp} value={edit.discount_class_id ?? ""} onChange={(e) => setEdit({ ...edit, discount_class_id: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">— none —</option>
                  {classes.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name} ({c.whole_order_pct}%)</option>)}
                </select></label>
              <label className="flex flex-col gap-1 text-xs font-bold text-[var(--muted)]">Standing discount % override (blank = use class default)
                <input type="number" step="0.01" className={inp} value={edit.discount_pct ?? ""} onChange={(e) => setEdit({ ...edit, discount_pct: e.target.value === "" ? null : Number(e.target.value) })} /></label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setEdit(null)} className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-bold hover:bg-[var(--surface-2)]">Cancel</button>
              <button onClick={saveEdit} disabled={busy} className="rounded-lg bg-[var(--accent-2)] px-4 py-2 text-sm font-bold text-white hover:opacity-90 disabled:opacity-60">Save</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
