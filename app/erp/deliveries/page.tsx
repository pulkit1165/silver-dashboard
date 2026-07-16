import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import ListFilters from "@/components/erp/ListFilters";
import { getDeliveryOrders } from "@/lib/erp/queries";
import { runQuery, isConfigured } from "@/lib/oracle";

export const dynamic = "force-dynamic";
const TAG: Record<string, string> = { open: "n", packed: "n", verified: "g", dispatched: "g" };
const STATUS_OPTIONS = [
  { value: "packed", label: "Packed — pending verification" },
  { value: "verified", label: "Verified — billable" },
  { value: "open", label: "Open" },
  { value: "dispatched", label: "Dispatched" },
  { value: "all", label: "All" },
];
type OracleRow = Record<string, unknown>;

export default async function DeliveryOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const tab = sp.tab === "oracle" ? "oracle" : "live";
  const status = sp.status ?? "packed";

  const rows = tab === "live"
    ? await getDeliveryOrders({ party: sp.party, from: sp.from, to: sp.to, status: status === "all" ? undefined : status })
    : [];

  let oracleRows: OracleRow[] = [];
  let oracleNote: string | null = null;
  if (tab === "oracle") {
    if (!isConfigured()) {
      oracleNote = "Oracle connector not configured.";
    } else {
      const result = await runQuery(`
        SELECT TRMID, TO_CHAR(TRDATE,'YYYY-MM-DD') AS TRDATE, PARTYID
        FROM DTC106
        WHERE TRDATE >= ADD_MONTHS(SYSDATE,-18)
        ORDER BY TRDATE DESC`).catch((e: Error) => {
        oracleNote = `Oracle query failed: ${e.message}`;
        return { rows: [] as OracleRow[] };
      });
      oracleRows = result.rows as OracleRow[];
    }
  }

  const tabUrl = (t: string) => `/erp/deliveries?tab=${t}`;

  return (
    <>
      <PageHeader
        title="Delivery Orders"
        subtitle="Every packed case (DO) — TR Type, DO Type, PSlip No, and the full item-wise detail. Verify a case to make it billable."
      />

      <div className="mb-4 flex gap-0 border-b border-[var(--border)]">
        <Link href={tabUrl("live")} className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors -mb-px ${tab === "live" ? "border-[var(--accent)] text-[var(--accent)]" : "border-transparent text-[var(--muted)] hover:text-[var(--fg)]"}`}>
          ERP Delivery Orders
        </Link>
        <Link href={tabUrl("oracle")} className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors -mb-px ${tab === "oracle" ? "border-[var(--accent)] text-[var(--accent)]" : "border-transparent text-[var(--muted)] hover:text-[var(--fg)]"}`}>
          Oracle Delivery History (18 mo)
        </Link>
      </div>

      {tab === "live" ? (
        <>
          <ListFilters
            fields={[
              { key: "status", label: "Status", type: "select", options: STATUS_OPTIONS },
              { key: "party", label: "Customer", placeholder: "Search customer…" },
              { key: "from", label: "From date", type: "date" },
              { key: "to", label: "To date", type: "date" },
            ]}
          />
          <section className="panel">
            <div className="overflow-x-auto">
              <table className="rtable">
                <thead>
                  <tr>
                    <th>DO (Case)</th><th>TR Type</th><th>DO Type</th><th>PSlip No</th>
                    <th>S Order</th><th>Customer</th><th>Date</th><th>Status</th>
                    <th className="!text-right">Lines</th><th className="!text-right">Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr><td colSpan={10} className="!py-6 text-center text-[var(--muted)]">
                      {status === "packed" ? "Nothing pending verification right now." : "No delivery orders match this filter."}
                    </td></tr>
                  )}
                  {rows.map((r) => (
                    <tr key={r.package_id}>
                      <td><Link href={`/erp/packages/${r.package_id}`} className="font-semibold text-[var(--accent)] hover:underline">Case {r.package_no}</Link></td>
                      <td>{r.tr_type || "—"}</td>
                      <td>{r.do_type || "—"}</td>
                      <td className="font-mono text-xs">{r.slip_no || "—"}</td>
                      <td><Link href={`/erp/sales/${r.so_id}`} className="font-mono text-xs text-[var(--accent)] hover:underline">{r.so_no}</Link></td>
                      <td>{r.customer_name}</td>
                      <td className="text-[var(--muted)]">{r.created_at.slice(0, 10)}</td>
                      <td><span className={`tag ${TAG[r.status] ?? "n"}`}>{r.status}</span></td>
                      <td className="num-cell">{r.lines}</td>
                      <td className="num-cell font-bold">{r.total_qty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : (
        <section className="panel">
          {oracleNote ? (
            <div className="p-6 text-center text-sm text-[var(--muted)]">{oracleNote}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="rtable">
                <thead>
                  <tr>
                    <th>DO No.</th>
                    <th>Date</th>
                    <th>Party ID</th>
                  </tr>
                </thead>
                <tbody>
                  {oracleRows.map((r, i) => (
                    <tr key={i}>
                      <td className="font-mono text-sm">{String(r.TRMID ?? "")}</td>
                      <td className="text-[var(--muted)]">{String(r.TRDATE ?? "")}</td>
                      <td className="text-[var(--muted)]">{String(r.PARTYID ?? "—")}</td>
                    </tr>
                  ))}
                  {oracleRows.length === 0 && (
                    <tr><td colSpan={3} className="py-8 text-center text-[var(--muted)]">No Oracle delivery records found{isConfigured() ? " for this period." : " — connector not connected."}</td></tr>
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
