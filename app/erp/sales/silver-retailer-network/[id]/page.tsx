import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { getNetworkHeader, getRetailerNetworkLines } from "@/lib/erp/retailerNetwork";
import { getCurrentUser } from "@/lib/erp/session";

export const dynamic = "force-dynamic";
const inr = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const ALLOWED = new Set(["admin", "sales", "accounts", "retailer"]);

export default async function NetworkOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!ALLOWED.has(user.role)) return <p className="p-6 text-sm">No access.</p>;
  const soId = Number(id);
  const [h, lines] = await Promise.all([getNetworkHeader(soId), getRetailerNetworkLines(soId)]);
  const val = lines.reduce((s, l) => s + l.value, 0);
  return (
    <>
      <div className="mb-3"><Link href="/erp/sales/silver-retailer-network" className="text-sm font-semibold text-[var(--accent)]">← Silver Retailer Network</Link></div>
      <PageHeader
        title={`${h?.so_no || `#${soId}`} · ${h?.customer_name ?? ""}`}
        subtitle={`Retailer (K) portion · ${h?.bill_type || "K"} · ${h?.order_date ?? ""}${h?.salesman_name ? ` · ${h.salesman_name}` : ""}`}
      />
      <section className="panel">
        <div className="overflow-x-auto">
          <table className="rtable">
            <thead>
              <tr><th>SKU</th><th>Item</th><th className="!text-right">Qty</th><th className="!text-right">MRP</th><th className="!text-right">Rate</th><th className="!text-right">Value</th></tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td className="font-mono text-xs">{l.sku_code}</td>
                  <td>{l.name}</td>
                  <td className="num-cell">{l.qty.toLocaleString("en-IN")}</td>
                  <td className="num-cell">{inr(l.mrp)}</td>
                  <td className="num-cell">{inr(l.price)}</td>
                  <td className="num-cell">{inr(l.value)}</td>
                </tr>
              ))}
              {lines.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-[var(--muted)]">No K lines on this order.</td></tr>}
            </tbody>
            {lines.length > 0 && <tfoot><tr><td colSpan={5} className="!text-right font-bold">Total</td><td className="num-cell font-bold">{inr(val)}</td></tr></tfoot>}
          </table>
        </div>
      </section>
    </>
  );
}
