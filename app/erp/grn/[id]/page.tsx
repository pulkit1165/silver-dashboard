import Link from "next/link";
import { notFound } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import PrintButton from "@/components/erp/PrintButton";
import VerifyGoodsReceipt from "@/components/erp/VerifyGoodsReceipt";
import { getGoodsReceipt } from "@/lib/erp/queries";
import { getCurrentUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";

export const dynamic = "force-dynamic";

export default async function GrnDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const doc = await getGoodsReceipt(Number(id));
  if (!doc) notFound();
  const user = await getCurrentUser();
  const editable = canWrite(user.role, "purchase");
  const totalQty = doc.lines.reduce((a, l) => a + l.received_qty, 0);

  return (
    <>
      <PageHeader
        title={`Goods Receipt — ${doc.grn_no}`}
        subtitle={`${doc.vendor_name} · ${doc.po_no} · ${doc.status}`}
      />
      <div className="mb-4 flex items-center gap-3">
        <Link href={`/erp/purchase/${doc.po_id}`} className="text-sm font-semibold text-[var(--accent)]">← {doc.po_no}</Link>
        <PrintButton label="🖨 Print GRN" />
        {editable && doc.status === "received" && <VerifyGoodsReceipt grnId={doc.grn_id} />}
        {doc.status === "verified" && <span className="tag g">✓ Verified — vendor-billable</span>}
      </div>

      <section className="panel mb-4 print-area">
        <div className="panel-hd">Receipt header</div>
        <div className="grid grid-cols-2 gap-3 p-4 text-sm sm:grid-cols-4">
          <Detail label="GRN No">{doc.grn_no}</Detail>
          <Detail label="Date">{doc.created_at.slice(0, 10)}</Detail>
          <Detail label="PO No">{doc.po_no}</Detail>
          <Detail label="Vendor">{doc.vendor_name}</Detail>
        </div>
      </section>

      <section className="panel print-area">
        <div className="panel-hd">Receipt lines</div>
        <div className="overflow-x-auto">
          <table className="rtable">
            <thead>
              <tr><th>Sr</th><th>Code</th><th>Item Desc</th><th className="!text-right">PO Qty</th><th className="!text-right">Received Qty</th><th className="!text-right">Rate</th></tr>
            </thead>
            <tbody>
              {doc.lines.map((l, i) => (
                <tr key={l.grn_line_id}>
                  <td className="text-[var(--muted)]">{i + 1}</td>
                  <td className="font-mono text-xs">{l.sku_code}</td>
                  <td className="font-semibold">{l.sku_name}</td>
                  <td className="num-cell">{l.po_qty}</td>
                  <td className="num-cell font-bold">{l.received_qty}</td>
                  <td className="num-cell">{l.price.toFixed(2)}</td>
                </tr>
              ))}
              <tr className="bg-[var(--accent-bg)] font-extrabold">
                <td colSpan={4} className="uppercase tracking-wide text-[var(--accent-strong)]">Total</td>
                <td className="num-cell">{totalQty}</td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
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
