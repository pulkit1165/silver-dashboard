import PageHeader from "@/components/PageHeader";
import { getPurchaseOrders } from "@/lib/erp/queries";

export const dynamic = "force-dynamic";
const TAG: Record<string, string> = {
  draft: "n", approved: "n", sent: "n", "partially received": "r", completed: "g", cancelled: "r",
};

export default async function PurchasePage() {
  const rows = await getPurchaseOrders();
  return (
    <>
      <PageHeader title="Purchase Orders" subtitle="PO lifecycle: draft → approved → sent → received → completed." />
      <section className="panel">
        <div className="overflow-x-auto">
          <table className="rtable">
            <thead><tr><th>PO</th><th>Vendor</th><th>Date</th><th>Status</th></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td className="font-semibold">{p.po_no}</td>
                  <td>{p.vendor_name}</td>
                  <td className="text-[var(--muted)]">{p.order_date}</td>
                  <td><span className={`tag ${TAG[p.status] ?? "n"}`}>{p.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
