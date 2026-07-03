import PageHeader from "@/components/PageHeader";
import StockExplorer from "@/components/erp/StockExplorer";
import { stockAnalytics } from "@/lib/erp/queries";
import { getCurrentUser } from "@/lib/erp/session";

export const dynamic = "force-dynamic";

export default async function StockPage() {
  await getCurrentUser(); // gate to signed-in users
  const rows = await stockAnalytics(90);
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
