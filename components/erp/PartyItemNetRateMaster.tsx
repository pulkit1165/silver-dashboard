"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import type { PartyItemRow, PartyItemHistoryRow } from "@/lib/erp/party-masters";

type Customer = { id: number; code: string; name: string };
type ParsedRow = { party: string; sku_code: string; net_rate: number };

const norm = (s: unknown) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
const PARTY_KEYS = ["party", "partyname", "customer", "customername", "partycode", "code", "acntdesc"];
const CODE_KEYS = ["skucode", "itemcode", "code", "item", "sku", "partno"];
const RATE_KEYS = ["netrate", "net_rate", "rate", "netprice", "price", "amount"];
const numify = (v: unknown) => Number(String(v ?? "").replace(/[₹,\s]/g, ""));

function parseSheet(json: Record<string, unknown>[]): ParsedRow[] {
  return json.map((r) => {
    const keys = Object.keys(r);
    // party: prefer a code column, else a name column
    const partyCodeK = keys.find((k) => ["partycode", "code", "customercode"].includes(norm(k)) && !["skucode", "itemcode"].includes(norm(k)));
    const partyNameK = keys.find((k) => ["party", "partyname", "customer", "customername", "acntdesc"].includes(norm(k)));
    const codeK = keys.find((k) => CODE_KEYS.includes(norm(k)) && k !== partyCodeK);
    const rateK = keys.find((k) => RATE_KEYS.includes(norm(k)));
    const party = partyCodeK ? String(r[partyCodeK]).trim() : partyNameK ? String(r[partyNameK]).trim() : "";
    return { party, sku_code: codeK ? String(r[codeK]).trim() : "", net_rate: rateK ? numify(r[rateK]) : NaN };
  }).filter((x) => x.party && x.sku_code && Number.isFinite(x.net_rate) && x.net_rate >= 0);
}
function todayStr() {
  const d = new Date(); const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const discOff = (mrp: number, net: number) => (mrp > 0 && net >= 0 ? `${(((mrp - net) / mrp) * 100).toFixed(1)}%` : "—");

export default function PartyItemNetRateMaster({
  customers, rows: initialRows, partyId, itemSearch, editable,
}: {
  customers: Customer[]; rows: PartyItemRow[]; partyId?: number; itemSearch: string; editable: boolean;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<PartyItemRow[]>(initialRows);
  useEffect(() => { setRows(initialRows); }, [initialRows]);

  const [edit, setEdit] = useState<Record<number, { value: string; busy: boolean; err: string | null }>>({});
  const [openId, setOpenId] = useState<number | null>(null);
  const [history, setHistory] = useState<Record<number, PartyItemHistoryRow[]>>({});

  const [effDate, setEffDate] = useState("");
  const [note, setNote] = useState("");
  useEffect(() => { setEffDate(todayStr()); }, []);
  const [search, setSearch] = useState(itemSearch);

  // add-row
  const [addCode, setAddCode] = useState("");
  const [addRate, setAddRate] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  const [addMsg, setAddMsg] = useState<string | null>(null);

  // bulk
  const [showBulk, setShowBulk] = useState(!partyId);
  const [parsed, setParsed] = useState<ParsedRow[]>([]);
  const [pasteText, setPasteText] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMsg, setBulkMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const party = customers.find((c) => c.id === partyId);
  const base = "/api/erp/masters/party-item-net-rate";

  function goParty(id: string) {
    const p = new URLSearchParams();
    if (id) p.set("party", id);
    if (search.trim()) p.set("q", search.trim());
    router.push(`/erp/masters/party-item-net-rate${p.toString() ? `?${p}` : ""}`);
  }
  function goSearch() {
    const p = new URLSearchParams();
    if (partyId) p.set("party", String(partyId));
    if (search.trim()) p.set("q", search.trim());
    router.push(`/erp/masters/party-item-net-rate${p.toString() ? `?${p}` : ""}`);
  }

  function startEdit(r: PartyItemRow) {
    setEdit((e) => ({ ...e, [r.sku_id]: { value: String(Number(r.net_rate).toFixed(2)), busy: false, err: null } }));
  }
  async function saveRate(row: PartyItemRow) {
    const st = edit[row.sku_id]; if (!st) return;
    const num = Number(st.value);
    if (!Number.isFinite(num) || num < 0) { setEdit((e) => ({ ...e, [row.sku_id]: { ...st, err: "Invalid" } })); return; }
    setEdit((e) => ({ ...e, [row.sku_id]: { ...st, busy: true, err: null } }));
    try {
      const r = await fetch(base, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ customer_id: partyId, sku_id: row.sku_id, net_rate: num, effective_at: effDate || undefined, note: note || undefined }),
      });
      const d = await r.json();
      if (d.ok) {
        const when = effDate || todayStr();
        setRows((rs) => rs.map((x) => x.sku_id === row.sku_id
          ? { ...x, net_rate: num, prev_rate: x.net_rate, last_at: when, last_by: "you", change_count: x.change_count + 1 } : x));
        setEdit((e) => { const n = { ...e }; delete n[row.sku_id]; return n; });
        setHistory((h) => { const n = { ...h }; delete n[row.sku_id]; return n; });
      } else setEdit((e) => ({ ...e, [row.sku_id]: { ...st, busy: false, err: d.error ?? "Failed" } }));
    } catch { setEdit((e) => ({ ...e, [row.sku_id]: { ...st, busy: false, err: "Network error" } })); }
  }
  async function toggleHistory(skuId: number) {
    if (openId === skuId) { setOpenId(null); return; }
    setOpenId(skuId);
    if (!history[skuId]) {
      try { const r = await fetch(`${base}?customer_id=${partyId}&sku_id=${skuId}`); const d = await r.json(); if (d.ok) setHistory((h) => ({ ...h, [skuId]: d.history })); } catch { /* ignore */ }
    }
  }
  async function addRow() {
    if (!partyId || !addCode.trim() || !Number.isFinite(Number(addRate))) return;
    setAddBusy(true); setAddMsg(null);
    try {
      const r = await fetch(base, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ customer_id: partyId, sku_code: addCode.trim(), net_rate: Number(addRate), effective_at: effDate || undefined, note: note || undefined }),
      });
      const d = await r.json();
      if (d.ok) { setAddCode(""); setAddRate(""); setAddMsg("✓ Added — refreshing…"); router.refresh(); }
      else setAddMsg(`✕ ${d.error ?? "Failed"}`);
    } catch { setAddMsg("✕ Network error"); } finally { setAddBusy(false); }
  }

  async function onFile(file: File) {
    setBulkMsg(null);
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const json = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" }) as Record<string, unknown>[];
      const out = parseSheet(json);
      setParsed(out);
      if (!out.length) setBulkMsg({ ok: false, text: "No usable rows — need party, item code (sku_code), and net rate columns." });
    } catch { setBulkMsg({ ok: false, text: "Could not read that file." }); }
  }
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
        setBulkMsg({ ok: d.applied > 0, text: `Loaded ${d.applied} party-item rate(s)${d.failed ? ` · ${d.failed} skipped (${(d.errors || []).slice(0, 3).join("; ")})` : ""}.` });
        setParsed([]); setPasteText(""); router.refresh();
      } else setBulkMsg({ ok: false, text: d.error ?? "Bulk load failed." });
    } catch { setBulkMsg({ ok: false, text: "Network error" }); }
    finally { setBulkBusy(false); }
  }

  const selCls = "rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm";
  const inr = (n: number | null | undefined) => (n == null ? "—" : `₹${Number(n).toFixed(2)}`);

  return (
    <div className="flex flex-col gap-4">
      <section className="panel p-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-[220px] flex-col gap-1 text-xs font-semibold text-[var(--muted)]">
            Party
            <select value={partyId ?? ""} onChange={(e) => goParty(e.target.value)} className={selCls}>
              <option value="">— select a party —</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}{c.code ? ` (${c.code})` : ""}</option>)}
            </select>
          </label>
          <label className="flex min-w-[180px] flex-col gap-1 text-xs font-semibold text-[var(--muted)]">
            Item search
            <input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") goSearch(); }}
              placeholder="Item code or name…" className={selCls} />
          </label>
          <button onClick={goSearch} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-bold hover:bg-[var(--surface-2)]">Apply</button>
          {editable && (
            <>
              <div className="hidden h-8 w-px bg-[var(--border)] sm:block" />
              <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--muted)]" title="Auto-set to today; change to backdate.">
                📅 Change date <span className="font-normal">(auto)</span>
                <input type="date" value={effDate} onChange={(e) => setEffDate(e.target.value)} className={selCls} />
              </label>
              <label className="flex min-w-[160px] flex-1 flex-col gap-1 text-xs font-semibold text-[var(--muted)]">
                Note <span className="font-normal">(optional)</span>
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Jul-2026 party rate list" className={selCls} />
              </label>
            </>
          )}
        </div>
      </section>

      {editable && (
        <section className="panel">
          <button onClick={() => setShowBulk((s) => !s)} className="flex w-full items-center justify-between px-4 py-3 text-left">
            <span className="text-sm font-extrabold">⬆ Bulk load party-item net rates (Excel / the deduped sheet)</span>
            <span className="text-xs font-semibold text-[var(--muted)]">{showBulk ? "Hide" : "Show"}</span>
          </button>
          {showBulk && (
            <div className="border-t border-[var(--border)] p-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <div className="mb-1 text-xs font-bold uppercase text-[var(--muted)]">Upload a file</div>
                  <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
                    className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-[var(--accent)] file:px-3 file:py-2 file:text-sm file:font-bold file:text-white" />
                  <p className="mt-1 text-xs text-[var(--muted)]">Needs <b>party</b> (name or code), <b>sku_code</b> (item code) and <b>net_rate</b> columns. Loads every party in the file at once.</p>
                </div>
                <div className="flex items-end">
                  <button onClick={applyBulk} disabled={bulkBusy || parsed.length === 0}
                    className="rounded-lg bg-[var(--accent-2)] px-5 py-2 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50">
                    {bulkBusy ? "Loading…" : `Load ${parsed.length || ""} rate${parsed.length === 1 ? "" : "s"}`}
                  </button>
                  {parsed.length > 0 && <span className="ml-3 self-center text-xs text-[var(--muted)]"><b>{parsed.length}</b> rows ready</span>}
                </div>
              </div>
              {bulkMsg && <p className={`mt-2 text-sm font-bold ${bulkMsg.ok ? "text-[var(--accent-2)]" : "text-[var(--danger)]"}`}>{bulkMsg.ok ? "✓ " : "✕ "}{bulkMsg.text}</p>}
            </div>
          )}
        </section>
      )}

      {!partyId ? (
        <section className="panel p-6 text-center text-sm text-[var(--muted)]">
          Select a party above to view and edit its item net rates — or use <b>Bulk load</b> to import the whole sheet across all parties.
        </section>
      ) : (
        <section className="panel">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-xs font-semibold text-[var(--muted)]">
            <span>{party?.name} — {rows.length} item rate(s){itemSearch ? ` matching “${itemSearch}”` : ""}</span>
            <span className="text-[var(--muted-2)]">Party-item rate wins over the global item net rate for this party.</span>
          </div>

          {editable && (
            <div className="flex flex-wrap items-end gap-2 border-t border-[var(--border)] bg-[var(--surface-2)] px-4 py-3">
              <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--muted)]">Add item (SKU code)
                <input value={addCode} onChange={(e) => setAddCode(e.target.value)} placeholder="e.g. HH12006" className={selCls} />
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--muted)]">Net rate ₹
                <input type="number" step="0.01" value={addRate} onChange={(e) => setAddRate(e.target.value)} placeholder="0.00" className={`${selCls} w-28`} />
              </label>
              <button onClick={addRow} disabled={addBusy || !addCode.trim() || !addRate}
                className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white hover:bg-[var(--accent-strong)] disabled:opacity-50">
                {addBusy ? "Adding…" : "+ Add rate"}
              </button>
              {addMsg && <span className={`self-center text-xs font-bold ${addMsg.startsWith("✓") ? "text-[var(--accent-2)]" : "text-[var(--danger)]"}`}>{addMsg}</span>}
            </div>
          )}

          <div className="overflow-x-auto border-t border-[var(--border)]">
            <table className="rtable">
              <thead>
                <tr><th>Code</th><th>Item</th><th className="!text-right">MRP</th>
                  <th className="!text-right">Net rate (live)</th><th className="!text-right">Previous</th>
                  <th className="!text-right">Disc off MRP</th><th>Date changed</th><th>By</th><th></th></tr>
              </thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={9} className="!py-6 text-center text-[var(--muted)]">No item rates yet for this party. Add one above or bulk-load the sheet.</td></tr>}
                {rows.map((r) => {
                  const st = edit[r.sku_id];
                  return (
                    <Fragment key={r.sku_id}>
                      <tr>
                        <td className="font-mono text-xs">{r.sku_code}</td>
                        <td className="font-semibold">{r.item}<div className="text-[10px] font-normal text-[var(--muted)]">{r.category}</div></td>
                        <td className="num-cell text-[var(--muted)]">{Number(r.mrp).toFixed(2)}</td>
                        <td className="num-cell">
                          {editable && st ? (
                            <span className="inline-flex items-center gap-1">
                              <input type="number" step="0.01" autoFocus value={st.value}
                                onChange={(e) => setEdit((ed) => ({ ...ed, [r.sku_id]: { ...st, value: e.target.value } }))}
                                onKeyDown={(e) => { if (e.key === "Enter") saveRate(r); if (e.key === "Escape") setEdit((ed) => { const n = { ...ed }; delete n[r.sku_id]; return n; }); }}
                                onBlur={() => saveRate(r)} disabled={st.busy}
                                className="w-24 rounded border border-[var(--accent)] bg-[var(--surface)] px-2 py-1 text-right text-sm outline-none" />
                              {st.err && <span className="text-xs font-semibold text-[var(--danger)]">{st.err}</span>}
                            </span>
                          ) : editable ? (
                            <button type="button" onClick={() => startEdit(r)} className="rounded px-2 py-1 text-right font-bold tabular-nums hover:bg-[var(--surface-2)]">
                              {Number(r.net_rate).toFixed(2)}
                            </button>
                          ) : <span className="font-bold tabular-nums">{Number(r.net_rate).toFixed(2)}</span>}
                        </td>
                        <td className="num-cell text-[var(--muted)]">{r.prev_rate != null ? Number(r.prev_rate).toFixed(2) : "—"}</td>
                        <td className="num-cell text-xs text-[var(--muted)]">{discOff(Number(r.mrp), Number(r.net_rate))}</td>
                        <td className="whitespace-nowrap text-xs text-[var(--muted)]">{r.last_at ?? <span className="italic">—</span>}</td>
                        <td className="text-xs text-[var(--muted)]">{r.last_by || "—"}</td>
                        <td className="text-right">
                          <button onClick={() => toggleHistory(r.sku_id)} title="Rate history"
                            className="rounded px-2 py-1 text-xs font-bold text-[var(--accent-strong)] hover:bg-[var(--accent-bg)]">🕑 {r.change_count > 0 ? r.change_count : ""}</button>
                        </td>
                      </tr>
                      {openId === r.sku_id && (
                        <tr><td colSpan={9} className="bg-[var(--surface-2)]">
                          <div className="p-2 text-xs">
                            <div className="mb-1 font-bold text-[var(--muted)]">Rate history — {party?.name} · {r.sku_code} (most recent first)</div>
                            {!history[r.sku_id] ? <div className="text-[var(--muted)]">Loading…</div>
                              : history[r.sku_id].length === 0 ? <div className="text-[var(--muted)]">No history.</div>
                              : (
                                <table className="w-full max-w-xl">
                                  <thead><tr className="text-left text-[10px] uppercase text-[var(--muted)]"><th className="py-1">Net rate</th><th>Date</th><th>By</th><th>Note</th></tr></thead>
                                  <tbody>
                                    {history[r.sku_id].map((h, i) => (
                                      <tr key={h.id} className={i === 0 ? "font-bold text-[var(--accent-2)]" : ""}>
                                        <td className="py-0.5 tabular-nums">{inr(h.net_rate)}{i === 0 ? " ← live" : ""}</td>
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
        </section>
      )}
    </div>
  );
}
