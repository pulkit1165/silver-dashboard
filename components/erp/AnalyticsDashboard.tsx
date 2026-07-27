"use client";

import { useEffect, useState } from "react";
import type { AnalyticsBundle, ItemRow } from "@/lib/erp/analytics";
import { AreaTrend, RankedBars, Donut, StatTile, inr, num, CAT } from "./AnalyticsCharts";

type ReportKey =
  | "daily-sales" | "daily-purchase" | "sold-by-sku" | "by-category" | "top-customers"
  | "returning" | "slow-stock" | "insights" | "state" | "salesman" | "transporter" | "freight";

const PENDING: Record<string, string> = {
  state: "State-wise sale needs a party→state (GST state code) mapping in the Oracle sale view. Once the party master's state column is confirmed, this renders an India choropleth + a ranked state table.",
  salesman: "Sale-by-salesman needs the salesman/agent column on the sale header (VW_SALE_D). Confirm the column and this becomes a ranked salesman leaderboard with trend.",
  transporter: "Transporter workload needs the transporter/LR field on the dispatch/sale record. Once mapped, this ranks transporters by consignments & value.",
  freight: "Freight expense needs the freight/other-charges column on the invoice. Once mapped, this trends freight cost and freight as a % of sales.",
};

export default function AnalyticsDashboard({ data }: { data: AnalyticsBundle }) {
  const [open, setOpen] = useState<ReportKey | null>(null);
  const k = data.kpis;

  return (
    <div className="flex flex-col gap-5">
      {!data.live && (
        <div className="rounded-xl border border-[var(--warning)] bg-[var(--warning-bg)] px-4 py-2.5 text-sm font-semibold text-[var(--warning)]">
          ⚠ Live Oracle link is not returning data right now — reports show empty. They populate automatically once the connector is up.
        </div>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <StatTile label="Revenue · 12mo" value={inr(k.revenue)} sub={`${num(k.bills)} bills`} accent={CAT[1]} />
        <StatTile label="Avg order value" value={inr(k.aov)} accent={CAT[2]} />
        <StatTile label="Units sold" value={num(k.units)} accent={CAT[3]} />
        <StatTile label="Active SKUs" value={num(k.skus)} accent={CAT[4]} />
        <StatTile label="Customers" value={num(k.customers)} accent={CAT[5]} />
        <StatTile label="Bills · 12mo" value={num(k.bills)} accent={CAT[0]} />
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
        <Card title="AI Insights" icon="✨" accent={CAT[7]} onOpen={() => setOpen("insights")}>
          <ul className="flex flex-col gap-1.5 text-xs">
            {insights(data).slice(0, 3).map((t, i) => <li key={i} className="flex gap-1.5"><span style={{ color: CAT[7] }}>●</span><span>{t}</span></li>)}
          </ul>
        </Card>
        {(["state", "salesman", "transporter", "freight"] as const).map((key, i) => (
          <Card key={key} title={{ state: "State-wise Sale", salesman: "Sale by Salesman", transporter: "Transporter Workload", freight: "Freight Expense" }[key]}
            icon={{ state: "🗺️", salesman: "🧑‍💼", transporter: "🚚", freight: "💸" }[key]} accent={CAT[(i + 2) % CAT.length]} onOpen={() => setOpen(key)} pending>
            <div className="flex h-[120px] items-center justify-center rounded-lg border border-dashed border-[var(--border)] text-center text-xs font-semibold text-[var(--muted)]">
              Mapping pending — click for details
            </div>
          </Card>
        ))}
      </div>

      {open && <ReportOverlay k={open} data={data} onClose={() => setOpen(null)} />}
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

// ── Full report overlay ─────────────────────────────────────────────────────
function ReportOverlay({ k, data, onClose }: { k: ReportKey; data: AnalyticsBundle; onClose: () => void }) {
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
  return (
    <div className="fixed inset-0 z-50 flex justify-center bg-black/40 p-2 sm:p-6" onClick={onClose}>
      <div className="flex max-h-full w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--background)] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-5 py-3">
          <h2 className="text-lg font-extrabold">{titles[k]}</h2>
          <button onClick={onClose} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-bold hover:bg-[var(--surface-2)]">✕ Close</button>
        </div>
        <div className="overflow-auto p-5">
          <ReportBody k={k} data={data} />
        </div>
      </div>
    </div>
  );
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
      <Panel title="Revenue · last 90 days"><AreaTrend data={data.daily as never} valueKey="revenue" color={CAT[1]} height={280} /></Panel>
      <Panel title="Daily detail"><DataTable head={["Date", "Revenue", "Bills"]} rows={data.daily.slice().reverse().map((d) => [d.d, inr(d.revenue), num(d.bills)])} /></Panel>
    </div>
  );
  if (k === "daily-purchase") return (
    <div className="flex flex-col gap-4">
      <Panel title="Purchase · last 90 days"><AreaTrend data={data.purchase as never} valueKey="amount" color={CAT[2]} height={280} /></Panel>
      <Panel title="Daily detail"><DataTable head={["Date", "Amount", "Bills"]} rows={data.purchase.slice().reverse().map((d) => [d.d, inr(d.amount), num(d.bills)])} /></Panel>
    </div>
  );
  if (k === "sold-by-sku") return (
    <Panel title="Units sold by SKU · last 12 months (highest → lowest)">
      <RankedBars rows={data.sku.map((s) => ({ label: s.code, sub: s.name, value: s.units }))} unit="count" />
      <div className="mt-4"><DataTable head={["Code", "Item", "Units", "Revenue"]} rows={data.sku.map((s) => [s.code, s.name, num(s.units), inr(s.revenue)])} /></div>
    </Panel>
  );
  if (k === "by-category") return (
    <Panel title="Sales share by category · last 12 months">
      <Donut rows={data.category.map((c) => ({ label: c.category, value: c.revenue }))} size={240} />
      <div className="mt-4"><DataTable head={["Category", "Revenue", "Units"]} rows={data.category.map((c) => [c.category, inr(c.revenue), num(c.units)])} /></div>
    </Panel>
  );
  if (k === "top-customers") return <TopCustomers data={data} />;
  if (k === "returning") return (
    <Panel title="Returning customers · average days between purchases">
      <DataTable head={["Customer", "Bills", "Avg days", "Last bill"]} rows={data.returning.map((c) => [c.customer, num(c.bills), c.avgDays ? `${c.avgDays}d` : "—", c.lastBill])} />
    </Panel>
  );
  if (k === "slow-stock") return (
    <Panel title="Slow-moving stock · on hand, days since last sale">
      <DataTable head={["Code", "Item", "In stock", "Last sale", "Days idle"]} rows={data.slow.map((s) => [s.code, s.name, num(s.qty), s.lastSale, s.daysIdle >= 9999 ? "never sold" : `${num(s.daysIdle)}d`])} />
    </Panel>
  );
  if (k === "insights") return (
    <Panel title="Automated insights">
      <ul className="flex flex-col gap-2 text-sm">
        {insights(data).map((t, i) => <li key={i} className="flex gap-2 rounded-lg bg-[var(--surface-2)] px-3 py-2"><span style={{ color: CAT[7] }}>●</span><span>{t}</span></li>)}
      </ul>
    </Panel>
  );
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
        {items && items.length > 0 && <DataTable head={["Code", "Item", "Units", "Revenue"]} rows={items.map((it) => [it.code, it.name, num(it.units), inr(it.revenue)])} />}
        {items && items.length === 0 && !loading && <p className="text-sm text-[var(--muted)]">No item detail found for this customer.</p>}
      </Panel>
    </div>
  );
}

function DataTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  if (rows.length === 0) return <p className="py-4 text-center text-sm text-[var(--muted)]">No rows.</p>;
  return (
    <div className="overflow-auto rounded-lg border border-[var(--border)]">
      <table className="rtable">
        <thead><tr>{head.map((h, i) => <th key={i} className={i === 0 ? "" : "!text-right"}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={j === 0 ? "font-semibold" : "text-right tabular-nums"}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

// ── Rule-based insights (deterministic, no API key needed) ──────────────────
function insights(b: AnalyticsBundle): string[] {
  const out: string[] = [];
  const sum = (xs: number[]) => xs.reduce((a, x) => a + x, 0);
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
