import Link from "next/link";
import { notFound } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import ReceiveGoodsForm from "@/components/erp/ReceiveGoodsForm";
import { getPurchaseOrder, getGoodsReceipts, getWarehouses } from "@/lib/erp/queries";
import { getCurrentUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";

export const dynamic = "force-dynamic";
const TAG: Record<string, string> = { draft: "n", approved: "n", sent: "n", "partially received": "n", received: "g", cancelled: "r" };

export default async function PurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const po = await getPurchaseOrder(Number(id));
  if (!po) notFound();
  const [user, grns, warehouses] = await Promise.all([
    getCurrentUser(),
    getGoodsReceipts({}),
    getWarehouses(),
  ]);
  const editable = canWrite(user.role, "purchase");
  const myGrns = grns.filter((g) => g.po_id === po.id);
  const pendingLines = po.lines.filter((l) => l.remaining > 0);

  return (
    <>
      <PageHeader title={`PO ${po.po_no}`} subtitle={`${po.vendor_name} · ${po.status}`} />
      <div className="mb-4">
        <Link href="/erp/purchase" className="text-sm font-semibold text-[var(--accent)]">← Purchase Orders</Link>
      </div>

      <section className="panel mb-5">
        <div className="panel-hd">Lines — Ordered / Received / Remaining</div>
        <div className="overflow-x-auto">
          <table className="rtable">
            <thead><tr><th>SKU</th><th className="!text-right">Ordered</th><th className="!text-right">Received</th><th className="!text-right">Remaining</th><th className="!text-right">Rate</th></tr></thead>
            <tbody>
              {po.lines.map((l) => (
                <tr key={l.id}>
                  <td><div className="font-semibold">{l.sku_name}</div><div className="font-mono text-xs text-[var(--muted)]">{l.sku_code}</div></td>
                  <td className="num-cell">{l.qty}</td>
                  <td className="num-cell">{l.received_qty}</td>
                  <td className="num-cell font-bold" style={{ color: l.remaining > 0 ? "var(--accent)" : "var(--accent-2)" }}>{l.remaining > 0 ? l.remaining : "✓"}</td>
                  <td className="num-cell">{l.price.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {editable && pendingLines.length > 0 && (
        <ReceiveGoodsForm poId={po.id} lines={pendingLines} warehouses={warehouses} />
      )}

      <section className="panel mt-5">
        <div className="panel-hd">Goods Receipts ({myGrns.length})</div>
        <div className="overflow-x-auto">
          <table className="rtable">
            <thead><tr><th>GRN</th><th>Date</th><th>Status</th><th className="!text-right">Lines</th><th className="!text-right">Qty</th></tr></thead>
            <tbody>
              {myGrns.length === 0 && <tr><td colSpan={5} className="!py-6 text-center text-[var(--muted)]">No receipts yet.</td></tr>}
              {myGrns.map((g) => (
                <tr key={g.grn_id}>
                  <td><Link href={`/erp/grn/${g.grn_id}`} className="font-semibold text-[var(--accent)] hover:underline">{g.grn_no}</Link></td>
                  <td className="text-[var(--muted)]">{g.created_at.slice(0, 10)}</td>
                  <td><span className={`tag ${TAG[g.status] ?? "n"}`}>{g.status}</span></td>
                  <td className="num-cell">{g.lines}</td>
                  <td className="num-cell font-bold">{g.total_qty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
