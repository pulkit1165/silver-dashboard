import Link from "next/link";
import { notFound } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import PrintButton from "@/components/erp/PrintButton";
import EditableText from "@/components/erp/EditableText";
import EditableRate from "@/components/erp/EditableRate";
import { getDeliveryOrder } from "@/lib/erp/queries";
import { getCurrentUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";

export const dynamic = "force-dynamic";

export default async function DeliveryOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const doc = await getDeliveryOrder(Number(id));
  if (!doc) notFound();
  const user = await getCurrentUser();
  const editable = canWrite(user.role, "dispatch");
  const headerEndpoint = `/api/erp/packages/${doc.package_id}`;

  const totalDoQty = doc.lines.reduce((a, l) => a + l.do_qty, 0);
  const totalOrderQty = doc.lines.reduce((a, l) => a + l.order_qty, 0);

  return (
    <>
      <PageHeader
        title={`Delivery Order — Case ${doc.package_no}`}
        subtitle={`${doc.customer_name} · ${doc.so_no} · ${doc.status}`}
      />
      <div className="mb-4 flex items-center gap-3">
        <Link href={`/erp/sales/${doc.so_id}`} className="text-sm font-semibold text-[var(--accent)]">← {doc.so_no}</Link>
        <PrintButton label="🖨 Print Delivery Order" />
      </div>

      <section className="panel mb-4 print-area">
        <div className="panel-hd">Delivery Order header</div>
        <div className="grid grid-cols-2 gap-3 p-4 text-sm sm:grid-cols-4">
          <Detail label="TR Srno">{doc.package_id}</Detail>
          <Detail label="TR Date">{doc.created_at.slice(0, 10)}</Detail>
          <Detail label="Pack No">{doc.package_no}</Detail>
          <Detail label="S Order">{doc.so_no}</Detail>
          <Detail label="TR Type">
            {editable ? <EditableText value={doc.tr_type} endpoint={headerEndpoint} field="tr_type" placeholder="e.g. DO26" /> : doc.tr_type || "—"}
          </Detail>
          <Detail label="DO Type">
            {editable ? <EditableText value={doc.do_type} endpoint={headerEndpoint} field="do_type" placeholder="e.g. PS" /> : doc.do_type || "—"}
          </Detail>
          <Detail label="PSlip No">
            {editable ? <EditableText value={doc.slip_no} endpoint={headerEndpoint} field="slip_no" placeholder="e.g. PS26/000001" /> : doc.slip_no || "—"}
          </Detail>
          <Detail label="Party">{doc.customer_name}</Detail>
        </div>
      </section>

      <section className="panel print-area">
        <div className="panel-hd">Delivery Order lines</div>
        <div className="overflow-x-auto">
          <table className="rtable">
            <thead>
              <tr>
                <th>Sr</th><th>Code</th><th>Item Desc</th>
                <th className="!text-right">Order Qty</th><th className="!text-right">Do Qty (Bal FG)</th>
                <th className="!text-right">MRP</th><th className="!text-right">Net Rate</th><th>Rate Type</th>
                <th className="!text-right">Disc %</th><th className="!text-right">FOC Qty</th>
                <th className="!text-right">Net Wt</th><th className="!text-right">Pack Wt</th><th className="!text-right">Bal RM</th>
              </tr>
            </thead>
            <tbody>
              {doc.lines.map((l, i) => {
                const lineEndpoint = `/api/erp/package-lines/${l.package_line_id}`;
                return (
                  <tr key={l.package_line_id}>
                    <td className="text-[var(--muted)]">{i + 1}</td>
                    <td className="font-mono text-xs">{l.sku_code}</td>
                    <td className="font-semibold">{l.sku_name}</td>
                    <td className="num-cell">{l.order_qty}</td>
                    <td className="num-cell font-bold" style={l.do_qty > l.order_qty ? { color: "var(--accent)" } : undefined}>{l.do_qty}</td>
                    <td className="num-cell">{l.mrp.toFixed(2)}</td>
                    <td className="num-cell">{l.net_rate.toFixed(2)}</td>
                    <td>{l.rate_type || "—"}</td>
                    <td className="num-cell">{l.discount_pct ? l.discount_pct.toFixed(2) : "—"}</td>
                    <td className="num-cell">{l.foc_qty || "—"}</td>
                    <td className="num-cell">
                      {editable ? <EditableRate value={l.net_wt} endpoint={lineEndpoint} field="net_wt" /> : l.net_wt.toFixed(2)}
                    </td>
                    <td className="num-cell">
                      {editable ? <EditableRate value={l.pack_wt} endpoint={lineEndpoint} field="pack_wt" /> : l.pack_wt.toFixed(2)}
                    </td>
                    <td className="num-cell">
                      {editable ? <EditableRate value={l.bal_rm} endpoint={lineEndpoint} field="bal_rm" /> : l.bal_rm.toFixed(2)}
                    </td>
                  </tr>
                );
              })}
              <tr className="bg-[var(--accent-bg)] font-extrabold">
                <td colSpan={3} className="uppercase tracking-wide text-[var(--accent-strong)]">Total</td>
                <td className="num-cell">{totalOrderQty}</td>
                <td className="num-cell">{totalDoQty}</td>
                <td colSpan={8}></td>
              </tr>
            </tbody>
          </table>
        </div>
        {editable && <p className="border-t border-[var(--border)] p-3 text-xs text-[var(--muted)]">Click any header field or Net Wt / Pack Wt / Bal RM to edit.</p>}
      </section>
    </>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase text-[var(--muted-2)]">{label}</div>
      <div className="font-semibold">{children}</div>
    </div>
  );
}
