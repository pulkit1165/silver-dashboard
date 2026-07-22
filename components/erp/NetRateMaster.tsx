"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import type { NetRateRow, NetRateHistoryRow } from "@/lib/erp/pricing-masters";

type ParsedRow = { sku_code: string; net_rate: number };
const norm = (s: unknown) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
const CODE_KEYS = ["skucode", "code", "itemcode", "item", "sku", "partno", "partcode"];
const RATE_KEYS = ["netrate", "net_rate", "rate", "itemnetrate", "netprice", "price"];
const numify = (v: unknown) => Number(String(v ?? "").replace(/[₹,\s]/g, ""));

function parseSheet(json: Record<string, unknown>[]): ParsedRow[] {
  return json.map((r) => {
    const keys = Object.keys(r);
    const codeK = keys.find((k) => CODE_KEYS.includes(norm(k)));
    const rateK = keys.find((k) => RATE_KEYS.includes(norm(k)));
    return { sku_code: codeK ? String(r[codeK]).trim() : "", net_rate: rateK ? numify(r[rateK]) : NaN };
  }).filter((x) => x.sku_code && Number.isFinite(x.net_rate) && x.net_rate >= 0);
}
function parsePaste(text: string): ParsedRow[] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const parts = l.split(/[\t,;]/).map((s) => s.trim());
    return { sku_code: parts[0] ?? "", net_rate: numify(parts[1]) };
  }).filter((x) => x.sku_code && Number.isFinite(x.net_rate) && x.net_rate >= 0);
}
function todayStr(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const discOff = (mrp: number, net: number) => (mrp > 0 && net >= 0 ? `${(((mrp - net) / mrp) * 100).toFixed(1)}%` : "—");

export default function NetRateMaster({ rows: initialRows, editable }: { rows: NetRateRow[]; editable: boolean }) {
  const router = useRouter();
  const [rows, setRows] = useState<NetRateRow[]>(initialRows);
  const [edit, setEdit] = useState<Record<number, { value: string; busy: boolean; err: string | null }>>({});
  const [openId, setOpenId] = useState<number | null>(null);
  const [history, setHistory] = useState<Record<number, NetRateHistoryRow[]>>({});

  const [effDate, setEffDate] = useState("");
  const [note, setNote] = useState("");
  useEffect(() => { setEffDate(todayStr()); }, []);

  const [status, setStatus] = useState<"all" | "set" | "none">("all");
  const [cat, setCat] = useState("all");
  const [sort, setSort] = useState<"code" | "rate_desc" | "rate_asc" | "recent">("code");
  const [quick, setQuick] = useState("");

  const [showBulk, setShowBulk] = useState(false);
  const [parsed, setParsed] = useState<ParsedRow[]>([]);
  const [pasteText, setPasteText] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMsg, setBulkMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const categories = useMemo(() => Array.from(new Set(rows.map((r) => r.category).filter(Boolean))).sort(), [rows]);
  const view = useMemo(() => {
    let v = rows;
    if (status === "set") v = v.filter((r) => Number(r.net_rate) > 0);
    else if (status === "none") v = v.filter((r) => !(Number(r.net_rate) > 0));
    if (cat !== "all") v = v.filter((r) => r.category === cat);
    if (quick.trim()) {
      const q = quick.trim().toLowerCase();
      v = v.filter((r) => r.sku_code.toLowerCase().includes(q) || r.name.toLowerCase().includes(q));
    }
    const s = [...v];
    if (sort === "rate_desc") s.sort((a, b) => Number(b.net_rate) - Number(a.net_rate));
    else if (sort === "rate_asc") s.sort((a, b) => Number(a.net_rate) - Number(b.net_rate));
    else if (sort === "recent") s.sort((a, b) => String(b.last_net_rate_at ?? "").localeCompare(String(a.last_net_rate_at ?? "")));
    else s.sort((a, b) => a.sku_code.localeCompare(b.sku_code));
    return s;
  }, [rows, status, cat, quick, sort]);

  function startEdit(r: NetRateRow) {
    setEdit((e) => ({ ...e, [r.id]: { value: String(Number(r.net_rate).toFixed(2)), busy: false, err: null } }));
  }
  async function saveRate(id: number) {
    const st = edit[id];
    if (!st) return;
    const num = Number(st.value);
    if (!Number.isFinite(num) || num < 0) { setEdit((e) => ({ ...e, [id]: { ...st, err: "Invalid" } })); return; }
    setEdit((e) => ({ ...e, [id]: { ...st, busy: true, err: null } }));
    try {
      const r = await fetch(`/api/erp/skus/${id}/net-rate`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ net_rate: num, effective_at: effDate || undefined, note: note || undefined }),
      });
      const d = await r.json();
      if (d.ok) {
        const when = effDate || todayStr();
        setRows((rs) => rs.map((row) => row.id === id
          ? { ...row, net_rate: d.sku.net_rate, last_net_rate: d.sku.net_rate, prev_net_rate: row.last_net_rate ?? (row.net_rate || null), last_net_rate_at: when, last_net_rate_by: "you", change_count: row.change_count + 1 }
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
      try { const r = await fetch(`/api/erp/skus/${id}/net-rate`); const d = await r.json(); if (d.ok) setHistory((h) => ({ ...h, [id]: d.history })); } catch { /* ignore */ }
    }
  }

  async function onFile(file: File) {
    setBulkMsg(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const json = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" }) as Record<string, unknown>[];
      const out = parseSheet(json);
      setParsed(out);
      if (!out.length) setBulkMsg({ ok: false, text: "No usable rows — need columns like 'sku_code' and 'net_rate'." });
    } catch { setBulkMsg({ ok: false, text: "Could not read that file." }); }
  }
  function onPaste(text: string) { setPasteText(text); setParsed(parsePaste(text)); }

  async function applyBulk() {
    if (!parsed.length) return;
    setBulkBusy(true); setBulkMsg(null);
    try {
      const r = await fetch("/api/erp/masters/net-rate/bulk", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ updates: parsed, effective_at: effDate || undefined, note: note || undefined }),
      });
      const d = await r.json();
      if (d.ok) {
        setBulkMsg({ ok: d.applied > 0, text: `Applied ${d.applied} net-rate update(s)${d.failed ? ` · ${d.failed} skipped (${(d.errors || []).slice(0, 3).join("; ")})` : ""}.` });
        setParsed([]); setPasteText("");
        router.refresh();
      } else setBulkMsg({ ok: false, text: d.error ?? "Bulk update failed." });
    } catch { setBulkMsg({ ok: false, text: "Network error" }); }
    finally { setBulkBusy(false); }
  }

  const inr = (n: number | null | undefined) => (n == null ? "—" : `₹${Number(n).toFixed(2)}`);
  const selCls = "rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm";

  return (
    <div className="flex flex-col gap-4">
      <section className="panel p-3">
        <div className="flex flex-wrap items-end gap-3">
          {editable && (
            <>
              <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--muted)]" title="Auto-set to today; change it to backdate a rate.">
                📅 Change date <span className="font-normal">(auto)</span>
                <input type="date" value={effDate} onChange={(e) => setEffDate(e.target.value)} className={selCls} />
              </label>
              <label className="flex min-w-[180px] flex-1 flex-col gap-1 text-xs font-semibold text-[var(--muted)]">
                Note <span className="font-normal">(optional)</span>
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Jul-2026 net rate list" className={selCls} />
              </label>
              <div className="hidden h-8 w-px bg-[var(--border)] sm:block" />
            </>
          )}
          <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--muted)]">
            Filter
            <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className={selCls}>
              <option value="all">All items</option>
              <option value="set">Has net rate</option>
              <option value="none">No net rate</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--muted)]">
            Category
            <select value={cat} onChange={(e) => setCat(e.target.value)} className={selCls}>
              <option value="all">All categories</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--muted)]">
            Sort by
            <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className={selCls}>
              <option value="code">Code</option>
              <option value="recent">Recently changed</option>
              <option value="rate_desc">Net rate high → low</option>
              <option value="rate_asc">Net rate low → high</option>
            </select>
          </label>
          <label className="flex min-w-[160px] flex-1 flex-col gap-1 text-xs font-semibold text-[var(--muted)]">
            Quick filter
            <input value={quick} onChange={(e) => setQuick(e.target.value)} placeholder="Filter loaded rows…" className={selCls} />
          </label>
        </div>
      </section>

      {editable && (
        <section className="panel">
          <button onClick={() => setShowBulk((s) => !s)} className="flex w-full items-center justify-between px-4 py-3 text-left">
            <span className="text-sm font-extrabold">⬆ Bulk update item net rate (Excel / paste)</span>
            <span className="text-xs font-semibold text-[var(--muted)]">{showBulk ? "Hide" : "Show"}</span>
          </button>
          {showBulk && (
            <div className="border-t border-[var(--border)] p-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <div className="mb-1 text-xs font-bold uppercase text-[var(--muted)]">Upload a file</div>
                  <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
                    className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-[var(--accent)] file:px-3 file:py-2 file:text-sm file:font-bold file:text-white" />
                  <p className="mt-1 text-xs text-[var(--muted)]">Needs an <b>sku_code</b> column and a <b>net_rate</b> column. A rate of <b>0</b> clears the override (party discount resumes).</p>
                </div>
                <div>
                  <div className="mb-1 text-xs font-bold uppercase text-[var(--muted)]">…or paste rows</div>
                  <textarea value={pasteText} onChange={(e) => onPaste(e.target.value)} rows={4}
                    placeholder={"HH12006, 186.5\nHH74007\t95\nHS74009, 55"}
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 font-mono text-xs outline-none focus:border-[var(--accent)]" />
                  <p className="mt-1 text-xs text-[var(--muted)]">One per line: <b>SKU code</b>, then <b>net rate</b> (comma or tab separated). Uses the <b>date</b> + <b>note</b> above.</p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button onClick={applyBulk} disabled={bulkBusy || parsed.length === 0}
                  className="rounded-lg bg-[var(--accent-2)] px-5 py-2 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50">
                  {bulkBusy ? "Applying…" : `Apply ${parsed.length || ""} update${parsed.length === 1 ? "" : "s"}`}
                </button>
                {parsed.length > 0 && (
                  <span className="text-xs text-[var(--muted)]"><b>{parsed.length}</b> rows ready — e.g. {parsed.slice(0, 4).map((p) => `${p.sku_code}=₹${p.net_rate}`).join(", ")}{parsed.length > 4 ? " …" : ""}</span>
                )}
              </div>
              {bulkMsg && <p className={`mt-2 text-sm font-bold ${bulkMsg.ok ? "text-[var(--accent-2)]" : "text-[var(--danger)]"}`}>{bulkMsg.ok ? "✓ " : "✕ "}{bulkMsg.text}</p>}
            </div>
          )}
        </section>
      )}

      <section className="panel">
        <div className="flex items-center justify-between px-4 py-2 text-xs font-semibold text-[var(--muted)]">
          <span>Showing {view.length} of {rows.length} items</span>
          <span className="text-[var(--muted-2)]">Item net rate overrides the party discount % for that SKU.</span>
        </div>
        <div className="overflow-x-auto border-t border-[var(--border)]">
          <table className="rtable">
            <thead>
              <tr>
                <th>Code</th><th>Item</th>
                <th className="!text-right">MRP</th>
                <th className="!text-right">Net rate (live)</th><th className="!text-right">Previous</th>
                <th className="!text-right">Disc off MRP</th>
                <th>Date changed</th><th>By</th><th></th>
              </tr>
            </thead>
            <tbody>
              {view.length === 0 && <tr><td colSpan={9} className="!py-6 text-center text-[var(--muted)]">No items match.</td></tr>}
              {view.map((s) => {
                const st = edit[s.id];
                const hasRate = Number(s.net_rate) > 0;
                return (
                  <Fragment key={s.id}>
                    <tr>
                      <td className="font-mono text-xs">{s.sku_code}</td>
                      <td className="font-semibold">{s.name}<div className="text-[10px] font-normal text-[var(--muted)]">{s.category}</div></td>
                      <td className="num-cell text-[var(--muted)]">{Number(s.price).toFixed(2)}</td>
                      <td className="num-cell">
                        {editable && st ? (
                          <span className="inline-flex items-center gap-1">
                            <input type="number" step="0.01" autoFocus value={st.value}
                              onChange={(e) => setEdit((ed) => ({ ...ed, [s.id]: { ...st, value: e.target.value } }))}
                              onKeyDown={(e) => { if (e.key === "Enter") saveRate(s.id); if (e.key === "Escape") setEdit((ed) => { const n = { ...ed }; delete n[s.id]; return n; }); }}
                              onBlur={() => saveRate(s.id)} disabled={st.busy}
                              className="w-24 rounded border border-[var(--accent)] bg-[var(--surface)] px-2 py-1 text-right text-sm outline-none" />
                            {st.err && <span className="text-xs font-semibold text-[var(--danger)]">{st.err}</span>}
                          </span>
                        ) : editable ? (
                          <button type="button" onClick={() => startEdit(s)} title="Click to set a net rate (0 = clear)"
                            className={`rounded px-2 py-1 text-right font-bold tabular-nums hover:bg-[var(--surface-2)] ${hasRate ? "" : "text-[var(--muted-2)]"}`}>
                            {hasRate ? Number(s.net_rate).toFixed(2) : "— set —"}
                          </button>
                        ) : (
                          <span className={`font-bold tabular-nums ${hasRate ? "" : "text-[var(--muted-2)]"}`}>{hasRate ? Number(s.net_rate).toFixed(2) : "—"}</span>
                        )}
                      </td>
                      <td className="num-cell text-[var(--muted)]">{s.prev_net_rate != null ? Number(s.prev_net_rate).toFixed(2) : "—"}</td>
                      <td className="num-cell text-xs text-[var(--muted)]">{hasRate ? discOff(Number(s.price), Number(s.net_rate)) : "—"}</td>
                      <td className="whitespace-nowrap text-xs text-[var(--muted)]">{s.last_net_rate_at ? s.last_net_rate_at : <span className="italic">never</span>}</td>
                      <td className="text-xs text-[var(--muted)]">{s.last_net_rate_by || "—"}</td>
                      <td className="text-right">
                        <button onClick={() => toggleHistory(s.id)} title="Net-rate history"
                          className="rounded px-2 py-1 text-xs font-bold text-[var(--accent-strong)] hover:bg-[var(--accent-bg)]">
                          🕑 {s.change_count > 0 ? s.change_count : ""}
                        </button>
                      </td>
                    </tr>
                    {openId === s.id && (
                      <tr>
                        <td colSpan={9} className="bg-[var(--surface-2)]">
                          <div className="p-2 text-xs">
                            <div className="mb-1 font-bold text-[var(--muted)]">Net-rate history — {s.sku_code} (most recent first)</div>
                            {!history[s.id] ? <div className="text-[var(--muted)]">Loading…</div>
                              : history[s.id].length === 0 ? <div className="text-[var(--muted)]">No net rate recorded yet — this SKU uses the party discount %.</div>
                              : (
                                <table className="w-full max-w-xl">
                                  <thead><tr className="text-left text-[10px] uppercase text-[var(--muted)]"><th className="py-1">Net rate</th><th>Date</th><th>By</th><th>Note</th></tr></thead>
                                  <tbody>
                                    {history[s.id].map((h, i) => (
                                      <tr key={h.id} className={i === 0 ? "font-bold text-[var(--accent-2)]" : ""}>
                                        <td className="py-0.5 tabular-nums">{inr(h.net_rate)}{i === 0 ? " ← live" : ""}</td>
                                        <td className="whitespace-nowrap">{h.effective_at}</td><td>{h.created_by || "—"}</td><td className="text-[var(--muted)]">{h.note || "—"}</td>
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
        {editable && <p className="border-t border-[var(--border)] p-3 text-xs text-[var(--muted)]">Click a <b>Net rate</b> to set one — it stamps the <b>date</b> above and becomes the live net rate for that SKU on <b>new</b> sales orders, <b>overriding</b> the party discount %. Set it to <b>0</b> to clear the override. Existing orders keep the rate they were booked at.</p>}
      </section>
    </div>
  );
}
