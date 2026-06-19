import PageHeader from "@/components/PageHeader";
import QrLabels from "@/components/erp/QrLabels";
import { stockLevels } from "@/lib/erp/queries";

export const dynamic = "force-dynamic";

export default async function QrLabelsPage() {
  const items = (await stockLevels()).map((s) => ({
    id: s.id, sku_code: s.sku_code, name: s.name, category: s.category,
    qty: s.qty, status: s.status, token: s.qr_token,
  }));
  return (
    <>
      <PageHeader
        title="QR Labels"
        subtitle="Generate and print SKU QR labels — single or bulk, A4 sheet or thermal roll."
      />
      <QrLabels items={items} />
    </>
  );
}
