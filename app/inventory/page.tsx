import { getInventory } from "@/lib/data";
import { money, count } from "@/lib/format";
import Card from "@/components/Card";
import ModeBanner from "@/components/ModeBanner";
import PageHeader from "@/components/PageHeader";

export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  const { parts, mode, note } = await getInventory();
  const totalUnits = parts.reduce((s, p) => s + p.qtyOnHand, 0);
  const stockValue = parts.reduce((s, p) => s + p.qtyOnHand * p.unitCost, 0);
  const retailValue = parts.reduce((s, p) => s + p.qtyOnHand * p.unitPrice, 0);
  const lowCount = parts.filter((p) => p.qtyOnHand < p.reorderLevel).length;

  return (
    <>
      <PageHeader title="Inventory" subtitle="Parts catalogue, stock levels and reorder status." />
      <ModeBanner mode={mode} note={note} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="SKUs shown" value={count(parts.length)} />
        <Stat label="Units on hand" value={count(totalUnits)} />
        <Stat label="Stock value (cost)" value={money(stockValue)} />
        <Stat label="Below reorder" value={count(lowCount)} accent="warning" />
      </div>

      <Card title="Parts" className="mt-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[var(--muted)]">
                <th className="pb-2 font-medium">Part No</th>
                <th className="pb-2 font-medium">Name</th>
                <th className="pb-2 font-medium">Category</th>
                <th className="pb-2 font-medium">Brand</th>
                <th className="pb-2 font-medium">Warehouse</th>
                <th className="pb-2 font-medium text-right">On hand</th>
                <th className="pb-2 font-medium text-right">Reorder</th>
                <th className="pb-2 font-medium text-right">Price</th>
                <th className="pb-2 font-medium text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {parts.map((p) => {
                const low = p.qtyOnHand < p.reorderLevel;
                return (
                  <tr key={p.partNo} className="border-t border-[var(--border)]">
                    <td className="py-2 font-mono text-xs">{p.partNo}</td>
                    <td className="py-2">{p.name}</td>
                    <td className="py-2 text-[var(--muted)]">{p.category}</td>
                    <td className="py-2 text-[var(--muted)]">{p.brand}</td>
                    <td className="py-2 text-[var(--muted)]">{p.warehouse}</td>
                    <td className="py-2 text-right tabular-nums">{count(p.qtyOnHand)}</td>
                    <td className="py-2 text-right tabular-nums text-[var(--muted)]">
                      {count(p.reorderLevel)}
                    </td>
                    <td className="py-2 text-right tabular-nums">{money(p.unitPrice)}</td>
                    <td className="py-2 text-right">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          low
                            ? "bg-[var(--warning)]/15 text-[var(--warning)]"
                            : "bg-[var(--accent-2)]/15 text-[var(--accent-2)]"
                        }`}
                      >
                        {low ? "Reorder" : "OK"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-[var(--muted)]">
          Retail value of stock on hand: {money(retailValue)}.
        </p>
      </Card>
    </>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "warning";
}) {
  return (
    <div className="card p-4">
      <div className="text-xs text-[var(--muted)]">{label}</div>
      <div
        className={`mt-1 text-2xl font-semibold tracking-tight ${
          accent === "warning" ? "text-[var(--warning)]" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}
