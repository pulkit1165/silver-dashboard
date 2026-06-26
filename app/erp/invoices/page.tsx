import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import GenerateInvoiceButton from "@/components/erp/GenerateInvoiceButton";
import { listInvoices } from "@/lib/erp/invoices";
import { getPendingToBill } from "@/lib/erp/queries";

export const dynamic = "force-dynamic";

const TAG: Record<string, string> = { draft: "n", final: "g", cancelled: "r" };
const money = (n: number) => (n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function InvoicesPage() {
  const [invoices, pending] = await Promise.all([listInvoices(), getPendingToBill()]);
  return (
    <>
      <PageHeader title="Invoices" subtitle="GST tax invoices generated from dispatched sales orders." />
      <div className="mb-4 flex items-center gap-3">
        <Link href="/erp/sales" className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-bold hover:bg-[var(--surface-2)]">↗ Sales Orders</Link>
        <Link href="/erp/packing-slip" className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-bold hover:bg-[var(--surface-2)]">▤ Packing Slips</Link>
      </div>

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
                <tr><td colSpan={7} className="py-6 text-center text-[var(--muted)]">No invoices yet — open a dispatched sales order and click “Generate invoice”.</td></tr>
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
  );
}
