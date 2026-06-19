import PageHeader from "@/components/PageHeader";
import QrLabels from "@/components/erp/QrLabels";
import { stockLevels } from "@/lib/erp/queries";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function QrPrintPage() {
  const items = (await stockLevels()).map((s) => ({
    id: s.id, sku_code: s.sku_code, name: s.name, category: s.category,
    qty: s.qty, status: s.status, token: s.qr_token,
  }));
  return (
    <>
      <PageHeader title="Print QR Labels" subtitle="Select SKUs and print — A4 sheet or thermal roll." />
      <div className="no-print mb-3">
        <Link href="/erp/qr" className="text-sm font-semibold text-[var(--accent)]">← Back to QR management</Link>
      </div>
      <QrLabels items={items} />
    </>
  );
}
