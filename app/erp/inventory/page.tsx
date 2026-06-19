import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { stockLevels, inventoryForSku } from "@/lib/erp/queries";

export const dynamic = "force-dynamic";
const TAG: Record<string, string> = { out: "r", low: "r", reorder: "n", ok: "g" };

export default async function StockPage() {
  const rows = await stockLevels();
  const locsBySku = await Promise.all(rows.map((s) => inventoryForSku(s.id)));
  const totalValue = rows.reduce((a, s) => a + s.qty * s.price, 0);
  return (
    <>
      <PageHeader title="Stock" subtitle="Real-time stock availability and valuation across warehouses." />
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="kpi"><div className="lab">SKUs</div><div className="num">{rows.length}</div></div>
        <div className="kpi"><div className="lab">Total units</div><div className="num">{rows.reduce((a, s) => a + s.qty, 0)}</div></div>
        <div className="kpi alert"><div className="lab">Low / out</div><div className="num" style={{ color: "var(--danger)" }}>{rows.filter((s) => s.status === "low" || s.status === "out").length}</div></div>
        <div className="kpi"><div className="lab">Stock value</div><div className="num">{totalValue.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</div></div>
      </div>
      <section className="panel">
        <div className="overflow-x-auto">
          <table className="rtable">
            <thead><tr><th>SKU</th><th>Locations</th><th className="!text-right">On hand</th><th className="!text-right">Value</th><th>Status</th></tr></thead>
            <tbody>
              {rows.map((s, i) => (
                <tr key={s.id}>
                  <td><Link href={`/erp/skus/${s.id}`} className="font-semibold text-[var(--accent)] hover:underline">{s.name}</Link><div className="font-mono text-xs text-[var(--muted)]">{s.sku_code}</div></td>
                  <td className="text-xs">{locsBySku[i].map((l) => `${l.warehouse_code}/${l.bin_code ?? "-"}:${l.qty}`).join("  ") || "—"}</td>
                  <td className="num-cell">{s.qty}</td>
                  <td className="num-cell">{(s.qty * s.price).toLocaleString("en-IN", { maximumFractionDigits: 0 })}</td>
                  <td><span className={`tag ${TAG[s.status]}`}>{s.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
