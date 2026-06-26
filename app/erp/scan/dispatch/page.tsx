import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import CasePacking from "@/components/erp/CasePacking";
import { getPackableOrders, getOrderPacking, getPendingToPack } from "@/lib/erp/queries";

export const dynamic = "force-dynamic";

export default async function DispatchScanPage() {
  const [orders, pending] = await Promise.all([getPackableOrders(), getPendingToPack()]);
  const initial = orders[0] ? await getOrderPacking(orders[0].id) : null;
  return (
    <>
      <PageHeader
        title="Pack & Dispatch"
        subtitle="Pick a sales order, set a case number, then scan each item and enter how many you packed. Packed items move to the case; only the quantity left stays to pack."
      />

      <section className="panel mb-5">
        <div className="panel-hd">Pending to pack ({pending.length})</div>
        <div className="overflow-x-auto">
          <table className="rtable">
            <thead>
              <tr>
                <th>Order</th><th>Customer</th><th>Date</th><th>Status</th>
                <th className="!text-right">Lines</th><th className="!text-right">Ordered</th>
                <th className="!text-right">Packed</th><th className="!text-right">Pending</th>
              </tr>
            </thead>
            <tbody>
              {pending.length === 0 && (
                <tr><td colSpan={8} className="!py-6 text-center text-[var(--muted)]">Nothing pending — every confirmed order is fully packed.</td></tr>
              )}
              {pending.map((o) => (
                <tr key={o.id}>
                  <td><Link href={`#order-${o.id}`} className="font-semibold text-[var(--accent)] hover:underline">{o.so_no}</Link></td>
                  <td>{o.customer_name}</td>
                  <td className="text-[var(--muted)]">{o.order_date}</td>
                  <td><span className="tag n">{o.status}</span></td>
                  <td className="num-cell">{o.lines}</td>
                  <td className="num-cell">{o.ordered_qty}</td>
                  <td className="num-cell">{o.packed_qty}</td>
                  <td className="num-cell font-bold text-[var(--accent)]">{o.pending_qty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <CasePacking
        orders={orders.map((o) => ({ id: o.id, so_no: o.so_no, customer_name: o.customer_name, status: o.status }))}
        initial={initial ?? null}
      />
    </>
  );
}
