import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import ListFilters from "@/components/erp/ListFilters";
import { getSalesOrders } from "@/lib/erp/queries";
import { getCurrentUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { runQuery, isConfigured } from "@/lib/oracle";

export const dynamic = "force-dynamic";
const TAG: Record<string, string> = {
  draft: "n", confirmed: "n", picked: "n", packed: "n",
  "partially dispatched": "r", dispatched: "g", delivered: "g", cancelled: "r",
};

type OracleRow = Record<string, unknown>;

export default async function SalesOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  const tab = sp.tab === "oracle" ? "oracle" : "live";

  const orders = tab === "live"
    ? await getSalesOrders({ party: sp.party, from: sp.from, to: sp.to, status: sp.status })
    : [];

  let oracleRows: OracleRow[] = [];
  let oracleNote: string | null = null;
  if (tab === "oracle") {
    if (!isConfigured()) {
      oracleNote = "Oracle connector not configured.";
    } else {
      const party = sp.party?.trim() ? `'%${sp.party.trim().replace(/'/g, "''")}%'` : null;
      const from = sp.from?.trim() ? `'${sp.from.trim()}'` : null;
      const to = sp.to?.trim() ? `'${sp.to.trim()}'` : null;
      const sql = `
        SELECT TRMID, TO_CHAR(TRDATE,'YYYY-MM-DD') AS TRDATE,
               ACNTDESC, BILLAMOUNT, SALEAMOUNT, AGENT
        FROM VW_SALE_D
        WHERE TRDATE >= ADD_MONTHS(SYSDATE,-18)
          ${party ? `AND UPPER(ACNTDESC) LIKE UPPER(${party})` : ""}
          ${from ? `AND TRDATE >= TO_DATE(${from},'YYYY-MM-DD')` : ""}
          ${to ? `AND TRDATE <= TO_DATE(${to},'YYYY-MM-DD')` : ""}
        ORDER BY TRDATE DESC`;
      const result = await runQuery(sql).catch((e: Error) => {
        oracleNote = `Oracle query failed: ${e.message}`;
        return { rows: [] as OracleRow[] };
      });
      oracleRows = result.rows as OracleRow[];
    }
  }

  const tabLink = (t: string, label: string) => {
    const params = new URLSearchParams({ ...(sp.party ? { party: sp.party } : {}), ...(sp.from ? { from: sp.from } : {}), ...(sp.to ? { to: sp.to } : {}), tab: t });
    return `/erp/sales?${params}`;
  };

  return (
    <>
      <PageHeader
        title="Sales Orders"
        subtitle="Order lifecycle: draft → confirmed → picked → packed → dispatched."
        right={
          canWrite(user.role, "sales") ? (
            <Link href="/erp/sales/new" className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white hover:bg-[var(--accent-strong)]">
              + New Sales Order
            </Link>
          ) : undefined
        }
      />

      {/* Tab switcher */}
      <div className="mb-4 flex gap-0 border-b border-[var(--border)]">
        <Link href={tabLink("live", "")} className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors -mb-px ${tab === "live" ? "border-[var(--accent)] text-[var(--accent)]" : "border-transparent text-[var(--muted)] hover:text-[var(--fg)]"}`}>
          Live Orders (ERP)
        </Link>
        <Link href={tabLink("oracle", "")} className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors -mb-px ${tab === "oracle" ? "border-[var(--accent)] text-[var(--accent)]" : "border-transparent text-[var(--muted)] hover:text-[var(--fg)]"}`}>
          Oracle History (18 mo)
        </Link>
      </div>

      <ListFilters
        fields={
          tab === "live"
            ? [
                { key: "party", label: "Customer", placeholder: "Search customer…" },
                { key: "status", label: "Status", placeholder: "e.g. draft, confirmed" },
                { key: "from", label: "From date", type: "date" },
                { key: "to", label: "To date", type: "date" },
              ]
            : [
                { key: "party", label: "Party name", placeholder: "Search party…" },
                { key: "from", label: "From date", type: "date" },
                { key: "to", label: "To date", type: "date" },
              ]
        }
      />

      {tab === "live" ? (
        <section className="panel">
          <div className="overflow-x-auto">
            <table className="rtable">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Customer</th>
                  <th>Date</th>
                  <th>Invoice</th>
                  <th>Salesman</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id}>
                    <td><Link href={`/erp/sales/${o.id}`} className="font-semibold text-[var(--accent)] hover:underline">{o.so_no}</Link></td>
                    <td>{o.customer_name}</td>
                    <td className="text-[var(--muted)]">{o.order_date}</td>
                    <td>{o.invoice_no ?? "—"}</td>
                    <td className="text-[var(--muted)]">{(o as { salesman_name?: string }).salesman_name ?? "—"}</td>
                    <td><span className={`tag ${TAG[o.status] ?? "n"}`}>{o.status}</span></td>
                  </tr>
                ))}
                {orders.length === 0 && (
                  <tr><td colSpan={6} className="py-8 text-center text-[var(--muted)]">No orders found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <section className="panel">
          {oracleNote ? (
            <div className="p-6 text-center text-sm text-[var(--muted)]">{oracleNote}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="rtable">
                <thead>
                  <tr>
                    <th>SO No.</th>
                    <th>Party</th>
                    <th>Date</th>
                    <th className="!text-right">Amount ₹</th>
                    <th>Salesman</th>
                  </tr>
                </thead>
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
                  {oracleRows.length === 0 && (
                    <tr><td colSpan={5} className="py-8 text-center text-[var(--muted)]">No Oracle records found{isConfigured() ? " for this period/filter." : " — connector not connected."}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </>
  );
}
