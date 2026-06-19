import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { getSalesOrders } from "@/lib/erp/queries";

export const dynamic = "force-dynamic";
const TAG: Record<string, string> = {
  draft: "n", confirmed: "n", picked: "n", packed: "n",
  "partially dispatched": "r", dispatched: "g", delivered: "g", cancelled: "r",
};

export default async function SalesOrdersPage() {
  const orders = await getSalesOrders();
  return (
    <>
      <PageHeader title="Sales Orders" subtitle="Order lifecycle: draft → confirmed → picked → packed → dispatched." />
      <section className="panel">
        <div className="overflow-x-auto">
          <table className="rtable">
            <thead><tr><th>Order</th><th>Customer</th><th>Date</th><th>Invoice</th><th>Status</th></tr></thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td><Link href={`/erp/sales/${o.id}`} className="font-semibold text-[var(--accent)] hover:underline">{o.so_no}</Link></td>
                  <td>{o.customer_name}</td>
                  <td className="text-[var(--muted)]">{o.order_date}</td>
                  <td>{o.invoice_no ?? "—"}</td>
                  <td><span className={`tag ${TAG[o.status] ?? "n"}`}>{o.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
