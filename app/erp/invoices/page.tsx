import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { listInvoices } from "@/lib/erp/invoices";

export const dynamic = "force-dynamic";

const TAG: Record<string, string> = { draft: "n", final: "g", cancelled: "r" };
const money = (n: number) => (n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function InvoicesPage() {
  const invoices = await listInvoices();
  return (
    <>
      <PageHeader title="Invoices" subtitle="GST tax invoices generated from dispatched sales orders." />
      <div className="mb-4 flex items-center gap-3">
        <Link href="/erp/sales" className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-bold hover:bg-[var(--surface-2)]">↗ Sales Orders</Link>
        <Link href="/erp/packing-slip" className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-bold hover:bg-[var(--surface-2)]">▤ Packing Slips</Link>
      </div>
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
