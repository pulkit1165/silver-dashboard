"use client";

import { useEffect, useMemo, useState } from "react";

type Suggestion = {
  sku_id: number;
  sku_code: string;
  name: string;
  category: string;
  unit: string;
  on_hand: number;
  demand: number;
  reorder_level: number;
  min_stock: number;
  suggested_qty: number;
  unit_cost: number;
  est_cost: number;
  cost_estimated: boolean;
  status: "out" | "low" | "reorder" | "ok";
};
type Totals = { lines: number; units: number; cost: number; estimatedCost: boolean };
type Recommendation = {
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
  action: string;
  sku_code: string;
};
type Po = { id: number; po_no: string; vendor_name: string | null; order_date: string; status: string };
type Vendor = { id: number; code: string; name: string; status: string };

type Tab = "generate" | "tracker" | "alerts";

const STATUS_TAG: Record<string, string> = { out: "r", low: "r", reorder: "n", ok: "g" };
const PO_TAG: Record<string, string> = {
  draft: "n", approved: "n", sent: "n", "partially received": "r", completed: "g", cancelled: "r",
};
const SEV: Record<string, { tag: string; label: string }> = {
  high: { tag: "r", label: "High" },
  medium: { tag: "n", label: "Medium" },
  low: { tag: "g", label: "Low" },
};

const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");

function monthOptions(): { label: string; value: string; from: string; to: string }[] {
  const now = new Date();
  const out: { label: string; value: string; from: string; to: string }[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const y = d.getFullYear();
    const m = d.getMonth();
    const first = new Date(y, m, 1);
    const last = new Date(y, m + 1, 0);
    const iso = (x: Date) =>
      `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
    out.push({
      label: d.toLocaleString("en-US", { month: "long", year: "numeric" }),
      value: `${y}-${String(m + 1).padStart(2, "0")}`,
      from: iso(first),
      to: iso(last),
    });
  }
  return out;
}

export default function PoGenerator({
  pos: initialPos,
  vendors,
  canWrite,
  aiEnabled,
}: {
  pos: Po[];
  vendors: Vendor[];
  canWrite: boolean;
  aiEnabled: boolean;
}) {
  const months = useMemo(monthOptions, []);
  const [tab, setTab] = useState<Tab>("generate");
  const [month, setMonth] = useState(months[0].value);
  const [from, setFrom] = useState(months[0].from);
  const [to, setTo] = useState(months[0].to);
  const [margin, setMargin] = useState(15);
  const [onlyNeeding, setOnlyNeeding] = useState(true);

  const [busy, setBusy] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [qtyOverride, setQtyOverride] = useState<Record<number, number>>({});

  const [recs, setRecs] = useState<Recommendation[] | null>(null);
  const [recSource, setRecSource] = useState<"ai" | "heuristic" | null>(null);
  const [recBusy, setRecBusy] = useState(false);

  const [pos, setPos] = useState<Po[]>(initialPos);
  const [vendorId, setVendorId] = useState<number>(0);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function pickMonth(value: string) {
    setMonth(value);
    const m = months.find((x) => x.value === value);
    if (m) { setFrom(m.from); setTo(m.to); }
  }

  async function generate() {
    setBusy(true);
    setError(null);
    setCreated(null);
    try {
      const r = await fetch("/api/erp/purchase/suggest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ from, to, margin, onlyNeeding }),
      });
      const d = await r.json();
      if (!d.ok) { setError(d.error || "Failed to generate."); return; }
      setSuggestions(d.suggestions);
      setTotals(d.totals);
      setSelected(new Set<number>(d.suggestions.map((s: Suggestion) => s.sku_id)));
      setQtyOverride({});
      void loadRecs();
    } finally {
      setBusy(false);
    }
  }

  async function loadRecs() {
    setRecBusy(true);
    try {
      const r = await fetch("/api/erp/purchase/recommendations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ from, to, margin }),
      });
      const d = await r.json();
      if (d.ok) { setRecs(d.recommendations); setRecSource(d.source); }
    } finally {
      setRecBusy(false);
    }
  }

  const qtyFor = (s: Suggestion) => qtyOverride[s.sku_id] ?? s.suggested_qty;

  const selectedLines = useMemo(
    () => (suggestions ?? []).filter((s) => selected.has(s.sku_id) && qtyFor(s) > 0),
    [suggestions, selected, qtyOverride],
  );
  const selectedCost = selectedLines.reduce((sum, s) => sum + qtyFor(s) * s.unit_cost, 0);

  async function createPo() {
    if (!vendorId) { setError("Select a vendor to raise the PO."); return; }
    if (selectedLines.length === 0) { setError("Select at least one line."); return; }
    setCreating(true);
    setError(null);
    try {
      const r = await fetch("/api/erp/purchase/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          vendorId,
          lines: selectedLines.map((s) => ({ skuId: s.sku_id, qty: qtyFor(s), price: s.unit_cost })),
        }),
      });
      const d = await r.json();
      if (!d.ok) { setError(d.error || "Failed to create PO."); return; }
      const vName = vendors.find((v) => v.id === vendorId)?.name ?? null;
      setPos((p) => [
        { id: Date.now(), po_no: d.poNo, vendor_name: vName, order_date: new Date().toISOString().slice(0, 10), status: "draft" },
        ...p,
      ]);
      setCreated(`${d.poNo} created — ${d.lines} lines, ${inr(d.total)}.`);
      setSuggestions(null);
      setTotals(null);
      setTab("tracker");
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      {/* Tabs */}
      <div className="mb-5 inline-flex gap-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1">
        {([
          ["generate", "▣ Generate PO"],
          ["tracker", "▤ PO Tracker"],
          ["alerts", "⚠ Stock Alerts"],
        ] as [Tab, string][]).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-lg px-4 py-2 text-sm font-bold transition ${
              tab === t ? "bg-[var(--accent)] text-white" : "text-[var(--muted)] hover:bg-[var(--surface-2)]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {created && (
        <div className="mb-4 rounded-xl border px-4 py-3 text-sm font-bold" style={{ borderColor: "var(--accent-2)", background: "var(--accent-2-bg)", color: "var(--accent-2)" }}>
          ✓ {created}
        </div>
      )}
      {error && (
        <div className="mb-4 rounded-xl border px-4 py-3 text-sm font-bold" style={{ borderColor: "var(--danger)", background: "var(--danger-bg)", color: "var(--danger)" }}>
          {error}
        </div>
      )}

      {tab === "generate" && (
        <div className="flex flex-col gap-5">
          {/* Configure */}
          <section className="panel">
            <div className="panel-hd">Configure</div>
            <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-2 xl:grid-cols-4">
              <Field label="Reference Month">
                <select value={month} onChange={(e) => pickMonth(e.target.value)} className="ctl">
                  {months.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </Field>
              <Field label="From">
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="ctl" />
              </Field>
              <Field label="To">
                <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="ctl" />
              </Field>
              <Field label={<>Margin — <span className="text-[var(--accent)]">{margin}%</span></>}>
                <input type="range" min={0} max={100} value={margin} onChange={(e) => setMargin(Number(e.target.value))} className="w-full accent-[var(--accent)]" />
                <div className="flex justify-between text-[10px] text-[var(--muted)]"><span>0%</span><span>50%</span><span>100%</span></div>
              </Field>
            </div>
            <div className="flex flex-wrap items-center gap-3 border-t border-[var(--border)] p-4">
              <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
                <input type="checkbox" checked={onlyNeeding} onChange={(e) => setOnlyNeeding(e.target.checked)} className="accent-[var(--accent)]" />
                Only SKUs needing order
              </label>
              <button onClick={generate} disabled={busy} className="rounded-lg bg-[var(--accent)] px-5 py-2 text-sm font-bold text-white hover:bg-[var(--accent-strong)] disabled:opacity-50">
                {busy ? "Generating…" : "↻ Generate PO"}
              </button>
              <span className="text-xs text-[var(--muted)]">Demand from sales in the window, buffered by margin, against current stock & reorder levels.</span>
            </div>
          </section>

          {/* AI recommendation panel */}
          <RecPanel recs={recs} source={recSource} busy={recBusy} aiEnabled={aiEnabled} onLoad={loadRecs} />

          {/* Suggestions */}
          {suggestions && totals && (
            <section className="panel">
              <div className="panel-hd">Suggested Purchase Order</div>
              <div className="grid grid-cols-3 gap-3 p-4">
                <Kpi label="Lines" value={String(totals.lines)} sub="SKUs to order" />
                <Kpi label="Units" value={totals.units.toLocaleString("en-IN")} sub="total quantity" />
                <Kpi label="Est. cost" value={inr(totals.cost)} sub={totals.estimatedCost ? "some prices estimated" : "at purchase price"} />
              </div>
              {totals.lines === 0 ? (
                <p className="p-6 text-center text-sm text-[var(--muted)]">Nothing to order for this window. ✓</p>
              ) : (
                <>
                  <div className="max-h-[28rem] overflow-auto">
                    <table className="rtable">
                      <thead>
                        <tr>
                          <th className="w-8">
                            <input
                              type="checkbox"
                              checked={selected.size === suggestions.length}
                              onChange={(e) => setSelected(e.target.checked ? new Set(suggestions.map((s) => s.sku_id)) : new Set())}
                              className="accent-[var(--accent)]"
                            />
                          </th>
                          <th>SKU</th><th>Item</th>
                          <th className="!text-right">On hand</th>
                          <th className="!text-right">Sold</th>
                          <th className="!text-right">Reorder</th>
                          <th className="!text-right">Order qty</th>
                          <th className="!text-right">Est. cost</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {suggestions.map((s) => (
                          <tr key={s.sku_id}>
                            <td>
                              <input
                                type="checkbox"
                                checked={selected.has(s.sku_id)}
                                onChange={(e) => {
                                  const next = new Set(selected);
                                  if (e.target.checked) next.add(s.sku_id); else next.delete(s.sku_id);
                                  setSelected(next);
                                }}
                                className="accent-[var(--accent)]"
                              />
                            </td>
                            <td className="font-mono text-xs">{s.sku_code}</td>
                            <td className="font-semibold">{s.name}</td>
                            <td className="num-cell">{s.on_hand}</td>
                            <td className="num-cell">{s.demand}</td>
                            <td className="num-cell text-[var(--muted)]">{s.reorder_level}</td>
                            <td className="!text-right">
                              <input
                                type="number"
                                min={0}
                                value={qtyFor(s)}
                                onChange={(e) => setQtyOverride((q) => ({ ...q, [s.sku_id]: Math.max(0, Number(e.target.value)) }))}
                                className="w-20 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-right text-sm outline-none focus:border-[var(--accent)]"
                              />
                            </td>
                            <td className="num-cell">{inr(qtyFor(s) * s.unit_cost)}{s.cost_estimated ? "*" : ""}</td>
                            <td><span className={`tag ${STATUS_TAG[s.status]}`}>{s.status}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {totals.estimatedCost && <p className="px-4 pt-2 text-xs text-[var(--muted)]">* cost estimated from selling price (no purchase price on file).</p>}

                  {/* Create PO bar */}
                  <div className="flex flex-wrap items-center gap-3 border-t border-[var(--border)] p-4">
                    {canWrite ? (
                      <>
                        <select value={vendorId} onChange={(e) => setVendorId(Number(e.target.value))} className="ctl max-w-xs">
                          <option value={0}>Select vendor…</option>
                          {vendors.map((v) => <option key={v.id} value={v.id}>{v.name} ({v.code})</option>)}
                        </select>
                        <button onClick={createPo} disabled={creating || selectedLines.length === 0} className="rounded-lg bg-[var(--accent)] px-5 py-2 text-sm font-bold text-white hover:bg-[var(--accent-strong)] disabled:opacity-50">
                          {creating ? "Creating…" : `Create PO — ${selectedLines.length} line${selectedLines.length === 1 ? "" : "s"} · ${inr(selectedCost)}`}
                        </button>
                      </>
                    ) : (
                      <span className="text-sm text-[var(--muted)]">Your role can review but not raise POs.</span>
                    )}
                  </div>
                </>
              )}
            </section>
          )}
        </div>
      )}

      {tab === "tracker" && (
        <section className="panel">
          <div className="panel-hd">Purchase Orders</div>
          <div className="overflow-x-auto">
            <table className="rtable">
              <thead><tr><th>PO</th><th>Vendor</th><th>Date</th><th>Status</th></tr></thead>
              <tbody>
                {pos.length === 0 && <tr><td colSpan={4} className="!py-6 text-center text-[var(--muted)]">No purchase orders yet. Generate one above.</td></tr>}
                {pos.map((p) => (
                  <tr key={p.id}>
                    <td className="font-semibold">{p.po_no}</td>
                    <td>{p.vendor_name ?? "—"}</td>
                    <td className="text-[var(--muted)]">{p.order_date}</td>
                    <td><span className={`tag ${PO_TAG[p.status] ?? "n"}`}>{p.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === "alerts" && <StockAlerts />}
    </>
  );
}

function RecPanel({
  recs, source, busy, aiEnabled, onLoad,
}: {
  recs: Recommendation[] | null;
  source: "ai" | "heuristic" | null;
  busy: boolean;
  aiEnabled: boolean;
  onLoad: () => void;
}) {
  return (
    <section className="panel" style={{ borderColor: "color-mix(in srgb, var(--accent) 35%, var(--border))" }}>
      <div className="panel-hd flex items-center justify-between">
        <span>✦ AI Recommendations</span>
        <span className="flex items-center gap-2">
          {source && (
            <span className={`tag ${source === "ai" ? "g" : "n"}`}>{source === "ai" ? "Claude" : "Smart engine"}</span>
          )}
          <button onClick={onLoad} disabled={busy} className="rounded-md border border-[var(--border)] px-3 py-1 text-xs font-bold hover:bg-[var(--surface-2)] disabled:opacity-50">
            {busy ? "Analyzing…" : recs ? "Refresh" : "Analyze"}
          </button>
        </span>
      </div>
      <div className="p-4">
        {!recs && !busy && (
          <p className="text-sm text-[var(--muted)]">
            Click <b>Analyze</b> for prioritised purchasing actions from current stock, demand and margins.
            {aiEnabled ? " Powered by Claude." : " Using the built-in smart engine (set ANTHROPIC_API_KEY to use Claude)."}
          </p>
        )}
        {busy && !recs && <p className="text-sm text-[var(--muted)]">Analyzing inventory & demand…</p>}
        {recs && recs.length === 0 && <p className="text-sm text-[var(--muted)]">No issues found — inventory looks healthy. ✓</p>}
        {recs && recs.length > 0 && (
          <ul className="flex flex-col gap-2">
            {recs.map((r, i) => (
              <li key={i} className="flex gap-3 rounded-lg border border-[var(--border)] p-3">
                <span className={`tag ${SEV[r.severity]?.tag ?? "n"} h-fit`}>{SEV[r.severity]?.label ?? r.severity}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold">{r.title}{r.sku_code ? <span className="ml-2 font-mono text-xs font-normal text-[var(--muted)]">{r.sku_code}</span> : null}</div>
                  <div className="text-sm text-[var(--muted)]">{r.detail}</div>
                  <div className="mt-1 text-sm font-semibold text-[var(--accent-strong)]">→ {r.action}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function StockAlerts() {
  const [rows, setRows] = useState<Suggestion[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    try {
      const now = new Date();
      const to = now.toISOString().slice(0, 10);
      const from = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()).toISOString().slice(0, 10);
      const r = await fetch("/api/erp/purchase/suggest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ from, to, margin: 0, onlyNeeding: true }),
      });
      const d = await r.json();
      if (d.ok) setRows((d.suggestions as Suggestion[]).filter((s) => s.status !== "ok"));
    } finally {
      setBusy(false);
    }
  }

  // lazy-load on first render
  useEffect(() => { void load(); }, []);

  return (
    <section className="panel">
      <div className="panel-hd flex items-center justify-between">
        <span>Stock Alerts</span>
        <button onClick={load} disabled={busy} className="rounded-md border border-[var(--border)] px-3 py-1 text-xs font-bold hover:bg-[var(--surface-2)] disabled:opacity-50">
          {busy ? "Loading…" : "Refresh"}
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="rtable">
          <thead><tr><th>SKU</th><th>Item</th><th className="!text-right">On hand</th><th className="!text-right">Min</th><th className="!text-right">Reorder</th><th>Status</th></tr></thead>
          <tbody>
            {busy && !rows && <tr><td colSpan={6} className="!py-6 text-center text-[var(--muted)]">Loading…</td></tr>}
            {rows && rows.length === 0 && <tr><td colSpan={6} className="!py-6 text-center text-[var(--muted)]">All items above reorder level. ✓</td></tr>}
            {rows?.map((s) => (
              <tr key={s.sku_id}>
                <td className="font-mono text-xs">{s.sku_code}</td>
                <td className="font-semibold">{s.name}</td>
                <td className="num-cell">{s.on_hand}</td>
                <td className="num-cell text-[var(--muted)]">{s.min_stock}</td>
                <td className="num-cell text-[var(--muted)]">{s.reorder_level}</td>
                <td><span className={`tag ${STATUS_TAG[s.status]}`}>{s.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold text-[var(--muted)]">{label}</span>
      {children}
    </label>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="kpi">
      <div className="lab">{label}</div>
      <div className="num">{value}</div>
      <div className="sub">{sub}</div>
    </div>
  );
}
