import Link from "next/link";
import { notFound } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import PrintButton from "@/components/erp/PrintButton";
import GenerateInvoiceButton from "@/components/erp/GenerateInvoiceButton";
import { getSalesOrder } from "@/lib/erp/queries";

export const dynamic = "force-dynamic";

export default async function SalesOrderDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const so = await getSalesOrder(Number(id));
  if (!so) notFound();
  const total = so.lines.reduce((a, l) => a + l.qty * l.price, 0);
  // Anything dispatched but not yet invoiced can be billed now.
  const billable = so.lines.reduce(
    (a, l) => a + Math.max((l.dispatched_qty ?? 0) - ((l as { invoiced_qty?: number }).invoiced_qty ?? 0), 0),
    0,
  );

  return (
    <>
      <PageHeader title={so.so_no} subtitle={`${so.customer_name} · ${so.order_date} · ${so.status}`} />
      <div className="mb-4 flex items-center gap-3">
        <Link href="/erp/sales" className="text-sm font-semibold text-[var(--accent)]">← Sales Orders</Link>
        <Link href="/erp/scan/dispatch" className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-bold hover:bg-[var(--surface-2)]">🚚 Dispatch scan</Link>
        {billable > 0
          ? <GenerateInvoiceButton soId={so.id} />
          : <span className="text-xs font-semibold text-[var(--muted)]">Nothing to invoice yet — dispatch items first.</span>}
        {so.invoice_no && <Link href={`/erp/invoices`} className="text-xs font-semibold text-[var(--accent)]">Invoice {so.invoice_no} →</Link>}
        <PrintButton label="🖨 Print order" />
      </div>

      <section className="panel mb-4 print-area">
        <div className="panel-hd">Order details</div>
        <div className="grid grid-cols-2 gap-3 p-4 text-sm sm:grid-cols-4">
          <Detail label="Bill Type" value={so.bill_type || "—"} />
          <Detail label="Disc 18 (%)" value={so.disc_pct_18 ? so.disc_pct_18.toFixed(2) : "—"} />
          <Detail label="Disc 28 (%)" value={so.disc_pct_28 ? so.disc_pct_28.toFixed(2) : "—"} />
          <Detail label="Remarks" value={so.remarks || "—"} />
        </div>
      </section>

      <section className="panel print-area">
        <div className="panel-hd">Order lines &amp; fulfilment</div>
        <div className="overflow-x-auto">
          <table className="rtable">
            <thead>
              <tr>
                <th>SKU</th><th className="!text-right">MRP</th><th className="!text-right">Net Rate</th>
                <th className="!text-right">Disc %</th><th>Rate Type</th>
                <th className="!text-right">Ordered</th><th className="!text-right">FOC Qty</th>
                <th className="!text-right">Picked</th><th className="!text-right">Packed</th><th className="!text-right">Dispatched</th>
                <th className="!text-right">Line total</th>
              </tr>
            </thead>
            <tbody>
              {so.lines.map((l) => (
                <tr key={l.id}>
                  <td><span className="font-semibold">{l.sku_name}</span><div className="font-mono text-xs text-[var(--muted)]">{l.sku_code}</div></td>
                  <td className="num-cell">{l.mrp?.toFixed(2) ?? "—"}</td>
                  <td className="num-cell">{l.price.toFixed(2)}</td>
                  <td className="num-cell">{l.discount_pct ? l.discount_pct.toFixed(2) : "—"}</td>
                  <td>{l.rate_type || "—"}</td>
                  <td className="num-cell">{l.qty}</td>
                  <td className="num-cell">{l.foc_qty || "—"}</td>
                  <td className="num-cell">{l.picked_qty}</td>
                  <td className="num-cell">{l.packed_qty}</td>
                  <td className="num-cell">{l.dispatched_qty}</td>
                  <td className="num-cell">{(l.qty * l.price).toLocaleString("en-IN", { maximumFractionDigits: 0 })}</td>
                </tr>
              ))}
              <tr className="bg-[var(--accent-bg)] font-extrabold">
                <td colSpan={10} className="uppercase tracking-wide text-[var(--accent-strong)]">Total</td>
                <td className="num-cell">{total.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase text-[var(--muted-2)]">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}
