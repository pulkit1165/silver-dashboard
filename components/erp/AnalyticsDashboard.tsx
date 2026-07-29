"use client";

import { useEffect, useRef, useState } from "react";
import type { AnalyticsBundle, ItemRow } from "@/lib/erp/analytics";
import { AreaTrend, RankedBars, Donut, StatTile, inr, num, CAT } from "./AnalyticsCharts";

type ReportKey =
  | "daily-sales" | "daily-purchase" | "sold-by-sku" | "by-category" | "top-customers"
  | "returning" | "slow-stock" | "insights" | "state" | "salesman" | "transporter" | "freight";

const isoDate = (d: Date) => { const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
function presetRange(key: string): { from: string; to: string; label: string } {
  const today = new Date();
  const minus = (n: number) => { const d = new Date(today); d.setDate(d.getDate() - n); return isoDate(d); };
  const t = isoDate(today);
  switch (key) {
    case "today": return { from: t, to: t, label: "Today" };
    case "yesterday": { const y = minus(1); return { from: y, to: y, label: "Yesterday" }; }
    case "7": return { from: minus(6), to: t, label: "Last 7 days" };
    case "30": return { from: minus(29), to: t, label: "Last 30 days" };
    case "90": return { from: minus(89), to: t, label: "Last 90 days" };
    default: return { from: minus(364), to: t, label: "Last 12 months" };
  }
}
const PRESETS = [
  { key: "today", label: "Today" }, { key: "yesterday", label: "Yesterday" },
  { key: "7", label: "Last 7 days" }, { key: "30", label: "Last 30 days" },
  { key: "90", label: "Last 90 days" }, { key: "365", label: "Last 12 months" },
];
const fmtTime = (iso: string) => { try { return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); } catch { return ""; } };
const sum = (xs: number[]) => xs.reduce((a, x) => a + x, 0);

const PENDING: Record<string, string> = {};

export default function AnalyticsDashboard({ data: initial }: { data: AnalyticsBundle }) {
  const [data, setData] = useState(initial);
  const [label, setLabel] = useState("Last 12 months");
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<ReportKey | null>(null);
  const [refreshed, setRefreshed] = useState("");
  useEffect(() => { setRefreshed(fmtTime(data.generatedAt)); }, [data.generatedAt]);

  // Auto-fetch on mount if server couldn't load data (Neon cold-start / timeout)
  useEffect(() => {
    if (!initial.live) {
      const p = presetRange("365");
      applyRange(p.from, p.to, p.label);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function applyRange(from: string, to: string, lbl: string) {
    setLabel(lbl); setLoading(true);
    try { const r = await fetch(`/api/erp/analytics/data?from=${from}&to=${to}`); const j = await r.json(); if (j.ok) setData(j.data); }
    catch { /* keep current */ } finally { setLoading(false); }
  }
  const k = data.kpis;

  return (
    <div className="flex flex-col gap-5">
      {/* toolbar — date range + refreshed */}
      <div className="flex flex-wrap items-center gap-2">
        <DateRangeMenu label={label}
          onPreset={(key) => { const p = presetRange(key); applyRange(p.from, p.to, p.label); }}
          onCustom={(f, t) => applyRange(f, t, `${f} → ${t}`)} />
        {loading && <span className="text-xs font-semibold text-[var(--accent)]">Refreshing…</span>}
        <span className="ml-auto text-xs font-semibold text-[var(--muted-2)]">{refreshed && `Last refreshed ${refreshed}`}</span>
      </div>

      {!data.live && !loading && (
        <div className="rounded-xl border border-[var(--warning)] bg-[var(--warning-bg)] px-4 py-2.5 text-sm font-semibold text-[var(--warning)]">
          ⚠ No sales data found for this date range. Try a wider range or check that the daily sync has run.
        </div>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <StatTile label={`Revenue · ${label.replace("Last ", "")}`} value={inr(k.revenue)} sub={`${num(k.bills)} bills`} accent={CAT[1]} />
        <StatTile label="Avg order value" value={inr(k.aov)} accent={CAT[2]} />
        <StatTile label="Units sold" value={num(k.units)} accent={CAT[3]} />
        <StatTile label="Active SKUs" value={num(k.skus)} accent={CAT[4]} />
        <StatTile label="Customers" value={num(k.customers)} accent={CAT[5]} />
        <StatTile label="Bills" value={num(k.bills)} accent={CAT[0]} />
      </div>

      {/* Report cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Card title="Daily Sales" icon="📈" accent={CAT[1]} onOpen={() => setOpen("daily-sales")} full>
          <AreaTrend data={data.daily as never} valueKey="revenue" color={CAT[1]} height={150} />
        </Card>
        <Card title="Daily Purchase" icon="🛒" accent={CAT[2]} onOpen={() => setOpen("daily-purchase")} full>
          <AreaTrend data={data.purchase as never} valueKey="amount" color={CAT[2]} height={150} />
        </Card>
        <Card title="Sales by Category" icon="🍩" accent={CAT[4]} onOpen={() => setOpen("by-category")}>
          <Donut rows={data.category.map((c) => ({ label: c.category, value: c.revenue }))} size={150} />
        </Card>
        <Card title="Sold by SKU" icon="🏷️" accent={CAT[0]} onOpen={() => setOpen("sold-by-sku")}>
          <RankedBars rows={data.sku.slice(0, 6).map((s) => ({ label: s.code, sub: s.name, value: s.units }))} unit="count" />
        </Card>
        <Card title="Top Customers" icon="👑" accent={CAT[3]} onOpen={() => setOpen("top-customers")}>
          <RankedBars rows={data.customers.slice(0, 6).map((c) => ({ label: c.customer, value: c.revenue }))} unit="money" color={CAT[3]} />
        </Card>
        <Card title="Returning Customers" icon="🔁" accent={CAT[5]} onOpen={() => setOpen("returning")}>
          <RankedBars rows={data.returning.slice(0, 6).map((c) => ({ label: c.customer, sub: `${c.bills} bills`, value: c.avgDays }))} unit="count" color={CAT[5]} />
          <p className="mt-1 text-[10px] font-semibold text-[var(--muted-2)]">avg days between purchases (lower = more frequent)</p>
        </Card>
        <Card title="Slow-moving Stock" icon="🐌" accent={CAT[6]} onOpen={() => setOpen("slow-stock")}>
          <RankedBars rows={data.slow.slice(0, 6).map((s) => ({ label: s.code, sub: `${num(s.qty)} in stock`, value: s.daysIdle >= 9999 ? 999 : s.daysIdle }))} unit="count" color={CAT[6]} />
          <p className="mt-1 text-[10px] font-semibold text-[var(--muted-2)]">days since last sale (higher = more stuck)</p>
        </Card>
        <Card title="Transporter Workload" icon="🚚" accent={CAT[2]} onOpen={() => setOpen("transporter")}>
          {data.transporter.length > 0
            ? <RankedBars rows={data.transporter.slice(0, 6).map((tr) => ({ label: tr.transporter, sub: `${num(tr.bills)} bills`, value: tr.value }))} unit="money" color={CAT[2]} />
            : <div className="flex h-[120px] items-center justify-center text-xs font-semibold text-[var(--muted)]">No transporter data in this range.</div>}
        </Card>
        <Card title="State-wise Sale" icon="🗺️" accent={CAT[0]} onOpen={() => setOpen("state")}>
          {data.state.length > 0
            ? <RankedBars rows={data.state.slice(0, 6).map((s) => ({ label: s.state, sub: `${num(s.bills)} bills`, value: s.value }))} unit="money" color={CAT[0]} />
            : <div className="flex h-[120px] items-center justify-center text-xs font-semibold text-[var(--muted)]">No state data in this range.</div>}
        </Card>
        <Card title="Freight Expense" icon="💸" accent={CAT[5]} onOpen={() => setOpen("freight")}>
          {data.freight.length > 0
            ? <RankedBars rows={data.freight.slice(0, 6).map((f) => ({ label: f.transporter, sub: `${num(f.bills)} bills`, value: f.freight }))} unit="money" color={CAT[5]} />
            : <div className="flex h-[120px] items-center justify-center text-xs font-semibold text-[var(--muted)]">No freight recorded in this range.</div>}
        </Card>
        <Card title="AI Insights" icon="✨" accent={CAT[7]} onOpen={() => setOpen("insights")}>
          <ul className="flex flex-col gap-1.5 text-xs">
            {insights(data).slice(0, 3).map((t, i) => <li key={i} className="flex gap-1.5"><span style={{ color: CAT[7] }}>●</span><span>{t}</span></li>)}
          </ul>
        </Card>
        <Card title="Sale by Salesman" icon="🧑‍💼" accent={CAT[3]} onOpen={() => setOpen("salesman")}>
          {data.salesman.length > 0
            ? <RankedBars rows={data.salesman.slice(0, 6).map((s) => ({ label: s.salesman, sub: `${num(s.bills)} bills`, value: s.value }))} unit="money" color={CAT[3]} />
            : <div className="flex h-[120px] items-center justify-center text-xs font-semibold text-[var(--muted)]">No salesman data in this range.</div>}
        </Card>
      </div>

      {open && <ReportOverlay k={open} data={data} label={label} refreshed={refreshed} onClose={() => setOpen(null)} />}
    </div>
  );
}

// ── Date-range menu (presets + custom picker) ───────────────────────────────
function DateRangeMenu({ label, onPreset, onCustom }:
  { label: string; onPreset: (key: string) => void; onCustom: (from: string, to: string) => void }) {
  const [open, setOpen] = useState(false);
  const [cf, setCf] = useState("");
  const [ct, setCt] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm font-bold hover:bg-[var(--surface-2)]">
        📅 {label} <span className="text-[var(--muted-2)]">▾</span>
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-64 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1.5 shadow-2xl">
          {PRESETS.map((p) => (
            <button key={p.key} onClick={() => { onPreset(p.key); setOpen(false); }}
              className={`block w-full rounded-lg px-3 py-2 text-left text-sm font-semibold hover:bg-[var(--surface-2)] ${label === p.label ? "text-[var(--accent-strong)]" : ""}`}>
              {p.label}
            </button>
          ))}
          <div className="my-1 border-t border-[var(--border)]" />
          <div className="px-2 py-1">
            <div className="mb-1 text-[10px] font-bold uppercase text-[var(--muted)]">Custom range</div>
            <div className="flex items-center gap-1">
              <input type="date" value={cf} onChange={(e) => setCf(e.target.value)} className="w-full rounded border border-[var(--border)] bg-[var(--surface)] px-1.5 py-1 text-xs" />
              <span className="text-[var(--muted)]">→</span>
              <input type="date" value={ct} onChange={(e) => setCt(e.target.value)} className="w-full rounded border border-[var(--border)] bg-[var(--surface)] px-1.5 py-1 text-xs" />
            </div>
            <button disabled={!cf || !ct}
              onClick={() => { if (cf && ct) { const a = cf <= ct ? cf : ct, b = cf <= ct ? ct : cf; onCustom(a, b); setOpen(false); } }}
              className="mt-1.5 w-full rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">
              Apply custom range
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Card({ title, icon, accent, children, onOpen, full, pending }:
  { title: string; icon: string; accent: string; children: React.ReactNode; onOpen: () => void; full?: boolean; pending?: boolean }) {
  return (
    <button onClick={onOpen} className="group flex flex-col rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-left shadow-sm transition hover:shadow-md hover:border-[var(--muted-2)]">
      <div className="mb-3 flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm font-extrabold">
          <span className="grid h-7 w-7 place-items-center rounded-lg text-sm" style={{ background: `${accent}1a` }}>{icon}</span>{title}
        </span>
        {pending
          ? <span className="rounded-full bg-[var(--warning-bg)] px-2 py-0.5 text-[10px] font-bold text-[var(--warning)]">SOON</span>
          : <span className="text-xs font-bold text-[var(--muted-2)] group-hover:text-[var(--accent)]">Open →</span>}
      </div>
      <div className={full ? "" : "min-h-[120px]"}>{children}</div>
    </button>
  );
}

// ── Full report overlay — Shopify report-detail style ───────────────────────
function ReportOverlay({ k, data, label, refreshed, onClose }:
  { k: ReportKey; data: AnalyticsBundle; label: string; refreshed: string; onClose: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", h); document.body.style.overflow = ""; };
  }, [onClose]);
  const titles: Record<ReportKey, string> = {
    "daily-sales": "Daily Sales", "daily-purchase": "Daily Purchase", "sold-by-sku": "Sold by SKU",
    "by-category": "Sales by Category", "top-customers": "Top Customers", "returning": "Returning Customers",
    "slow-stock": "Slow-moving Stock", "insights": "AI Insights", "state": "State-wise Sale",
    "salesman": "Sale by Salesman", "transporter": "Transporter Workload", "freight": "Freight Expense",
  };
  const summary = reportSummary(k, data);
  return (
    <div className="fixed inset-0 z-50 flex justify-center bg-black/40 p-2 sm:p-6" onClick={onClose}>
      <div className="flex max-h-full w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--background)] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* header */}
        <div className="border-b border-[var(--border)] bg-[var(--surface)] px-5 pt-3">
          <div className="flex items-center justify-between">
            <div className="flex items-baseline gap-2">
              <span className="text-[var(--muted-2)]">▤</span>
              <h2 className="text-lg font-extrabold">{titles[k]}</h2>
              {refreshed && <span className="text-xs font-semibold text-[var(--muted-2)]">Last refreshed {refreshed}</span>}
            </div>
            <button onClick={onClose} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-bold hover:bg-[var(--surface-2)]">✕ Close</button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 pb-2">
            <Chip>📅 {label}</Chip>
            <Chip>₹ INR</Chip>
            {summary && (
              <span className="ml-1 flex items-center gap-2 text-sm">
                <span className="h-2 w-2 rounded-full bg-[var(--accent-2)]" />
                <b className="tabular-nums">{summary.total}</b>
                <span className="text-[var(--muted)]">{summary.label}</span>
              </span>
            )}
          </div>
        </div>
        <div className="overflow-auto p-5">
          <ReportBody k={k} data={data} />
        </div>
      </div>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-xs font-bold text-[var(--ink-2)]">{children}</span>;
}

function reportSummary(k: ReportKey, d: AnalyticsBundle): { total: string; label: string } | null {
  switch (k) {
    case "daily-sales": return { total: inr(sum(d.daily.map((x) => x.revenue))), label: `Total sales · ${num(sum(d.daily.map((x) => x.bills)))} bills` };
    case "daily-purchase": return { total: inr(sum(d.purchase.map((x) => x.amount))), label: `Total purchase · ${num(sum(d.purchase.map((x) => x.bills)))} bills` };
    case "sold-by-sku": return { total: num(sum(d.sku.map((x) => x.units))), label: `units · ${d.sku.length} SKUs · ${inr(sum(d.sku.map((x) => x.revenue)))} revenue` };
    case "by-category": return { total: inr(sum(d.category.map((x) => x.revenue))), label: `revenue across ${d.category.length} categories` };
    case "top-customers": return { total: inr(sum(d.customers.map((x) => x.revenue))), label: `from ${d.customers.length} customers` };
    case "returning": return { total: num(d.returning.length), label: "repeat customers" };
    case "slow-stock": return { total: num(d.slow.filter((x) => x.daysIdle >= 180).length), label: "SKUs idle 180+ days" };
    case "transporter": return { total: inr(sum(d.transporter.map((x) => x.value))), label: `dispatched via ${d.transporter.length} transporters · ${num(sum(d.transporter.map((x) => x.bills)))} bills` };
    case "state": return { total: inr(sum(d.state.map((x) => x.value))), label: `across ${d.state.length} states · ${num(sum(d.state.map((x) => x.bills)))} bills` };
    case "freight": return { total: inr(sum(d.freight.map((x) => x.freight))), label: `freight paid · ${d.freight.length} transporters` };
    case "salesman": return { total: inr(sum(d.salesman.map((x) => x.value))), label: `across ${d.salesman.length} salesmen · ${num(sum(d.salesman.map((x) => x.bills)))} bills` };
    default: return null;
  }
}

function Panel({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      {title && <h3 className="mb-3 text-sm font-extrabold text-[var(--accent-strong)]">{title}</h3>}
      {children}
    </section>
  );
}

function ReportBody({ k, data }: { k: ReportKey; data: AnalyticsBundle }) {
  if (PENDING[k]) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-8 text-center">
        <div className="text-4xl">🔌</div>
        <p className="mx-auto mt-3 max-w-lg text-sm font-semibold text-[var(--muted)]">{PENDING[k]}</p>
      </div>
    );
  }
  if (k === "daily-sales") return (
    <div className="flex flex-col gap-4">
      <Panel title="Revenue over time"><AreaTrend data={data.daily as never} valueKey="revenue" color={CAT[1]} height={280} /></Panel>
      <Panel title="Daily detail">
        <DataTable head={["Date", "Revenue", "Bills"]}
          summary={["Summary", inr(sum(data.daily.map((d) => d.revenue))), num(sum(data.daily.map((d) => d.bills)))]}
          rows={data.daily.slice().reverse().map((d) => [d.d, inr(d.revenue), num(d.bills)])} />
      </Panel>
    </div>
  );
  if (k === "daily-purchase") return (
    <div className="flex flex-col gap-4">
      <Panel title="Purchase over time"><AreaTrend data={data.purchase as never} valueKey="amount" color={CAT[2]} height={280} /></Panel>
      <Panel title="Daily detail">
        <DataTable head={["Date", "Amount", "Bills"]}
          summary={["Summary", inr(sum(data.purchase.map((d) => d.amount))), num(sum(data.purchase.map((d) => d.bills)))]}
          rows={data.purchase.slice().reverse().map((d) => [d.d, inr(d.amount), num(d.bills)])} />
      </Panel>
    </div>
  );
  if (k === "sold-by-sku") return (
    <Panel title="Units sold by SKU (highest → lowest)">
      <RankedBars rows={data.sku.map((s) => ({ label: s.code, sub: s.name, value: s.units }))} unit="count" />
      <div className="mt-4">
        <DataTable head={["Code", "Item", "Units", "Revenue"]}
          summary={["Summary", "", num(sum(data.sku.map((s) => s.units))), inr(sum(data.sku.map((s) => s.revenue)))]}
          rows={data.sku.map((s) => [s.code, s.name, num(s.units), inr(s.revenue)])} />
      </div>
    </Panel>
  );
  if (k === "by-category") return (
    <Panel title="Sales share by category">
      <Donut rows={data.category.map((c) => ({ label: c.category, value: c.revenue }))} size={240} />
      <div className="mt-4">
        <DataTable head={["Category", "Revenue", "Units"]}
          summary={["Summary", inr(sum(data.category.map((c) => c.revenue))), num(sum(data.category.map((c) => c.units)))]}
          rows={data.category.map((c) => [c.category, inr(c.revenue), num(c.units)])} />
      </div>
    </Panel>
  );
  if (k === "top-customers") return <TopCustomers data={data} />;
  if (k === "returning") return (
    <Panel title="Returning customers · average days between purchases">
      <DataTable head={["Customer", "Bills", "Avg days", "Last bill"]}
        summary={["Summary", num(sum(data.returning.map((c) => c.bills))), "", ""]}
        rows={data.returning.map((c) => [c.customer, num(c.bills), c.avgDays ? `${c.avgDays}d` : "—", c.lastBill])} />
    </Panel>
  );
  if (k === "slow-stock") return (
    <Panel title="Slow-moving stock · on hand, days since last sale">
      <DataTable head={["Code", "Item", "In stock", "Last sale", "Days idle"]}
        summary={["Summary", "", num(sum(data.slow.map((s) => s.qty))), "", ""]}
        rows={data.slow.map((s) => [s.code, s.name, num(s.qty), s.lastSale, s.daysIdle >= 9999 ? "never sold" : `${num(s.daysIdle)}d`])} />
    </Panel>
  );
  if (k === "insights") return (
    <Panel title="Automated insights">
      <ul className="flex flex-col gap-2 text-sm">
        {insights(data).map((t, i) => <li key={i} className="flex gap-2 rounded-lg bg-[var(--surface-2)] px-3 py-2"><span style={{ color: CAT[7] }}>●</span><span>{t}</span></li>)}
      </ul>
    </Panel>
  );
  if (k === "transporter") return (
    <Panel title="Transporter workload · by dispatched value">
      <RankedBars rows={data.transporter.map((tr) => ({ label: tr.transporter, sub: `${num(tr.bills)} bills`, value: tr.value }))} unit="money" color={CAT[2]} />
      <div className="mt-4">
        <DataTable head={["Transporter", "Bills", "Value", "Weight"]}
          summary={["Summary", num(sum(data.transporter.map((tr) => tr.bills))), inr(sum(data.transporter.map((tr) => tr.value))), num(sum(data.transporter.map((tr) => tr.weight)))]}
          rows={data.transporter.map((tr) => [tr.transporter, num(tr.bills), inr(tr.value), num(tr.weight)])} />
      </div>
      <p className="mt-2 text-[11px] font-semibold text-[var(--muted-2)]">Source: dispatched sale lines (VW_GST_SALE_ITEM) grouped by transporter. Bills = distinct invoices; value = dispatched amount; weight as recorded.</p>
    </Panel>
  );
  if (k === "salesman") return (
    <Panel title="Sale by salesman · by value">
      <RankedBars rows={data.salesman.map((s) => ({ label: s.salesman, sub: `${num(s.bills)} bills`, value: s.value }))} unit="money" color={CAT[3]} />
      <div className="mt-4">
        <DataTable head={["Salesman", "Bills", "Value"]}
          summary={["Summary", num(sum(data.salesman.map((s) => s.bills))), inr(sum(data.salesman.map((s) => s.value)))]}
          rows={data.salesman.map((s) => [s.salesman, num(s.bills), inr(s.value)])} />
      </div>
    </Panel>
  );
  if (k === "state") return (
    <Panel title="State-wise sale · by value (place of supply)">
      <RankedBars rows={data.state.map((s) => ({ label: s.state, sub: `${num(s.bills)} bills`, value: s.value }))} unit="money" color={CAT[0]} />
      <div className="mt-4">
        <DataTable head={["State", "Bills", "Value"]}
          summary={["Summary", num(sum(data.state.map((s) => s.bills))), inr(sum(data.state.map((s) => s.value)))]}
          rows={data.state.map((s) => [s.state, num(s.bills), inr(s.value)])} />
      </div>
    </Panel>
  );
  if (k === "freight") {
    const totFreight = sum(data.freight.map((f) => f.freight));
    const totSales = sum(data.transporter.map((tr) => tr.value));
    const pct = totSales > 0 ? ((totFreight / totSales) * 100).toFixed(2) : "0";
    return (
      <Panel title="Freight expense · paid per transporter">
        <RankedBars rows={data.freight.map((f) => ({ label: f.transporter, sub: `${num(f.bills)} bills`, value: f.freight }))} unit="money" color={CAT[5]} />
        <div className="mt-4">
          <DataTable head={["Transporter", "Bills", "Freight"]}
            summary={["Summary", num(sum(data.freight.map((f) => f.bills))), inr(totFreight)]}
            rows={data.freight.map((f) => [f.transporter, num(f.bills), inr(f.freight)])} />
        </div>
        <p className="mt-2 text-[11px] font-semibold text-[var(--muted-2)]">Total freight {inr(totFreight)} ≈ {pct}% of dispatched sales. Freight (FRTAMT) is a per-bill charge, de-duplicated per invoice before summing.</p>
      </Panel>
    );
  }
  return null;
}

function TopCustomers({ data }: { data: AnalyticsBundle }) {
  const [sel, setSel] = useState<string | null>(null);
  const [items, setItems] = useState<ItemRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  async function pick(c: string) {
    setSel(c); setItems(null); setLoading(true);
    try { const r = await fetch(`/api/erp/analytics/customer-items?customer=${encodeURIComponent(c)}`); const d = await r.json(); setItems(d.items || []); }
    catch { setItems([]); } finally { setLoading(false); }
  }
  const maxRev = Math.max(1, ...data.customers.map((c) => c.revenue));
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
      <Panel title="Top customers · click one to see their items">
        <div className="flex flex-col gap-1.5">
          {data.customers.map((c, i) => (
            <button key={i} onClick={() => pick(c.customer)}
              className={`grid grid-cols-[1fr_auto] items-center gap-3 rounded-md px-2 py-1 text-left ${sel === c.customer ? "bg-[var(--accent-bg)]" : "hover:bg-[var(--surface-2)]"}`}>
              <div className="min-w-0">
                <div className="truncate text-xs font-bold">{c.customer}</div>
                <div className="mt-0.5 h-3 rounded bg-[var(--surface-2)]"><div className="h-3 rounded" style={{ width: `${(c.revenue / maxRev) * 100}%`, background: CAT[3] }} /></div>
              </div>
              <div className="text-right text-xs font-bold tabular-nums">{inr(c.revenue)}<div className="text-[10px] font-semibold text-[var(--muted)]">{c.bills} bills</div></div>
            </button>
          ))}
        </div>
      </Panel>
      <Panel title={sel ? `${sel} — items bought` : "Select a customer"}>
        {!sel && <p className="text-sm text-[var(--muted)]">Click a customer on the left to load the items they buy, highest to lowest.</p>}
        {loading && <p className="text-sm text-[var(--muted)]">Loading…</p>}
        {items && items.length > 0 && <DataTable head={["Code", "Item", "Units", "Revenue"]}
          summary={["Summary", "", num(sum(items.map((it) => it.units))), inr(sum(items.map((it) => it.revenue)))]}
          rows={items.map((it) => [it.code, it.name, num(it.units), inr(it.revenue)])} />}
        {items && items.length === 0 && !loading && <p className="text-sm text-[var(--muted)]">No item detail found for this customer.</p>}
      </Panel>
    </div>
  );
}

function DataTable({ head, rows, summary }: { head: string[]; rows: (string | number)[][]; summary?: (string | number)[] }) {
  if (rows.length === 0) return <p className="py-4 text-center text-sm text-[var(--muted)]">No rows.</p>;
  return (
    <div className="overflow-auto rounded-lg border border-[var(--border)]">
      <table className="rtable">
        <thead><tr>{head.map((h, i) => <th key={i} className={i === 0 ? "" : "!text-right"}>{h}</th>)}</tr></thead>
        <tbody>
          {summary && (
            <tr className="bg-[var(--surface-2)] font-extrabold">
              {summary.map((c, j) => <td key={j} className={j === 0 ? "" : "text-right tabular-nums"}>{c}</td>)}
            </tr>
          )}
          {rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={j === 0 ? "font-semibold" : "text-right tabular-nums"}>{c}</td>)}</tr>)}
        </tbody>
      </table>
    </div>
  );
}

// ── Rule-based insights (deterministic, no API key needed) ──────────────────
function insights(b: AnalyticsBundle): string[] {
  const out: string[] = [];
  if (b.daily.length >= 14) {
    const last7 = sum(b.daily.slice(-7).map((d) => d.revenue));
    const prev7 = sum(b.daily.slice(-14, -7).map((d) => d.revenue));
    if (prev7 > 0) {
      const ch = ((last7 - prev7) / prev7) * 100;
      out.push(`Sales are ${ch >= 0 ? "up" : "down"} ${Math.abs(ch).toFixed(0)}% in the last 7 days vs the week before (${inr(last7)} vs ${inr(prev7)}).`);
    }
  }
  if (b.sku.length) {
    const totU = sum(b.sku.map((s) => s.units)) || 1;
    out.push(`Your best-seller ${b.sku[0].code} (${b.sku[0].name}) is ${((b.sku[0].units / totU) * 100).toFixed(0)}% of top-SKU units.`);
  }
  if (b.category.length) {
    const totR = sum(b.category.map((c) => c.revenue)) || 1;
    out.push(`${b.category[0].category} is the biggest category — ${((b.category[0].revenue / totR) * 100).toFixed(0)}% of revenue (${inr(b.category[0].revenue)}).`);
  }
  if (b.customers.length >= 5) {
    const totR = sum(b.customers.map((c) => c.revenue)) || 1;
    const top5 = sum(b.customers.slice(0, 5).map((c) => c.revenue));
    out.push(`Top 5 customers drive ${((top5 / totR) * 100).toFixed(0)}% of tracked revenue — a concentration worth watching.`);
  }
  const idle = b.slow.filter((s) => s.daysIdle >= 180).length;
  if (b.slow.length) out.push(`${idle} in-stock SKUs haven't sold in 180+ days — candidates for a clearance push.`);
  const frequent = b.returning.filter((c) => c.avgDays > 0 && c.avgDays <= 30).length;
  if (b.returning.length) out.push(`${frequent} customers reorder within ~30 days on average — your most loyal base.`);
  if (out.length === 0) out.push("Connect the Oracle link to generate insights from live sales.");
  return out;
}
