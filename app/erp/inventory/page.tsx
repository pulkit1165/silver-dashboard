import PageHeader from "@/components/PageHeader";
import StockExplorer from "@/components/erp/StockExplorer";
import { stockAnalytics } from "@/lib/erp/queries";
import { getCurrentUser } from "@/lib/erp/session";

export const dynamic = "force-dynamic";

export default async function StockPage() {
  await getCurrentUser(); // gate to signed-in users
  const full = await stockAnalytics(90);
  // Ship ONLY the columns the table renders. stockAnalytics returns the full SKU
  // row (~24 cols) which ballooned the page to 4.5 MB for 2,185 items; this keeps
  // the analytics server-side and sends ~13 fields instead.
  const rows = full.map((r) => ({
    id: r.id, sku_code: r.sku_code, name: r.name, category: r.category, unit: r.unit,
    price: r.price, qty: r.qty, value: r.value, sold: r.sold, last_out: r.last_out,
    status: r.status, movement: r.movement, low: r.low,
  }));
  return (
    <>
      <PageHeader
        title="Stock"
        subtitle="Stock health across the catalogue — filter by SKU, or switch tabs to see low, dead, fast and medium-moving items."
      />
      <StockExplorer initial={rows} initialWindow={90} />
    </>
  );
}
