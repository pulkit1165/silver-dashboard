import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import ListFilters from "@/components/erp/ListFilters";
import GenerateVendorBillButton from "@/components/erp/GenerateVendorBillButton";
import { getVendorBillable, listVendorBills } from "@/lib/erp/vendor-bills";

export const dynamic = "force-dynamic";
const TAG: Record<string, string> = { draft: "n", final: "g", cancelled: "r" };
const money = (n: number) => (n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function VendorBillsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const [billable, bills] = await Promise.all([
    getVendorBillable(),
    listVendorBills({ vendor: sp.vendor, from: sp.from, to: sp.to, status: sp.status }),
  ]);
  return (
    <>
      <PageHeader title="Vendor Bills" subtitle="Bills raised from verified goods receipts against Purchase Orders." />
      <div className="mb-4 flex items-center gap-3">
        <Link href="/erp/purchase" className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-bold hover:bg-[var(--surface-2)]">↙ Purchase Orders</Link>
        <Link href="/erp/grn" className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-bold hover:bg-[var(--surface-2)]">▤ Goods Receipts</Link>
      </div>

      <ListFilters
        fields={[
          { key: "vendor", label: "Vendor", placeholder: "Search vendor…" },
          { key: "status", label: "Status", placeholder: "draft / final / cancelled" },
          { key: "from", label: "From date", type: "date" },
          { key: "to", label: "To date", type: "date" },
        ]}
      />

      <section className="panel mb-5">
        <div className="panel-hd">Pending to bill ({billable.length})</div>
        <div className="overflow-x-auto">
          <table className="rtable">
            <thead>
              <tr>
                <th>PO</th><th>Vendor</th><th>Date</th><th>Status</th>
                <th className="!text-right">Received</th><th className="!text-right">Billed</th>
                <th className="!text-right">Billable</th><th></th>
              </tr>
            </thead>
            <tbody>
              {billable.length === 0 && (
                <tr><td colSpan={8} className="!py-6 text-center text-[var(--muted)]">Nothing pending — every verified receipt has been billed.</td></tr>
              )}
              {billable.map((p) => (
                <tr key={p.po_id}>
                  <td><Link href={`/erp/purchase/${p.po_id}`} className="font-semibold text-[var(--accent)] hover:underline">{p.po_no}</Link></td>
                  <td>{p.vendor_name}</td>
                  <td className="text-[var(--muted)]">{p.order_date}</td>
                  <td><span className="tag n">{p.status}</span></td>
                  <td className="num-cell">{p.received_qty}</td>
                  <td className="num-cell">{p.billed_qty}</td>
                  <td className="num-cell font-bold text-[var(--accent)]">{p.billable_qty}</td>
                  <td><GenerateVendorBillButton poId={p.po_id} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="overflow-x-auto">
          <table className="rtable">
            <thead>
              <tr><th>Bill No</th><th>Date</th><th>Vendor</th><th>PO</th><th className="!text-right">Total</th><th>Status</th></tr>
            </thead>
            <tbody>
              {bills.length === 0 && (
                <tr><td colSpan={6} className="py-6 text-center text-[var(--muted)]">No vendor bills yet — verify a goods receipt and click "Bill now".</td></tr>
              )}
              {bills.map((b) => (
                <tr key={b.id}>
                  <td className="font-semibold">{b.bill_no || `Draft #${b.id}`}</td>
                  <td className="text-[var(--muted)]">{b.bill_date ?? "—"}</td>
                  <td>{b.vendor_name || "—"}</td>
                  <td className="font-mono text-xs">{b.po_no ?? "—"}</td>
                  <td className="num-cell font-semibold">₹{money(b.total)}</td>
                  <td><span className={`tag ${TAG[b.status] ?? "n"}`}>{b.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
