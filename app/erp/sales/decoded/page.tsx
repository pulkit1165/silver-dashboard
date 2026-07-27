import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import PromoteDecodedButton from "@/components/erp/PromoteDecodedButton";
import { listDecodedOrders } from "@/lib/erp/queries";

export const dynamic = "force-dynamic";

const money = (n: number) => (n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const SOURCE: Record<string, string> = {
  "decode-manual": "✍️ Manual", "decode-photo": "📷 Photo", "decode-text": "⌨️ Text",
  "decode-excel": "📄 Excel", "decode-voice": "🎙 Voice",
};

export default async function DecodedOrdersPage() {
  const orders = await listDecodedOrders();
  return (
    <>
      <PageHeader title="Decode Orders" subtitle="Salesman-written orders awaiting review. Promote one to an open sales order, then punch it in the Sales module." />
      <div className="mb-4 flex items-center gap-3">
        <Link href="/erp/sales/decode/manual" className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-bold text-white">✍️ Write order</Link>
        <Link href="/erp/sales/decode" className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-bold hover:bg-[var(--surface-2)]">📷 Decode from photo</Link>
        <Link href="/erp/sales" className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-bold hover:bg-[var(--surface-2)]">↗ Sales Orders</Link>
      </div>
      <section className="panel">
        <div className="panel-hd">Pending decoded orders ({orders.length})</div>
        <div className="overflow-x-auto">
          <table className="rtable">
            <thead>
              <tr>
                <th>Ref</th><th>Source</th><th>Party</th><th>Salesman</th><th>Order date</th><th>Required by</th>
                <th className="!text-right">Items</th><th className="!text-right">Value (MRP)</th><th></th>
              </tr>
            </thead>
            <tbody>
              {orders.length === 0 && (
                <tr><td colSpan={9} className="!py-6 text-center text-[var(--muted)]">No decoded orders — <Link href="/erp/sales/decode/manual" className="font-semibold text-[var(--accent)]">write one</Link>.</td></tr>
              )}
              {orders.map((o) => (
                <tr key={o.id}>
                  <td className="font-mono text-xs font-semibold">{o.so_no}</td>
                  <td><span className="tag n">{SOURCE[o.source] ?? o.source ?? "—"}</span></td>
                  <td>{o.customer_name}</td>
                  <td>{o.salesman_name || "—"}</td>
                  <td className="text-[var(--muted)]">{o.order_date}</td>
                  <td className="text-[var(--muted)]">{o.required_by || "—"}</td>
                  <td className="num-cell">{o.lines}</td>
                  <td className="num-cell font-semibold">₹{money(o.total)}</td>
                  <td className="!text-right"><PromoteDecodedButton id={o.id} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
