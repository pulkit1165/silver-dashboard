import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import ListFilters from "@/components/erp/ListFilters";
import { getGoodsReceipts } from "@/lib/erp/queries";

export const dynamic = "force-dynamic";
const TAG: Record<string, string> = { received: "n", verified: "g" };
const STATUS_OPTIONS = [
  { value: "received", label: "Received — pending verification" },
  { value: "verified", label: "Verified — billable" },
  { value: "all", label: "All" },
];

export default async function GrnPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const status = sp.status ?? "received";
  const rows = await getGoodsReceipts({ vendor: sp.vendor, from: sp.from, to: sp.to, status: status === "all" ? undefined : status });
  return (
    <>
      <PageHeader
        title="Goods Receipts"
        subtitle="Every GRN raised against a Purchase Order. Verify a receipt to make it vendor-billable."
      />
      <div className="mb-4">
        <Link href="/erp/purchase" className="text-sm font-semibold text-[var(--accent)]">↙ Purchase Orders</Link>
      </div>
      <ListFilters
        fields={[
          { key: "status", label: "Status", type: "select", options: STATUS_OPTIONS },
          { key: "vendor", label: "Vendor", placeholder: "Search vendor…" },
          { key: "from", label: "From date", type: "date" },
          { key: "to", label: "To date", type: "date" },
        ]}
      />
      <section className="panel">
        <div className="overflow-x-auto">
          <table className="rtable">
            <thead>
              <tr>
                <th>GRN</th><th>PO</th><th>Vendor</th><th>Date</th><th>Status</th>
                <th className="!text-right">Lines</th><th className="!text-right">Qty</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={7} className="!py-6 text-center text-[var(--muted)]">
                  {status === "received" ? "Nothing pending verification right now." : "No goods receipts match this filter."}
                </td></tr>
              )}
              {rows.map((r) => (
                <tr key={r.grn_id}>
                  <td><Link href={`/erp/grn/${r.grn_id}`} className="font-semibold text-[var(--accent)] hover:underline">{r.grn_no}</Link></td>
                  <td><Link href={`/erp/purchase/${r.po_id}`} className="font-mono text-xs text-[var(--accent)] hover:underline">{r.po_no}</Link></td>
                  <td>{r.vendor_name}</td>
                  <td className="text-[var(--muted)]">{r.created_at.slice(0, 10)}</td>
                  <td><span className={`tag ${TAG[r.status] ?? "n"}`}>{r.status}</span></td>
                  <td className="num-cell">{r.lines}</td>
                  <td className="num-cell font-bold">{r.total_qty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
