import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { erpStats, skuMovement, stockLevels } from "@/lib/erp/queries";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const [s, movement, levels] = await Promise.all([erpStats(), skuMovement(50), stockLevels()]);
  const low = levels.filter((x) => x.status === "low" || x.status === "out");

  return (
    <>
      <PageHeader title="Reports & Analytics" subtitle="Inventory, movement and low-stock reports (export-ready)." />
      <div className="mb-5 flex flex-wrap gap-2 text-sm">
        {[
          ["/erp/inventory", "Inventory report"],
          ["/erp/scan/history", "Scan / movement audit"],
          ["/erp/sales", "Sales report"],
          ["/erp/purchase", "Purchase report"],
          ["/erp/finance", "Financial summary"],
        ].map(([h, l]) => (
          <Link key={h} href={h} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 font-semibold hover:bg-[var(--surface-2)]">{l} →</Link>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <section className="panel">
          <div className="panel-hd">SKU movement</div>
          <div className="overflow-x-auto">
            <table className="rtable">
              <thead><tr><th>SKU</th><th className="!text-right">Inward</th><th className="!text-right">Outward</th><th className="!text-right">Moves</th></tr></thead>
              <tbody>
                {movement.map((m) => (
                  <tr key={m.sku_code}><td><span className="font-semibold">{m.name}</span><div className="font-mono text-xs text-[var(--muted)]">{m.sku_code}</div></td>
                    <td className="num-cell">{m.inward}</td><td className="num-cell">{m.outward}</td><td className="num-cell">{m.moves}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="panel">
          <div className="panel-hd">Low stock report ({low.length})</div>
          <div className="overflow-x-auto">
            <table className="rtable">
              <thead><tr><th>SKU</th><th className="!text-right">On hand</th><th className="!text-right">Min</th><th>Status</th></tr></thead>
              <tbody>
                {low.length === 0 && <tr><td colSpan={4} className="!py-6 text-center text-[var(--muted)]">No low-stock items.</td></tr>}
                {low.map((l) => (
                  <tr key={l.id}><td><span className="font-semibold">{l.name}</span><div className="font-mono text-xs text-[var(--muted)]">{l.sku_code}</div></td>
                    <td className="num-cell">{l.qty}</td><td className="num-cell">{l.min_stock}</td><td><span className="tag r">{l.status}</span></td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
      <p className="mt-4 text-xs text-[var(--muted)]">Total scans recorded: {s.scansTotal}. Export to Excel/PDF can be wired via the API routes.</p>
    </>
  );
}
