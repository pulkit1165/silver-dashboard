import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import GenerateInvoiceButton from "@/components/erp/GenerateInvoiceButton";
import ListFilters from "@/components/erp/ListFilters";
import { listInvoices } from "@/lib/erp/invoices";
import { getPendingToBill } from "@/lib/erp/queries";
import { runQuery, isConfigured } from "@/lib/oracle";

export const dynamic = "force-dynamic";

const TAG: Record<string, string> = { draft: "n", final: "g", cancelled: "r" };
const money = (n: number) => (n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
type OracleRow = Record<string, unknown>;

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const tab = sp.tab === "oracle" ? "oracle" : "live";

  const [invoices, pending] = tab === "live"
    ? await Promise.all([
        listInvoices({ party: sp.party, from: sp.from, to: sp.to, status: sp.status }),
        getPendingToBill(),
      ])
    : [[], []];

  let oracleRows: OracleRow[] = [];
  let oracleNote: string | null = null;
  if (tab === "oracle") {
    if (!isConfigured()) {
      oracleNote = "Oracle connector not configured.";
    } else {
      const party = sp.party?.trim() ? `'%${sp.party.trim().replace(/'/g, "''")}%'` : null;
      const result = await runQuery(`
        SELECT TRMID, TO_CHAR(TRDATE,'YYYY-MM-DD') AS TRDATE, BILLAMOUNT, PARTYID
        FROM DTC103
        WHERE TRDATE >= ADD_MONTHS(SYSDATE,-18)
          ${party ? `AND UPPER(TO_CHAR(PARTYID)) LIKE UPPER(${party})` : ""}
        ORDER BY TRDATE DESC`).catch((e: Error) => {
        oracleNote = `Oracle query failed: ${e.message}`;
        return { rows: [] as OracleRow[] };
      });
      oracleRows = result.rows as OracleRow[];
    }
  }

  const tabUrl = (t: string) => `/erp/invoices?tab=${t}`;

  return (
    <>
      <PageHeader title="Invoices" subtitle="GST tax invoices generated from dispatched sales orders." />
      <div className="mb-4 flex items-center gap-3">
        <Link href="/erp/sales" className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-bold hover:bg-[var(--surface-2)]">↗ Sales Orders</Link>
        <Link href="/erp/packing-slip" className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-bold hover:bg-[var(--surface-2)]">▤ Packing Slips</Link>
      </div>

      <div className="mb-4 flex gap-0 border-b border-[var(--border)]">
        <Link href={tabUrl("live")} className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors -mb-px ${tab === "live" ? "border-[var(--accent)] text-[var(--accent)]" : "border-transparent text-[var(--muted)] hover:text-[var(--fg)]"}`}>
          ERP Invoices
        </Link>
        <Link href={tabUrl("oracle")} className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors -mb-px ${tab === "oracle" ? "border-[var(--accent)] text-[var(--accent)]" : "border-transparent text-[var(--muted)] hover:text-[var(--fg)]"}`}>
          Oracle Billing History (18 mo)
        </Link>
      </div>

      {tab === "live" ? (
        <>
          <ListFilters
            fields={[
              { key: "party", label: "Buyer", placeholder: "Search buyer…" },
              { key: "status", label: "Status", placeholder: "draft / final / cancelled" },
              { key: "from", label: "From date", type: "date" },
              { key: "to", label: "To date", type: "date" },
            ]}
          />

          <section className="panel mb-5">
            <div className="panel-hd">Pending to bill ({pending.length})</div>
            <div className="overflow-x-auto">
              <table className="rtable">
                <thead>
                  <tr>
                    <th>Order</th><th>Customer</th><th>Date</th><th>Status</th>
                    <th className="!text-right">Dispatched</th><th className="!text-right">Invoiced</th>
                    <th className="!text-right">Billable</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {pending.length === 0 && (
                    <tr><td colSpan={8} className="!py-6 text-center text-[var(--muted)]">Nothing pending — every dispatch has been billed.</td></tr>
                  )}
                  {pending.map((o) => (
                    <tr key={o.id}>
                      <td><Link href={`/erp/sales/${o.id}`} className="font-semibold text-[var(--accent)] hover:underline">{o.so_no}</Link></td>
                      <td>{o.customer_name}</td>
                      <td className="text-[var(--muted)]">{o.order_date}</td>
                      <td><span className="tag n">{o.status}</span></td>
                      <td className="num-cell">{o.dispatched_qty}</td>
                      <td className="num-cell">{o.invoiced_qty}</td>
                      <td className="num-cell font-bold text-[var(--accent)]">{o.billable_qty}</td>
                      <td><GenerateInvoiceButton soId={o.id} label="🧾 Bill now" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel">
            <div className="overflow-x-auto">
              <table className="rtable">
                <thead>
                  <tr>
                    <th>Invoice No</th><th>Date</th><th>Buyer</th><th>Order</th><th>Tax</th>
                    <th className="!text-right">Grand Total</th><th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.length === 0 && (
                    <tr><td colSpan={7} className="py-6 text-center text-[var(--muted)]">No invoices yet — open a dispatched sales order and click "Generate invoice".</td></tr>
                  )}
                  {invoices.map((i) => (
                    <tr key={i.id}>
                      <td>
                        <Link href={`/erp/invoices/${i.id}`} className="font-semibold text-[var(--accent)] hover:underline">
                          {i.invoice_no ?? `Draft #${i.id}`}
                        </Link>
                      </td>
                      <td className="text-[var(--muted)]">{i.invoice_date ?? "—"}</td>
                      <td>{i.buyer_name || "—"}</td>
                      <td className="font-mono text-xs">{i.so_no ?? "—"}</td>
                      <td>{i.tax_type === "IGST" ? "IGST" : "CGST+SGST"}</td>
                      <td className="num-cell font-semibold">₹{money(i.grand_total)}</td>
                      <td><span className={`tag ${TAG[i.status] ?? "n"}`}>{i.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : (
        <>
          <ListFilters fields={[{ key: "party", label: "Party", placeholder: "Search party ID…" }, { key: "from", label: "From date", type: "date" }, { key: "to", label: "To date", type: "date" }]} />
          <section className="panel">
            {oracleNote ? (
              <div className="p-6 text-center text-sm text-[var(--muted)]">{oracleNote}</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="rtable">
                  <thead>
                    <tr>
                      <th>Bill No.</th><th>Date</th><th>Party ID</th>
                      <th className="!text-right">Amount ₹</th>
                    </tr>
                  </thead>
                  <tbody>
                    {oracleRows.map((r, i) => (
                      <tr key={i}>
                        <td className="font-mono text-sm">{String(r.TRMID ?? "")}</td>
                        <td className="text-[var(--muted)]">{String(r.TRDATE ?? "")}</td>
                        <td className="text-[var(--muted)]">{String(r.PARTYID ?? "—")}</td>
                        <td className="num-cell tabular-nums">{Number(r.BILLAMOUNT || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}</td>
                      </tr>
                    ))}
                    {oracleRows.length === 0 && (
                      <tr><td colSpan={4} className="py-8 text-center text-[var(--muted)]">No Oracle billing records found{isConfigured() ? " for this period." : " — connector not connected."}</td></tr>
                    )}
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
