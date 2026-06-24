"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildSlipItems, casesLabel, fmtDate, num,
  type SlipDoc, type SlipMeta,
} from "@/lib/erp/packing-slip-format";

/**
 * Read-only "big screen" mirror of a packing slip. Open this on a laptop/TV while
 * someone scans on a phone — it auto-follows the slip being worked on and refreshes
 * about once a second, so each scan pops up here live. It never writes, so it can't
 * clobber the scanner's work.
 */
export default function PackingSlipLive() {
  const [slips, setSlips] = useState<SlipMeta[]>([]);
  const [selId, setSelId] = useState<number | null>(null);
  const [auto, setAuto] = useState(true);
  const [doc, setDoc] = useState<SlipDoc | null>(null);
  const [meta, setMeta] = useState<{ slipNo: string; updatedBy: string | null } | null>(null);
  const [online, setOnline] = useState(true);
  const [pulse, setPulse] = useState(0); // bumps whenever the doc actually changes (flash effect)

  const selRef = useRef<number | null>(null);
  const autoRef = useRef(true);
  const atRef = useRef<string | null>(null);
  useEffect(() => { selRef.current = selId; }, [selId]);
  useEffect(() => { autoRef.current = auto; }, [auto]);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const lr = await fetch("/api/erp/packing-slips", { cache: "no-store" });
        const ld = await lr.json();
        const list: SlipMeta[] = ld.slips || [];
        setSlips(list);
        setOnline(true);

        // auto-follow the most recently updated slip (list is ordered updated_at DESC)
        let id = selRef.current;
        if (autoRef.current && list.length) id = list[0].id;
        if (id !== selRef.current) { selRef.current = id; setSelId(id); atRef.current = null; }

        if (id) {
          const r = await fetch(`/api/erp/packing-slips/${id}`, { cache: "no-store" });
          const d = await r.json();
          if (d.ok && d.slip.updated_at !== atRef.current) {
            atRef.current = d.slip.updated_at;
            setDoc(d.slip.data as SlipDoc);
            setMeta({ slipNo: d.slip.slip_no, updatedBy: d.slip.updated_by });
            setPulse((p) => p + 1);
          }
        } else {
          setDoc(null); setMeta(null);
        }
      } catch { setOnline(false); }
      if (!stop) timer = setTimeout(tick, 1000);
    };
    tick();
    return () => { stop = true; clearTimeout(timer); };
  }, []);

  const hdr = doc?.hdr;
  const completed = useMemo(() => doc?.completed || [], [doc]);
  const activeRows = doc?.activeRows || [];
  const activeCaseNo = doc?.activeCaseNo ?? null;
  const items = useMemo(() => buildSlipItems(completed), [completed]);
  const totalQty = useMemo(() => items.reduce((a, it) => a + it.qty, 0), [items]);
  const totalBox = completed.length + (activeCaseNo && activeRows.length ? 1 : 0);
  const lastRow = activeRows[activeRows.length - 1];

  function pick(v: string) {
    if (v === "auto") { setAuto(true); return; }
    setAuto(false); const id = Number(v); setSelId(id); selRef.current = id; atRef.current = null;
  }

  return (
    <div className="flex flex-col gap-4">
      {/* control bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
        <span className={`flex items-center gap-2 rounded-full px-3 py-1 text-xs font-extrabold uppercase tracking-wider ${online ? "bg-[var(--accent-2-bg)] text-[var(--accent-2)]" : "bg-[var(--danger-bg)] text-[var(--danger)]"}`}>
          <span className={`h-2 w-2 rounded-full ${online ? "animate-pulse bg-[var(--accent-2)]" : "bg-[var(--muted-2)]"}`} />
          {online ? "Live" : "Offline"}
        </span>
        <label className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">Showing</label>
        <select className="ctl !w-auto" value={auto ? "auto" : String(selId ?? "")} onChange={(e) => pick(e.target.value)}>
          <option value="auto">⭐ Auto — follow latest scan</option>
          {slips.map((s) => <option key={s.id} value={s.id}>{s.slip_no} · {s.party || "—"}</option>)}
        </select>
        {meta && <span className="text-xs font-semibold text-[var(--muted)]">{meta.slipNo}{meta.updatedBy ? ` · last by ${meta.updatedBy}` : ""}</span>}
        <span className="ml-auto text-xs text-[var(--muted)]">Open on a big screen; scans appear here automatically.</span>
      </div>

      {!doc && (
        <div className="rounded-xl border border-dashed border-[var(--border)] p-10 text-center text-[var(--muted)]">
          Waiting for a packing slip… Start scanning on the phone (make sure a <b>Packing Slip No.</b> is entered so it shares live).
        </div>
      )}

      {doc && (
        <>
          {/* header / totals */}
          <section className="panel">
            <div className="panel-hd justify-between"><span>Packing Slip</span><span className="font-mono text-[var(--muted)]">{hdr?.billNo || hdr?.slipNo}</span></div>
            <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-5">
              <Info label="Bill No" value={hdr?.billNo || hdr?.slipNo || "—"} />
              <Info label="Bill Date" value={fmtDate(hdr?.date || "") || "—"} />
              <Info label="Party" value={hdr?.partyName || "—"} />
              <Info label="Total Box" value={String(totalBox)} big />
              <Info label="Total Qty" value={String(totalQty)} big />
            </div>
          </section>

          {/* active case being scanned */}
          <section className="panel" key={pulse % 2 /* re-key to retrigger flash */}>
            <div className="panel-hd justify-between">
              <span>{activeCaseNo ? `Scanning — Case ${activeCaseNo}` : "No case open right now"}</span>
              {activeCaseNo && <span className="rounded-full bg-[var(--accent-bg)] px-3 py-1 text-xs font-extrabold text-[var(--accent-strong)]">{activeRows.length} item(s)</span>}
            </div>
            <div className="p-4">
              {activeCaseNo && lastRow && (
                <div className="mb-4 animate-[fadeIn_0.4s_ease] rounded-xl border-2 border-[var(--accent)] bg-[var(--accent-bg)] p-4">
                  <div className="text-xs font-bold uppercase tracking-wide text-[var(--accent-strong)]">Last scanned</div>
                  <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                    <span className="text-2xl font-extrabold tabular-nums">{lastRow.itemCode || "—"}</span>
                    <span className="text-lg text-[var(--text)]">{lastRow.itemDesc || ""}</span>
                    <span className="ml-auto text-2xl font-extrabold tabular-nums">× {num(lastRow.quantity) || num(lastRow.pcs) || "—"}</span>
                  </div>
                </div>
              )}
              {activeCaseNo ? (
                <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
                  <table className="rtable" style={{ minWidth: "640px" }}>
                    <thead><tr><th>#</th><th>Item Code</th><th>Item Description</th><th className="!text-right">MRP</th><th className="!text-right">Qty</th></tr></thead>
                    <tbody>
                      {activeRows.length === 0 && <tr><td colSpan={5} className="!py-6 text-center text-[var(--muted)]">No items scanned into this case yet.</td></tr>}
                      {activeRows.map((r, i) => (
                        <tr key={r.id} className={i === activeRows.length - 1 ? "bg-[var(--accent-bg)] font-bold" : ""}>
                          <td className="text-[var(--muted)]">{i + 1}</td>
                          <td className="font-semibold">{r.itemCode || "—"}</td>
                          <td>{r.itemDesc || "—"}</td>
                          <td className="text-right tabular-nums">{r.mrp ? num(r.mrp).toFixed(2) : "—"}</td>
                          <td className="text-right tabular-nums">{num(r.quantity) || num(r.pcs) || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-[var(--muted)]">The scanner hasn’t opened a case. Completed cases are shown below.</p>
              )}
            </div>
          </section>

          {/* full item-wise slip so far */}
          <section className="panel">
            <div className="panel-hd justify-between"><span>Packed so far — {items.length} item(s) across {completed.length} case(s)</span></div>
            <div className="p-4">
              {items.length === 0 ? (
                <p className="text-sm text-[var(--muted)]">No cases closed yet.</p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
                  <table className="rtable" style={{ minWidth: "820px" }}>
                    <thead><tr><th>Sr No</th><th>Item Code</th><th>Item Description</th><th className="!text-right">L.MRP</th><th className="!text-center">Case No</th><th className="!text-right">Quantity</th></tr></thead>
                    <tbody>
                      {items.map((it, i) => (
                        <tr key={it.code}>
                          <td className="text-[var(--muted)]">{i + 1}</td>
                          <td className="font-semibold">{it.code}</td>
                          <td>{it.desc || "—"}</td>
                          <td className="text-right tabular-nums">{it.mrp ? num(it.mrp).toFixed(2) : "—"}</td>
                          <td className="text-center tabular-nums">{casesLabel(it.cases)}</td>
                          <td className="text-right tabular-nums">{it.qty}</td>
                        </tr>
                      ))}
                      <tr className="font-extrabold"><td colSpan={5} className="!text-right">TOTAL</td><td className="text-right tabular-nums">{totalQty}</td></tr>
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function Info({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2">
      <div className="text-[10px] font-bold uppercase text-[var(--muted-2)]">{label}</div>
      <div className={`font-extrabold tabular-nums ${big ? "text-2xl" : "truncate text-base"}`}>{value}</div>
    </div>
  );
}
