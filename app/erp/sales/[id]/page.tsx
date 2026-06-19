import Link from "next/link";
import { notFound } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import PrintButton from "@/components/erp/PrintButton";
import { getSalesOrder } from "@/lib/erp/queries";

export const dynamic = "force-dynamic";

export default async function SalesOrderDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const so = await getSalesOrder(Number(id));
  if (!so) notFound();
  const total = so.lines.reduce((a, l) => a + l.qty * l.price, 0);

  return (
    <>
      <PageHeader title={so.so_no} subtitle={`${so.customer_name} · ${so.order_date} · ${so.status}`} />
      <div className="mb-4 flex items-center gap-3">
        <Link href="/erp/sales" className="text-sm font-semibold text-[var(--accent)]">← Sales Orders</Link>
        <Link href="/erp/scan/dispatch" className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-bold hover:bg-[var(--surface-2)]">🚚 Dispatch scan</Link>
        <PrintButton label="🖨 Print order" />
      </div>

      <section className="panel print-area">
        <div className="panel-hd">Order lines &amp; fulfilment</div>
        <div className="overflow-x-auto">
          <table className="rtable">
            <thead>
              <tr><th>SKU</th><th className="!text-right">Ordered</th><th className="!text-right">Picked</th><th className="!text-right">Packed</th><th className="!text-right">Dispatched</th><th className="!text-right">Line total</th></tr>
            </thead>
            <tbody>
              {so.lines.map((l) => (
                <tr key={l.id}>
                  <td><span className="font-semibold">{l.sku_name}</span><div className="font-mono text-xs text-[var(--muted)]">{l.sku_code}</div></td>
                  <td className="num-cell">{l.qty}</td>
                  <td className="num-cell">{l.picked_qty}</td>
                  <td className="num-cell">{l.packed_qty}</td>
                  <td className="num-cell">{l.dispatched_qty}</td>
                  <td className="num-cell">{(l.qty * l.price).toLocaleString("en-IN", { maximumFractionDigits: 0 })}</td>
                </tr>
              ))}
              <tr className="bg-[var(--accent-bg)] font-extrabold">
                <td colSpan={5} className="uppercase tracking-wide text-[var(--accent-strong)]">Total</td>
                <td className="num-cell">{total.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
