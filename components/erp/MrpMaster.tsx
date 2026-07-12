"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import type { MrpRow, MrpHistoryRow } from "@/lib/erp/mrp";

type ParsedRow = { sku_code: string; mrp: number };
const norm = (s: unknown) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
const CODE_KEYS = ["skucode", "code", "itemcode", "item", "sku", "partno", "partcode"];
const MRP_KEYS = ["mrp", "newmrp", "price", "listprice", "maxretailprice", "mrprate", "rate", "amount"];
const numify = (v: unknown) => Number(String(v ?? "").replace(/[₹,\s]/g, ""));

function parseSheet(json: Record<string, unknown>[]): ParsedRow[] {
  return json.map((r) => {
    const keys = Object.keys(r);
    const codeK = keys.find((k) => CODE_KEYS.includes(norm(k)));
    const mrpK = keys.find((k) => MRP_KEYS.includes(norm(k)));
    return { sku_code: codeK ? String(r[codeK]).trim() : "", mrp: mrpK ? numify(r[mrpK]) : NaN };
  }).filter((x) => x.sku_code && Number.isFinite(x.mrp) && x.mrp >= 0);
}
function parsePaste(text: string): ParsedRow[] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const parts = l.split(/[\t,;]/).map((s) => s.trim());
    return { sku_code: parts[0] ?? "", mrp: numify(parts[1]) };
  }).filter((x) => x.sku_code && Number.isFinite(x.mrp) && x.mrp >= 0);
}

export default function MrpMaster({ rows: initialRows, editable }: { rows: MrpRow[]; editable: boolean }) {
  const router = useRouter();
  const [rows, setRows] = useState<MrpRow[]>(initialRows);
  const [edit, setEdit] = useState<Record<number, { value: string; busy: boolean; err: string | null }>>({});
  const [openId, setOpenId] = useState<number | null>(null);
  const [history, setHistory] = useState<Record<number, MrpHistoryRow[]>>({});

  // bulk
  const [showBulk, setShowBulk] = useState(false);
  const [parsed, setParsed] = useState<ParsedRow[]>([]);
  const [pasteText, setPasteText] = useState("");
  const [effDate, setEffDate] = useState("");
  const [note, setNote] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMsg, setBulkMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function startEdit(r: MrpRow) {
    setEdit((e) => ({ ...e, [r.id]: { value: String(Number(r.price).toFixed(2)), busy: false, err: null } }));
  }
  async function saveMrp(id: number) {
    const st = edit[id];
    if (!st) return;
    const num = Number(st.value);
    if (!Number.isFinite(num) || num < 0) { setEdit((e) => ({ ...e, [id]: { ...st, err: "Invalid" } })); return; }
    setEdit((e) => ({ ...e, [id]: { ...st, busy: true, err: null } }));
    try {
      const r = await fetch(`/api/erp/skus/${id}/mrp`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ mrp: num, effective_at: effDate || undefined, note: note || undefined }),
      });
      const d = await r.json();
      if (d.ok) {
        setRows((rs) => rs.map((row) => row.id === id
          ? { ...row, price: d.sku.price, last_mrp: d.sku.price, prev_mrp: row.last_mrp ?? row.price, last_mrp_at: "just now", last_mrp_by: "you", change_count: row.change_count + 1 }
          : row));
        setEdit((e) => { const n = { ...e }; delete n[id]; return n; });
        setHistory((h) => { const n = { ...h }; delete n[id]; return n; });
      } else setEdit((e) => ({ ...e, [id]: { ...st, busy: false, err: d.error ?? "Failed" } }));
    } catch { setEdit((e) => ({ ...e, [id]: { ...st, busy: false, err: "Network error" } })); }
  }
  async function toggleHistory(id: number) {
    if (openId === id) { setOpenId(null); return; }
    setOpenId(id);
    if (!history[id]) {
      try { const r = await fetch(`/api/erp/skus/${id}/mrp`); const d = await r.json(); if (d.ok) setHistory((h) => ({ ...h, [id]: d.history })); } catch { /* ignore */ }
    }
  }

  async function onFile(file: File) {
    setBulkMsg(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(ws, { defval: "" }) as Record<string, unknown>[];
      const out = parseSheet(json);
      setParsed(out);
      if (!out.length) setBulkMsg({ ok: false, text: "No usable rows found — need columns like 'sku_code' and 'mrp'." });
    } catch { setBulkMsg({ ok: false, text: "Could not read that file." }); }
  }
  function onPaste(text: string) { setPasteText(text); setParsed(parsePaste(text)); }

  async function applyBulk() {
    if (!parsed.length) return;
    setBulkBusy(true); setBulkMsg(null);
    try {
      const r = await fetch("/api/erp/masters/mrp/bulk", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ updates: parsed, effective_at: effDate || undefined, note: note || undefined }),
      });
      const d = await r.json();
      if (d.ok) {
        setBulkMsg({ ok: d.applied > 0, text: `Applied ${d.applied} MRP update(s)${d.failed ? ` · ${d.failed} skipped (${(d.errors || []).slice(0, 3).join("; ")})` : ""}.` });
        setParsed([]); setPasteText("");
        router.refresh();
      } else setBulkMsg({ ok: false, text: d.error ?? "Bulk update failed." });
    } catch { setBulkMsg({ ok: false, text: "Network error" }); }
    finally { setBulkBusy(false); }
  }

  const inr = (n: number | null | undefined) => (n == null ? "—" : `₹${Number(n).toFixed(2)}`);

  return (
    <div className="flex flex-col gap-4">
      {/* Bulk update — the "master MRP file" */}
      {editable && (
        <section className="panel">
          <button onClick={() => setShowBulk((s) => !s)} className="flex w-full items-center justify-between px-4 py-3 text-left">
            <span className="text-sm font-extrabold">⬆ Bulk update MRP (Excel / paste)</span>
            <span className="text-xs font-semibold text-[var(--muted)]">{showBulk ? "Hide" : "Show"}</span>
          </button>
          {showBulk && (
            <div className="border-t border-[var(--border)] p-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <div className="mb-1 text-xs font-bold uppercase text-[var(--muted)]">Upload a file</div>
                  <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
                    className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-[var(--accent)] file:px-3 file:py-2 file:text-sm file:font-bold file:text-white" />
                  <p className="mt-1 text-xs text-[var(--muted)]">Needs an <b>sku_code</b> column and an <b>mrp</b> (or price) column. Extra columns are ignored.</p>
                </div>
                <div>
                  <div className="mb-1 text-xs font-bold uppercase text-[var(--muted)]">…or paste rows</div>
                  <textarea value={pasteText} onChange={(e) => onPaste(e.target.value)} rows={4}
                    placeholder={"BC02001, 120\nBC53000\t85\nBC54001, 60"}
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 font-mono text-xs outline-none focus:border-[var(--accent)]" />
                  <p className="mt-1 text-xs text-[var(--muted)]">One per line: <b>SKU code</b>, then <b>MRP</b> (comma or tab separated).</p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--muted)]">
                  Effective date (optional)
                  <input type="date" value={effDate} onChange={(e) => setEffDate(e.target.value)}
                    className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm" />
                </label>
                <label className="flex flex-1 flex-col gap-1 text-xs font-semibold text-[var(--muted)]">
                  Note (optional)
                  <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Jul-2026 price list"
                    className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm" />
                </label>
                <button onClick={applyBulk} disabled={bulkBusy || parsed.length === 0}
                  className="rounded-lg bg-[var(--accent-2)] px-5 py-2 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50">
                  {bulkBusy ? "Applying…" : `Apply ${parsed.length || ""} update${parsed.length === 1 ? "" : "s"}`}
                </button>
              </div>
              {parsed.length > 0 && (
                <p className="mt-2 text-xs text-[var(--muted)]"><b>{parsed.length}</b> rows ready — e.g. {parsed.slice(0, 4).map((p) => `${p.sku_code}=₹${p.mrp}`).join(", ")}{parsed.length > 4 ? " …" : ""}</p>
              )}
              {bulkMsg && <p className={`mt-2 text-sm font-bold ${bulkMsg.ok ? "text-[var(--accent-2)]" : "text-[var(--danger)]"}`}>{bulkMsg.ok ? "✓ " : "✕ "}{bulkMsg.text}</p>}
            </div>
          )}
        </section>
      )}

      <section className="panel">
        <div className="overflow-x-auto">
          <table className="rtable">
            <thead>
              <tr>
                <th>Code</th><th>Item</th><th>Category</th>
                <th className="!text-right">Current MRP</th><th className="!text-right">Previous</th>
                <th>Last changed</th><th></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={7} className="!py-6 text-center text-[var(--muted)]">No items found.</td></tr>}
              {rows.map((s) => {
                const st = edit[s.id];
                return (
                  <Fragment key={s.id}>
                    <tr>
                      <td className="font-mono text-xs">{s.sku_code}</td>
                      <td className="font-semibold">{s.name}</td>
                      <td className="text-[var(--muted)]">{s.category}</td>
                      <td className="num-cell">
                        {editable && st ? (
                          <span className="inline-flex items-center gap-1">
                            <input type="number" step="0.01" autoFocus value={st.value}
                              onChange={(e) => setEdit((ed) => ({ ...ed, [s.id]: { ...st, value: e.target.value } }))}
                              onKeyDown={(e) => { if (e.key === "Enter") saveMrp(s.id); if (e.key === "Escape") setEdit((ed) => { const n = { ...ed }; delete n[s.id]; return n; }); }}
                              onBlur={() => saveMrp(s.id)} disabled={st.busy}
                              className="w-24 rounded border border-[var(--accent)] bg-[var(--surface)] px-2 py-1 text-right text-sm outline-none" />
                            {st.err && <span className="text-xs font-semibold text-[var(--danger)]">{st.err}</span>}
                          </span>
                        ) : editable ? (
                          <button type="button" onClick={() => startEdit(s)} title="Click to set a new MRP"
                            className="rounded px-2 py-1 text-right font-bold tabular-nums hover:bg-[var(--surface-2)]">
                            {Number(s.price).toFixed(2)}
                          </button>
                        ) : (
                          <span className="font-bold tabular-nums">{Number(s.price).toFixed(2)}</span>
                        )}
                      </td>
                      <td className="num-cell text-[var(--muted)]">{s.prev_mrp != null ? Number(s.prev_mrp).toFixed(2) : "—"}</td>
                      <td className="text-xs text-[var(--muted)]">
                        {s.last_mrp_at ? <>{s.last_mrp_at}{s.last_mrp_by ? <> · {s.last_mrp_by}</> : null}</> : <span className="italic">never changed</span>}
                      </td>
                      <td className="text-right">
                        <button onClick={() => toggleHistory(s.id)} title="MRP history"
                          className="rounded px-2 py-1 text-xs font-bold text-[var(--accent-strong)] hover:bg-[var(--accent-bg)]">
                          🕑 {s.change_count > 0 ? s.change_count : ""}
                        </button>
                      </td>
                    </tr>
                    {openId === s.id && (
                      <tr>
                        <td colSpan={7} className="bg-[var(--surface-2)]">
                          <div className="p-2 text-xs">
                            <div className="mb-1 font-bold text-[var(--muted)]">MRP history — {s.sku_code} (most recent first)</div>
                            {!history[s.id] ? <div className="text-[var(--muted)]">Loading…</div>
                              : history[s.id].length === 0 ? <div className="text-[var(--muted)]">No changes recorded yet — current MRP is {inr(s.price)}.</div>
                              : (
                                <table className="w-full max-w-lg">
                                  <thead><tr className="text-left text-[10px] uppercase text-[var(--muted)]"><th className="py-1">MRP</th><th>Effective</th><th>By</th><th>Note</th></tr></thead>
                                  <tbody>
                                    {history[s.id].map((h, i) => (
                                      <tr key={h.id} className={i === 0 ? "font-bold text-[var(--accent-2)]" : ""}>
                                        <td className="py-0.5 tabular-nums">{inr(h.mrp)}{i === 0 ? " ← live" : ""}</td>
                                        <td>{h.effective_at}</td><td>{h.created_by || "—"}</td><td className="text-[var(--muted)]">{h.note || "—"}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        {editable && <p className="border-t border-[var(--border)] p-3 text-xs text-[var(--muted)]">Click a <b>Current MRP</b> to set a new one — it becomes the live MRP everywhere (labels, QR, new sales orders, invoices, stock value). Existing orders/invoices keep the MRP they were booked at.</p>}
      </section>
    </div>
  );
}
