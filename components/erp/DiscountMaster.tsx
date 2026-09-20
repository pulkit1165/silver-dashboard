"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

type Cust = { id: number; code: string; name: string; city?: string; disc_pct?: number };
type Item = {
  sku_id: number; sku_code: string; name: string; category: string; mrp: number;
  net_rate: number | null; foc_pct: number | null; is_k: boolean;
};
type PartyData = {
  customer: { id: number; code: string; name: string; disc_pct: number; ogl_pct: number; foc_pct: number };
  items: Item[];
};
type SkuHit = { id: number; sku_code: string; name: string; price?: number };

const inp = "rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-sm outline-none focus:border-[var(--accent)]";

export default function DiscountMaster({ customers, editable }: { customers: Cust[]; editable: boolean }) {
  const [tab, setTab] = useState<"party" | "global">("party");
  const [customerId, setCustomerId] = useState<number | "">("");
  const [data, setData] = useState<PartyData | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  // Party-level editable copies (the three % on top).
  const [disc, setDisc] = useState("");
  const [ogl, setOgl] = useState("");
  const [foc, setFoc] = useState("");

  const [partyFilter, setPartyFilter] = useState("");
  const filteredParties = useMemo(() => {
    const q = partyFilter.trim().toLowerCase();
    const list = !q
      ? customers
      : customers.filter((c) => `${c.name} ${c.code} ${c.city ?? ""}`.toLowerCase().includes(q));
    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  }, [customers, partyFilter]);

  const flash = useCallback((tone: "ok" | "err", text: string) => {
    setMsg({ tone, text });
    window.setTimeout(() => setMsg(null), 2500);
  }, []);

  const load = useCallback(async (cid: number) => {
    setLoading(true);
    setData(null);
    try {
      const res = await fetch(`/api/erp/masters/discount?customer_id=${cid}`);
      const d = await res.json();
      if (!d.ok) { flash("err", d.error ?? "Could not load."); return; }
      setData(d as PartyData);
      setDisc(String(d.customer.disc_pct ?? 0));
      setOgl(String(d.customer.ogl_pct ?? 0));
      setFoc(String(d.customer.foc_pct ?? 0));
    } catch (e) {
      flash("err", (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [flash]);

  function pickParty(v: number | null) {
    setCustomerId(v ?? "");
    if (v) load(v);
    else setData(null);
  }

  async function post(body: Record<string, unknown>): Promise<boolean> {
    const res = await fetch("/api/erp/masters/discount", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customer_id: customerId, ...body }),
    });
    const d = await res.json().catch(() => ({}));
    if (!d.ok) { flash("err", d.error ?? "Save failed."); return false; }
    return true;
  }

  async function savePartyPct(kind: "disc" | "ogl" | "foc", value: string) {
    if (!customerId || !editable) return;
    const pct = Number(value);
    if (!Number.isFinite(pct)) return;
    if (await post({ action: "party-pct", kind, pct })) {
      flash("ok", `Party ${kind.toUpperCase()}% saved.`);
      setData((d) => (d ? { ...d, customer: { ...d.customer, [`${kind}_pct`]: pct } } : d));
    }
  }

  async function saveItem(skuId: number, field: "net_rate" | "foc_pct", value: string) {
    if (!customerId || !editable) return;
    const num = value.trim() === "" ? null : Number(value);
    if (num == null || !Number.isFinite(num)) return; // blank = leave as-is (no delete of history)
    const action = field === "net_rate" ? "item-net-rate" : "item-foc";
    const payload = field === "net_rate" ? { net_rate: num } : { foc_pct: num };
    if (await post({ action, sku_id: skuId, ...payload })) {
      flash("ok", "Saved.");
      setData((d) => (d ? { ...d, items: d.items.map((it) => (it.sku_id === skuId ? { ...it, [field]: num } : it)) } : d));
    }
  }

  async function toggleK(skuId: number, on: boolean) {
    if (!customerId || !editable) return;
    if (await post({ action: "item-k", sku_id: skuId, on })) {
      flash("ok", on ? "Marked K." : "Unmarked K.");
      setData((d) => (d ? { ...d, items: d.items.map((it) => (it.sku_id === skuId ? { ...it, is_k: on } : it)) } : d));
    }
  }

  // Add-item search (adds a blank override row the user can fill in).
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SkuHit[]>([]);
  const [searching, setSearching] = useState(false);
  const searchRef = useRef<number | null>(null);

  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    if (searchRef.current) window.clearTimeout(searchRef.current);
    searchRef.current = window.setTimeout(async () => {
      setSearching(true);
      try {
        const r = await fetch(`/api/erp/skus?q=${encodeURIComponent(q.trim())}`);
        const d = await r.json();
        setHits((d.skus ?? []).slice(0, 20));
      } catch { setHits([]); } finally { setSearching(false); }
    }, 250);
  }, [q]);

  function addItem(hit: SkuHit) {
    setQ(""); setHits([]);
    setData((d) => {
      if (!d) return d;
      if (d.items.some((it) => it.sku_id === hit.id)) return d; // already in grid
      const row: Item = {
        sku_id: hit.id, sku_code: hit.sku_code, name: hit.name, category: "",
        mrp: Number(hit.price) || 0, net_rate: null, foc_pct: null, is_k: false,
      };
      return { ...d, items: [...d.items, row].sort((a, b) => a.sku_code.localeCompare(b.sku_code)) };
    });
  }

  return (
    <div className="flex flex-col gap-5">
      {msg && (
        <div className={`rounded-lg px-3 py-2 text-sm font-semibold ${msg.tone === "ok" ? "bg-[var(--accent-2-bg)] text-[var(--accent-2)]" : "bg-[var(--danger-bg)] text-[var(--danger)]"}`}>
          {msg.text}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2">
        <button onClick={() => setTab("party")} className={tabBtn(tab === "party")}>By Party</button>
        <button onClick={() => setTab("global")} className={tabBtn(tab === "global")}>Global Item Net Rate (all parties)</button>
      </div>

      {tab === "global" ? (
        <section className="panel">
          <div className="panel-hd">Item Net Rate — applies to ALL parties</div>
          <div className="flex flex-col gap-3 p-4 text-sm">
            <p className="text-[var(--muted)]">
              A per-item net rate charged to <b>every</b> party (unless that party has a more-specific party×item net rate here, which wins).
              This is the global fallback used across all sales orders.
            </p>
            <div className="flex flex-wrap gap-2">
              <Link href="/erp/masters/item-net-rate" className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white hover:bg-[var(--accent-strong)]">
                Open Item Net Rate master →
              </Link>
              <Link href="/erp/masters/import?master=item-net-rate" className="rounded-lg border border-[var(--border)] bg-white px-4 py-2 text-sm font-bold hover:bg-[var(--surface-2)]">
                Bulk upload (Excel)
              </Link>
            </div>
          </div>
        </section>
      ) : (
        <>
          {/* 1 · pick party — full clickable list of all parties */}
          <section className="panel">
            <div className="panel-hd flex items-center justify-between">
              <span>1 · Parties <span className="font-normal text-[var(--muted)]">({filteredParties.length})</span></span>
            </div>
            <div className="flex flex-col gap-2 p-4">
              <input
                className={`${inp} w-full max-w-md`}
                placeholder="Filter parties by name / code / city…"
                value={partyFilter}
                onChange={(e) => setPartyFilter(e.target.value)}
              />
              <div className="max-h-[380px] overflow-auto rounded-lg border border-[var(--border)]">
                {filteredParties.length === 0 ? (
                  <div className="px-3 py-4 text-sm text-[var(--muted)]">No parties match.</div>
                ) : (
                  filteredParties.map((c) => {
                    const active = c.id === customerId;
                    return (
                      <button
                        key={c.id}
                        onClick={() => pickParty(active ? null : c.id)}
                        className={`flex w-full items-center justify-between gap-3 border-b border-[var(--border)] px-3 py-2 text-left text-sm last:border-b-0 ${active ? "bg-[var(--accent-bg,rgba(220,38,38,0.08))]" : "hover:bg-[var(--surface-2)]"}`}
                      >
                        <span className="min-w-0 flex-1">
                          <span className={`block truncate font-semibold ${active ? "text-[var(--accent)]" : ""}`}>{c.name}</span>
                          <span className="block truncate text-xs text-[var(--muted)]">{[c.code, c.city].filter(Boolean).join(" · ")}</span>
                        </span>
                        <span className="shrink-0 rounded bg-[var(--surface-2)] px-2 py-0.5 text-xs font-bold tabular-nums text-[var(--muted)]">
                          {Number(c.disc_pct ?? 0)}% disc
                        </span>
                        <span className={`shrink-0 text-xs font-bold ${active ? "text-[var(--accent)]" : "text-[var(--muted)]"}`}>{active ? "▾ open" : "›"}</span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </section>

          {loading && <div className="panel p-4 text-sm text-[var(--muted)]">Loading…</div>}

          {data && (
            <>
              {/* 2 · party-level discounts */}
              <section className="panel">
                <div className="panel-hd">2 · {data.customer.name} <span className="font-mono text-xs text-[var(--muted)]">{data.customer.code}</span> — party discounts</div>
                <div className="grid gap-4 p-4 sm:grid-cols-3">
                  <PctField label="Party Disc %" value={disc} onChange={setDisc} onSave={(v) => savePartyPct("disc", v)} editable={editable} />
                  <PctField label="OGL % (K only)" value={ogl} onChange={setOgl} onSave={(v) => savePartyPct("ogl", v)} editable={editable} />
                  <PctField label="FOC % (party-wide)" value={foc} onChange={setFoc} onSave={(v) => savePartyPct("foc", v)} editable={editable} />
                </div>
                <div className="border-t border-[var(--border)] px-4 py-2 text-xs text-[var(--muted)]">
                  OGL % only applies to <b>K</b> lines. Party FOC % applies to every line unless an item has its own FOC below.
                </div>
              </section>

              {/* 3 · per-item overrides */}
              <section className="panel">
                <div className="panel-hd">3 · Items for {data.customer.name} — Net Rate · FOC · K</div>
                <div className="flex flex-col gap-3 p-4">
                  {editable && (
                    <div className="relative max-w-md">
                      <input className={`${inp} w-full`} placeholder="Add an item — type code or name…" value={q} onChange={(e) => setQ(e.target.value)} />
                      {(hits.length > 0 || searching) && (
                        <div className="absolute z-10 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-lg">
                          {searching && <div className="px-3 py-2 text-xs text-[var(--muted)]">Searching…</div>}
                          {hits.map((h) => (
                            <button key={h.id} onClick={() => addItem(h)} className="block w-full px-3 py-2 text-left text-sm hover:bg-[var(--surface-2)]">
                              <span className="font-mono text-xs">{h.sku_code}</span> · {h.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {data.items.length === 0 ? (
                    <p className="text-sm text-[var(--muted)]">No item overrides for this party yet. {editable && "Search above to add one."}</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--muted)]">
                            <th className="py-2 pr-3">Item</th>
                            <th className="px-2 text-right">MRP</th>
                            <th className="px-2 text-right">Item Net Rate</th>
                            <th className="px-2 text-right">FOC %</th>
                            <th className="px-2 text-center">K</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.items.map((it) => (
                            <tr key={it.sku_id} className="border-b border-[var(--border)]">
                              <td className="py-1.5 pr-3">
                                <span className="font-mono text-xs">{it.sku_code}</span> · {it.name}
                              </td>
                              <td className="px-2 text-right tabular-nums text-[var(--muted)]">{it.mrp ? `₹${it.mrp}` : "—"}</td>
                              <td className="px-2 text-right">
                                <NumCell value={it.net_rate} placeholder="—" editable={editable} onSave={(v) => saveItem(it.sku_id, "net_rate", v)} />
                              </td>
                              <td className="px-2 text-right">
                                <NumCell value={it.foc_pct} placeholder="party" editable={editable} onSave={(v) => saveItem(it.sku_id, "foc_pct", v)} />
                              </td>
                              <td className="px-2 text-center">
                                <button
                                  type="button"
                                  disabled={!editable}
                                  onClick={() => toggleK(it.sku_id, !it.is_k)}
                                  className={`rounded px-2 py-0.5 text-[11px] font-bold ${it.is_k ? "bg-[var(--danger)] text-white" : "border border-[var(--border)] bg-[var(--surface-2)]"} disabled:opacity-50`}
                                >
                                  {it.is_k ? "K" : "O"}
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <p className="text-xs text-[var(--muted)]">
                    <b>Item Net Rate</b> = a fixed rate for this party+item (supersedes party disc% + global net rate). <b>FOC %</b> blank = use the party FOC above.
                    <b> K</b> = this item goes to the retailer network for this party (auto-applies OGL and makes the order O/K). Bulk-upload K via
                    {" "}<Link href="/erp/masters/import?master=party-k-items" className="underline">Party K-items</Link>.
                  </p>
                </div>
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}

function tabBtn(active: boolean) {
  return `rounded-lg px-4 py-2 text-sm font-bold ${active ? "bg-[var(--accent)] text-white" : "border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-2)]"}`;
}

function PctField({ label, value, onChange, onSave, editable }: { label: string; value: string; onChange: (v: string) => void; onSave: (v: string) => void; editable: boolean }) {
  const [orig] = useState(value);
  const dirtyRef = useRef(value);
  return (
    <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--muted)]">
      {label}
      <div className="flex gap-1">
        <input
          type="number" step="any" disabled={!editable} value={value}
          onChange={(e) => { onChange(e.target.value); dirtyRef.current = e.target.value; }}
          onBlur={() => { if (dirtyRef.current !== orig && dirtyRef.current !== "") onSave(dirtyRef.current); }}
          onKeyDown={(e) => { if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur(); }}
          className={`${inp} w-28 text-right font-normal disabled:opacity-60`}
        />
        <span className="self-center text-sm">%</span>
      </div>
    </label>
  );
}

function NumCell({ value, placeholder, editable, onSave }: { value: number | null; placeholder: string; editable: boolean; onSave: (v: string) => void }) {
  const [v, setV] = useState(value == null ? "" : String(value));
  const orig = useRef(value == null ? "" : String(value));
  useEffect(() => { const s = value == null ? "" : String(value); setV(s); orig.current = s; }, [value]);
  return (
    <input
      type="number" step="any" disabled={!editable} value={v} placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => { if (v !== orig.current && v.trim() !== "") onSave(v); }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur(); }}
      className={`${inp} w-24 text-right font-normal disabled:opacity-60`}
    />
  );
}
