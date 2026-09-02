import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import ListFilters from "@/components/erp/ListFilters";
import { getRetailerNetworkOrders } from "@/lib/erp/retailerNetwork";
import { getCurrentUser } from "@/lib/erp/session";

export const dynamic = "force-dynamic";
const inr = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const ALLOWED = new Set(["admin", "sales", "accounts", "retailer"]);

export default async function RetailerNetworkPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  if (!ALLOWED.has(user.role)) {
    return <><PageHeader title="Silver Retailer Network" subtitle="Orders routed to the retailer firm." /><p className="text-sm text-[var(--muted)]">You don’t have access to this panel.</p></>;
  }
  const rows = await getRetailerNetworkOrders({ party: sp.party, from: sp.from, to: sp.to });
  const totQty = rows.reduce((s, r) => s + r.k_qty, 0);
  const totVal = rows.reduce((s, r) => s + r.k_value, 0);

  return (
    <>
      <PageHeader
        title="🤝 Silver Retailer Network"
        subtitle="Orders (and the K‑portion of split O/K orders) transferred to the retailer firm — billing happens here, not on the Silver Industries panel."
      />
      <ListFilters fields={[
        { key: "party", label: "Customer", placeholder: "Customer name…" },
        { key: "from", label: "From", type: "date" },
        { key: "to", label: "To", type: "date" },
      ]} />
      <div className="mb-3 flex flex-wrap gap-4 text-sm">
        <span className="rounded-lg bg-[var(--surface-2)] px-3 py-1.5 font-bold">{rows.length} orders</span>
        <span className="rounded-lg bg-[var(--surface-2)] px-3 py-1.5 font-bold">K qty: {totQty.toLocaleString("en-IN")}</span>
        <span className="rounded-lg bg-[var(--surface-2)] px-3 py-1.5 font-bold">K value: {inr(totVal)}</span>
      </div>
      <section className="panel">
        <div className="overflow-x-auto">
          <table className="rtable">
            <thead>
              <tr>
                <th>SO No</th><th>Date</th><th>Customer</th><th>Salesman</th><th>Type</th>
                <th className="!text-right">K items</th><th className="!text-right">K qty</th><th className="!text-right">K value</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/erp/sales/silver-retailer-network/${r.id}`} className="font-semibold text-[var(--accent)] hover:underline">{r.so_no || `#${r.id}`}</Link>
                  </td>
                  <td>{r.order_date}</td>
                  <td>{r.customer_name}</td>
                  <td>{r.salesman_name}</td>
                  <td><span className={`tag ${r.bill_type === "K" ? "r" : "n"}`}>{r.bill_type || "K"}</span></td>
                  <td className="num-cell">{r.k_lines}{r.bill_type === "O/K" ? ` / ${r.total_lines}` : ""}</td>
                  <td className="num-cell">{r.k_qty.toLocaleString("en-IN")}</td>
                  <td className="num-cell">{inr(r.k_value)}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-[var(--muted)]">No transferred orders yet. Orders with bill type <b>K</b>, or the K‑lines of an <b>O/K</b> order, appear here.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
