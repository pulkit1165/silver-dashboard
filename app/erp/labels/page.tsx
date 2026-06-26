import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import BarcodeLabels from "@/components/erp/BarcodeLabels";
import ListFilters from "@/components/erp/ListFilters";
import { stockLevels } from "@/lib/erp/queries";

export const dynamic = "force-dynamic";

const PAGE_CAP = 300;

export default async function BarcodeLabelsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const all = await stockLevels(sp.q);
  const items = all.slice(0, PAGE_CAP).map((s) => ({
    id: s.id, sku_code: s.sku_code, name: s.name, category: s.category,
    masterQty: s.master_qty, barcodeCode: s.barcode_code,
  }));
  return (
    <>
      <PageHeader title="Print Barcode Labels" subtitle="Search for SKUs, choose Single or Master, and print — A4 sheet or thermal roll." />
      <div className="mb-3">
        <Link href="/erp/skus/import-labels" className="text-sm font-semibold text-[var(--accent)]">Bulk backfill barcode codes / master qty →</Link>
      </div>
      <ListFilters fields={[{ key: "q", label: "Search", placeholder: "Name, code, or category…" }]} />
      {!sp.q && all.length > PAGE_CAP && (
        <p className="mb-3 text-xs font-semibold text-[var(--muted)]">
          Showing first {PAGE_CAP} of {all.length} items — use Search to narrow down.
        </p>
      )}
      <BarcodeLabels items={items} />
    </>
  );
}
