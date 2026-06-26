import PageHeader from "@/components/PageHeader";
import BarcodeLabels from "@/components/erp/BarcodeLabels";
import { stockLevels } from "@/lib/erp/queries";

export const dynamic = "force-dynamic";

export default async function BarcodeLabelsPage() {
  const items = (await stockLevels()).map((s) => ({
    id: s.id, sku_code: s.sku_code, name: s.name, category: s.category,
    masterQty: s.master_qty, barcodeCode: s.barcode_code,
  }));
  return (
    <>
      <PageHeader title="Print Barcode Labels" subtitle="Select SKUs, choose Single or Master, and print — A4 sheet or thermal roll." />
      <BarcodeLabels items={items} />
    </>
  );
}
