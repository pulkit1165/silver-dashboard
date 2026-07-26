"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import type { PartyPctRow, PartyPctHistoryRow, PartyPctKind } from "@/lib/erp/party-masters";

type ParsedRow = { code: string; pct: number };
const norm = (s: unknown) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
const CODE_KEYS = ["code", "customercode", "partycode", "accountcode", "acode"];
const PCT_KEYS = ["pct", "percent", "discount", "disc", "ogl", "foc", "value", "rate"];
const numify = (v: unknown) => Number(String(v ?? "").replace(/[%₹,\s]/g, ""));

function parseSheet(json: Record<string, unknown>[]): ParsedRow[] {
  return json.map((r) => {
    const keys = Object.keys(r);
    const codeK = keys.find((k) => CODE_KEYS.includes(norm(k)));
    const pctK = keys.find((k) => PCT_KEYS.includes(norm(k)));
    return { code: codeK ? String(r[codeK]).trim() : "", pct: pctK ? numify(r[pctK]) : NaN };
  }).filter((x) => x.code && Number.isFinite(x.pct) && x.pct >= 0);
}
function parsePaste(text: string): ParsedRow[] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const p = l.split(/[\t,;]/).map((s) => s.trim());
    return { code: p[0] ?? "", pct: numify(p[1]) };
  }).filter((x) => x.code && Number.isFinite(x.pct) && x.pct >= 0);
}
function todayStr() {
  const d = new Date(); const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export default function PartyPctMaster({
  rows: initialRows, kind, label, editable,
}: {
  rows: PartyPctRow[]; kind: PartyPctKind; label: string; editable: boolean;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<PartyPctRow[]>(initialRows);
  useEffect(() => { setRows(initialRows); }, [initialRows]);
  const [edit, setEdit] = useState<Record<number, { value: string; busy: boolean; err: string | null }>>({});
  const [openId, setOpenId] = useState<number | null>(null);
  const [history, setHistory] = useState<Record<number, PartyPctHistoryRow[]>>({});

  const [effDate, setEffDate] = useState("");
  const [note, setNote] = useState("");
  useEffect(() => { setEffDate(todayStr()); }, []);

  const [status, setStatus] = useState<"all" | "set" | "none">("all");
  const [sort, setSort] = useState<"name" | "pct_desc" | "pct_asc" | "recent">("name");
  const [quick, setQuick] = useState("");

  const [showBulk, setShowBulk] = useState(false);
  const [parsed, setParsed] = useState<ParsedRow[]>([]);
  const [pasteText, setPasteText] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMsg, setBulkMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const base = `/api/erp/masters/party-pct/${kind}`;

  const view = useMemo(() => {
    let v = rows;
    if (status === "set") v = v.filter((r) => Number(r.pct) > 0);
    else if (status === "none") v = v.filter((r) => !(Number(r.pct) > 0));
    if (quick.trim()) {
      const q = quick.trim().toLowerCase();
      v = v.filter((r) => (r.code ?? "").toLowerCase().includes(q) || (r.name ?? "").toLowerCase().includes(q));
    }
    const s = [...v];
    if (sort === "pct_desc") s.sort((a, b) => Number(b.pct) - Number(a.pct));
    else if (sort === "pct_asc") s.sort((a, b) => Number(a.pct) - Number(b.pct));
    else if (sort === "recent") s.sort((a, b) => String(b.last_at ?? "").localeCompare(String(a.last_at ?? "")));
    else s.sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")));
    return s;
  }, [rows, status, quick, sort]);

  function startEdit(r: PartyPctRow) {
    setEdit((e) => ({ ...e, [r.id]: { value: String(Number(r.pct).toFixed(2)), busy: false, err: null } }));
  }
  async function save(id: number) {
    const st = edit[id]; if (!st) return;
    const num = Number(st.value);
    if (!Number.isFinite(num) || num < 0 || num > 100) { setEdit((e) => ({ ...e, [id]: { ...st, err: "0–100" } })); return; }
    setEdit((e) => ({ ...e, [id]: { ...st, busy: true, err: null } }));
    try {
      const r = await fetch(base, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ customer_id: id, pct: num, effective_at: effDate || undefined, note: note || undefined }),
      });
      const d = await r.json();
      if (d.ok) {
        const when = effDate || todayStr();
        setRows((rs) => rs.map((row) => row.id === id
          ? { ...row, pct: d.customer.pct, last_pct: d.customer.pct, prev_pct: row.last_pct ?? (row.pct || null), last_at: when, last_by: "you", change_count: row.change_count + 1 }
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
      try { const r = await fetch(`${base}?customer_id=${id}`); const d = await r.json(); if (d.ok) setHistory((h) => ({ ...h, [id]: d.history })); } catch { /* ignore */ }
    }
  }

  async function onFile(file: File) {
    setBulkMsg(null);
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const json = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" }) as Record<string, unknown>[];
      const out = parseSheet(json);
      setParsed(out);
      if (!out.length) setBulkMsg({ ok: false, text: "No usable rows — need a 'code' column and a '%' column." });
    } catch { setBulkMsg({ ok: false, text: "Could not read that file." }); }
  }
  function onPaste(text: string) { setPasteText(text); setParsed(parsePaste(text)); }
  async function applyBulk() {
    if (!parsed.length) return;
    setBulkBusy(true); setBulkMsg(null);
    try {
      const r = await fetch(`${base}/bulk`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ updates: parsed, effective_at: effDate || undefined, note: note || undefined }),
      });
      const d = await r.json();
      if (d.ok) {
        setBulkMsg({ ok: d.applied > 0, text: `Applied ${d.applied} update(s)${d.failed ? ` · ${d.failed} skipped (${(d.errors || []).slice(0, 3).join("; ")})` : ""}.` });
        setParsed([]); setPasteText(""); router.refresh();
      } else setBulkMsg({ ok: false, text: d.error ?? "Bulk update failed." });
    } catch { setBulkMsg({ ok: false, text: "Network error" }); }
    finally { setBulkBusy(false); }
  }

  const pctCls = "font-bold tabular-nums";
  const selCls = "rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm";
  const fmt = (n: number | null | undefined) => (n == null ? "—" : `${Number(n).toFixed(2)}%`);

  return (
    <div className="flex flex-col gap-4">
      <section className="panel p-3">
        <div className="flex flex-wrap items-end gap-3">
          {editable && (
            <>
              <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--muted)]" title="Auto-set to today; change it to backdate.">
                📅 Change date <span className="font-normal">(auto)</span>
                <input type="date" value={effDate} onChange={(e) => setEffDate(e.target.value)} className={selCls} />
              </label>
              <label className="flex min-w-[180px] flex-1 flex-col gap-1 text-xs font-semibold text-[var(--muted)]">
                Note <span className="font-normal">(optional)</span>
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={`e.g. Jul-2026 ${label} list`} className={selCls} />
              </label>
              <div className="hidden h-8 w-px bg-[var(--border)] sm:block" />
            </>
          )}
          <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--muted)]">
            Filter
            <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className={selCls}>
              <option value="all">All parties</option>
              <option value="set">Has {label}</option>
              <option value="none">No {label}</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--muted)]">
            Sort by
            <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className={selCls}>
              <option value="name">Name</option>
              <option value="recent">Recently changed</option>
              <option value="pct_desc">% high → low</option>
              <option value="pct_asc">% low → high</option>
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
            <span className="text-sm font-extrabold">⬆ Bulk update {label} (Excel / paste)</span>
            <span className="text-xs font-semibold text-[var(--muted)]">{showBulk ? "Hide" : "Show"}</span>
          </button>
          {showBulk && (
            <div className="border-t border-[var(--border)] p-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <div className="mb-1 text-xs font-bold uppercase text-[var(--muted)]">Upload a file</div>
                  <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
                    className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-[var(--accent)] file:px-3 file:py-2 file:text-sm file:font-bold file:text-white" />
                  <p className="mt-1 text-xs text-[var(--muted)]">Needs a <b>code</b> column and a <b>%</b> column.</p>
                </div>
                <div>
                  <div className="mb-1 text-xs font-bold uppercase text-[var(--muted)]">…or paste rows</div>
                  <textarea value={pasteText} onChange={(e) => onPaste(e.target.value)} rows={4}
                    placeholder={"C001, 12.5\nC002\t8"} className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 font-mono text-xs outline-none focus:border-[var(--accent)]" />
                  <p className="mt-1 text-xs text-[var(--muted)]">One per line: <b>customer code</b>, then <b>%</b>. Uses the <b>date</b> + <b>note</b> above.</p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button onClick={applyBulk} disabled={bulkBusy || parsed.length === 0}
                  className="rounded-lg bg-[var(--accent-2)] px-5 py-2 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50">
                  {bulkBusy ? "Applying…" : `Apply ${parsed.length || ""} update${parsed.length === 1 ? "" : "s"}`}
                </button>
                {parsed.length > 0 && <span className="text-xs text-[var(--muted)]"><b>{parsed.length}</b> rows ready — e.g. {parsed.slice(0, 4).map((p) => `${p.code}=${p.pct}%`).join(", ")}{parsed.length > 4 ? " …" : ""}</span>}
              </div>
              {bulkMsg && <p className={`mt-2 text-sm font-bold ${bulkMsg.ok ? "text-[var(--accent-2)]" : "text-[var(--danger)]"}`}>{bulkMsg.ok ? "✓ " : "✕ "}{bulkMsg.text}</p>}
            </div>
          )}
        </section>
      )}

      <section className="panel">
        <div className="flex items-center justify-between px-4 py-2 text-xs font-semibold text-[var(--muted)]">
          <span>Showing {view.length} of {rows.length} parties</span>
        </div>
        <div className="overflow-x-auto border-t border-[var(--border)]">
          <table className="rtable">
            <thead>
              <tr><th>Code</th><th>Customer</th><th>GST</th>
                <th className="!text-right">{label} (live)</th><th className="!text-right">Previous</th>
                <th>Date changed</th><th>By</th><th></th></tr>
            </thead>
            <tbody>
              {view.length === 0 && <tr><td colSpan={8} className="!py-6 text-center text-[var(--muted)]">No parties match.</td></tr>}
              {view.map((c) => {
                const st = edit[c.id];
                const has = Number(c.pct) > 0;
                return (
                  <Fragment key={c.id}>
                    <tr>
                      <td className="font-mono text-xs">{c.code}</td>
                      <td className="font-semibold">{c.name}</td>
                      <td className="font-mono text-xs text-[var(--muted)]">{c.gst}</td>
                      <td className="num-cell">
                        {editable && st ? (
                          <span className="inline-flex items-center gap-1">
                            <input type="number" step="0.01" autoFocus value={st.value}
                              onChange={(e) => setEdit((ed) => ({ ...ed, [c.id]: { ...st, value: e.target.value } }))}
                              onKeyDown={(e) => { if (e.key === "Enter") save(c.id); if (e.key === "Escape") setEdit((ed) => { const n = { ...ed }; delete n[c.id]; return n; }); }}
                              onBlur={() => save(c.id)} disabled={st.busy}
                              className="w-20 rounded border border-[var(--accent)] bg-[var(--surface)] px-2 py-1 text-right text-sm outline-none" />
                            {st.err && <span className="text-xs font-semibold text-[var(--danger)]">{st.err}</span>}
                          </span>
                        ) : editable ? (
                          <button type="button" onClick={() => startEdit(c)} title="Click to set"
                            className={`rounded px-2 py-1 text-right hover:bg-[var(--surface-2)] ${pctCls} ${has ? "" : "text-[var(--muted-2)]"}`}>
                            {has ? `${Number(c.pct).toFixed(2)}%` : "— set —"}
                          </button>
                        ) : (
                          <span className={`${pctCls} ${has ? "" : "text-[var(--muted-2)]"}`}>{has ? `${Number(c.pct).toFixed(2)}%` : "—"}</span>
                        )}
                      </td>
                      <td className="num-cell text-[var(--muted)]">{fmt(c.prev_pct)}</td>
                      <td className="whitespace-nowrap text-xs text-[var(--muted)]">{c.last_at ? c.last_at : <span className="italic">never</span>}</td>
                      <td className="text-xs text-[var(--muted)]">{c.last_by || "—"}</td>
                      <td className="text-right">
                        <button onClick={() => toggleHistory(c.id)} title="Change history"
                          className="rounded px-2 py-1 text-xs font-bold text-[var(--accent-strong)] hover:bg-[var(--accent-bg)]">🕑 {c.change_count > 0 ? c.change_count : ""}</button>
                      </td>
                    </tr>
                    {openId === c.id && (
                      <tr><td colSpan={8} className="bg-[var(--surface-2)]">
                        <div className="p-2 text-xs">
                          <div className="mb-1 font-bold text-[var(--muted)]">{label} history — {c.name} (most recent first)</div>
                          {!history[c.id] ? <div className="text-[var(--muted)]">Loading…</div>
                            : history[c.id].length === 0 ? <div className="text-[var(--muted)]">No value recorded yet.</div>
                            : (
                              <table className="w-full max-w-xl">
                                <thead><tr className="text-left text-[10px] uppercase text-[var(--muted)]"><th className="py-1">%</th><th>Date</th><th>By</th><th>Note</th></tr></thead>
                                <tbody>
                                  {history[c.id].map((h, i) => (
                                    <tr key={h.id} className={i === 0 ? "font-bold text-[var(--accent-2)]" : ""}>
                                      <td className="py-0.5 tabular-nums">{Number(h.pct).toFixed(2)}%{i === 0 ? " ← live" : ""}</td>
                                      <td className="whitespace-nowrap">{h.effective_at}</td><td>{h.created_by || "—"}</td><td className="text-[var(--muted)]">{h.note || "—"}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                        </div>
                      </td></tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        {editable && <p className="border-t border-[var(--border)] p-3 text-xs text-[var(--muted)]">Click a value to set it — it stamps the <b>date</b> above and becomes the live {label} for that party on <b>new</b> sales orders. Every prior value is kept.</p>}
      </section>
    </div>
  );
}
