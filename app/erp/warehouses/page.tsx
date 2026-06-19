import PageHeader from "@/components/PageHeader";
import { getWarehouses, getBins } from "@/lib/erp/queries";

export const dynamic = "force-dynamic";

export default async function WarehousesPage() {
  const warehouses = await getWarehouses();
  const binsByWh = await Promise.all(warehouses.map((w) => getBins(w.id)));
  return (
    <>
      <PageHeader title="Warehouses" subtitle="Warehouses with rack / shelf / bin locations." />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {warehouses.map((w, i) => (
          <section key={w.id} className="panel">
            <div className="panel-hd">{w.code} · {w.name}</div>
            <div className="p-4">
              <p className="mb-3 text-sm text-[var(--muted)]">{w.address}</p>
              <table className="rtable">
                <thead><tr><th>Bin</th><th>Rack</th><th>Shelf</th></tr></thead>
                <tbody>
                  {binsByWh[i].map((b) => (
                    <tr key={b.id}><td className="font-mono">{b.code}</td><td>{b.rack}</td><td>{b.shelf}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
