import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import ListFilters from "@/components/erp/ListFilters";
import { getSalesOrderList } from "@/lib/erp/queries";
import { getCurrentUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { getRawSql } from "@/lib/erp/db";
import { orderDisplayStatus, STATUS_FILTERS, TONE_STYLE } from "@/lib/erp/orderStatus";

export const dynamic = "force-dynamic";

type OracleRow = Record<string, unknown>;
const inr = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export default async function SalesOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  const canCreate = canWrite(user.role, "sales");
  const tab = sp.tab === "oracle" ? "oracle" : "live";

  // ── Live ERP orders (the Shopify-style list) ──────────────────────────────
  const all = tab === "live"
    ? await getSalesOrderList({ party: sp.party, from: sp.from, to: sp.to, item: sp.item })
    : [];
  const withStatus = all.map((o) => ({ ...o, disp: orderDisplayStatus(o) }));
  const orders = sp.status ? withStatus.filter((o) => o.disp.key === sp.status) : withStatus;

  const kpiCount = orders.length;
  const kpiValue = orders.reduce((s, o) => s + o.total, 0);
  const kpiItems = orders.reduce((s, o) => s + o.ordered_qty, 0);

  // ── Oracle history (legacy sales, read-only) ──────────────────────────────
  let oracleRows: OracleRow[] = [];
  let oracleNote: string | null = null;
  if (tab === "oracle") {
    try {
      const db = getRawSql();
      const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - 18);
      const cutoffStr = cutoff.toISOString().slice(0, 10);
      const party = sp.party?.trim() || null;
      const spFrom = sp.from?.trim() || null;
      const spTo = sp.to?.trim() || null;
      const partyCond = party ? db`AND UPPER(data->>'ACNTDESC') LIKE UPPER(${"%" + party + "%"})` : db``;
      const fromCond = spFrom ? db`AND (data->>'TRDATE')::timestamptz >= ${spFrom}::date::timestamp AT TIME ZONE 'Asia/Kolkata'` : db``;
      const toCond = spTo ? db`AND (data->>'TRDATE')::timestamptz < (${spTo}::date + interval '1 day')::timestamp AT TIME ZONE 'Asia/Kolkata'` : db``;
      oracleRows = await db`
        SELECT data->>'TRMID' AS "TRMID",
               ((data->>'TRDATE')::timestamptz AT TIME ZONE 'Asia/Kolkata')::date::text AS "TRDATE",
               data->>'ACNTDESC' AS "ACNTDESC",
               (data->>'BILLAMOUNT')::numeric AS "BILLAMOUNT",
               (data->>'SALEAMOUNT')::numeric AS "SALEAMOUNT",
               data->>'AGENT' AS "AGENT"
          FROM oracle_raw
         WHERE source_table = 'VW_SALE_D'
           AND (data->>'TRDATE')::timestamptz >= ${cutoffStr}::date::timestamp AT TIME ZONE 'Asia/Kolkata'
           ${partyCond} ${fromCond} ${toCond}
         ORDER BY (data->>'TRDATE')::timestamptz DESC` as OracleRow[];
    } catch (e) {
      oracleNote = `Query failed: ${(e as Error).message}`;
    }
  }

  const carry = (t: string) => {
    const p = new URLSearchParams();
    for (const k of ["party", "item", "status", "from", "to"] as const) if (sp[k]) p.set(k, sp[k]!);
    p.set("tab", t);
    return `/erp/sales?${p}`;
  };

  return (
    <>
      <PageHeader
        title="Sales Orders"
        subtitle="Every order — decoded, punched, packed and dispatched — newest first. Filter by customer, item, status or date."
        right={canCreate ? (
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/erp/sales/decode" className="rounded-lg border border-[var(--accent)] bg-[var(--accent-bg)] px-4 py-2 text-sm font-bold text-[var(--accent-strong)] hover:bg-[var(--accent)] hover:text-white">⬆ Upload / Decode</Link>
            <Link href="/erp/sales/new" className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white hover:bg-[var(--accent-strong)]">+ New Sales Order</Link>
          </div>
        ) : undefined}
      />

      {/* Tab switcher */}
      <div className="mb-4 flex gap-0 border-b border-[var(--border)]">
        <Link href={carry("live")} className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${tab === "live" ? "border-[var(--accent)] text-[var(--accent)]" : "border-transparent text-[var(--muted)] hover:text-[var(--fg)]"}`}>Orders</Link>
        <Link href={carry("oracle")} className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${tab === "oracle" ? "border-[var(--accent)] text-[var(--accent)]" : "border-transparent text-[var(--muted)] hover:text-[var(--fg)]"}`}>Oracle History (18 mo)</Link>
      </div>

      {tab === "live" ? (
        <>
          {/* KPI strip */}
          <div className="mb-4 grid grid-cols-3 gap-3">
            <Kpi label="Orders" value={kpiCount.toLocaleString("en-IN")} />
            <Kpi label="Order value" value={inr(kpiValue)} />
            <Kpi label="Items" value={kpiItems.toLocaleString("en-IN")} />
          </div>

          <ListFilters fields={[
            { key: "party", label: "Customer", placeholder: "Customer name…" },
            { key: "item", label: "Item", placeholder: "Item code or name…" },
            { key: "status", label: "Status", type: "select", options: STATUS_FILTERS },
            { key: "from", label: "From date", type: "date" },
            { key: "to", label: "To date", type: "date" },
          ]} />

          <section className="panel overflow-hidden">
            <div className="overflow-x-auto">
              <table className="rtable">
                <thead>
                  <tr>
                    <th>Order</th><th>Date</th><th>Customer</th>
                    <th className="!text-right">Items</th><th className="!text-right">Total</th>
                    <th>Status</th><th>Salesman</th><th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.length === 0 && (
                    <tr><td colSpan={8} className="!py-10 text-center text-[var(--muted)]">No orders match these filters.</td></tr>
                  )}
                  {orders.map((o) => (
                    <tr key={o.id} className="hover:bg-[var(--surface-2)]">
                      <td><Link href={`/erp/sales/${o.id}`} className="font-bold text-[var(--accent)] hover:underline">{o.so_no}</Link></td>
                      <td className="whitespace-nowrap text-[var(--muted)]">{o.order_date || o.created_at?.slice(0, 10) || "—"}</td>
                      <td className="font-semibold">{o.customer_name}</td>
                      <td className="num-cell text-[var(--muted)]">{o.lines} {o.lines === 1 ? "item" : "items"}</td>
                      <td className="num-cell font-semibold tabular-nums">{inr(o.total)}</td>
                      <td><StatusPill s={o.disp} /></td>
                      <td className="text-xs text-[var(--muted)]">{o.salesman_name || "—"}</td>
                      <td className="text-xs"><span className="rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-[10px] font-bold uppercase text-[var(--muted)]">{o.source}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {orders.length >= 1000 && <p className="border-t border-[var(--border)] p-2 text-center text-xs text-[var(--muted)]">Showing the most recent 1000 — narrow with filters to see older orders.</p>}
          </section>
        </>
      ) : (
        <>
          <ListFilters fields={[
            { key: "party", label: "Party name", placeholder: "Search party…" },
            { key: "from", label: "From date", type: "date" },
            { key: "to", label: "To date", type: "date" },
          ]} />
          <section className="panel">
            {oracleNote ? (
              <div className="p-6 text-center text-sm text-[var(--muted)]">{oracleNote}</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="rtable">
                  <thead><tr><th>SO No.</th><th>Party</th><th>Date</th><th className="!text-right">Amount ₹</th><th>Salesman</th></tr></thead>
                  <tbody>
                    {oracleRows.map((r, i) => (
                      <tr key={i}>
                        <td className="font-mono text-sm">{String(r.TRMID ?? "")}</td>
                        <td>{String(r.ACNTDESC ?? "")}</td>
                        <td className="text-[var(--muted)]">{String(r.TRDATE ?? "")}</td>
                        <td className="num-cell tabular-nums">{Number(r.BILLAMOUNT || r.SALEAMOUNT || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}</td>
                        <td className="text-[var(--muted)]">{String(r.AGENT ?? "—")}</td>
                      </tr>
                    ))}
                    {oracleRows.length === 0 && <tr><td colSpan={5} className="py-8 text-center text-[var(--muted)]">No records found for this period/filter.</td></tr>}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
      <div className="text-xs font-semibold text-[var(--muted)]">{label}</div>
      <div className="mt-0.5 text-xl font-extrabold tabular-nums">{value}</div>
    </div>
  );
}

function StatusPill({ s }: { s: { label: string; tone: keyof typeof TONE_STYLE } }) {
  const c = TONE_STYLE[s.tone];
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold" style={{ background: c.bg, color: c.fg }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: c.dot }} />{s.label}
    </span>
  );
}
