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
    masterQty: s.master_qty, singleQty: s.single_qty, barcodeCode: s.barcode_code,
  }));
  return (
    <>
      {/* Web fonts for rendering approved custom label designs (same set as the designer). */}
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;700&family=Open+Sans:wght@400;700&family=Lato:wght@400;700&family=Montserrat:wght@400;700&family=Poppins:wght@400;700&family=Inter:wght@400;700&family=Work+Sans:wght@400;700&family=Rubik:wght@400;700&family=PT+Sans:wght@400;700&family=Barlow:wght@400;700&family=Archivo:wght@400;700&family=Roboto+Condensed:wght@400;700&family=Barlow+Condensed:wght@400;700&family=Archivo+Narrow:wght@400;700&family=Oswald:wght@400;700&family=Bebas+Neue&family=Anton&family=Merriweather:wght@400;700&family=Roboto+Slab:wght@400;700&family=PT+Serif:wght@400;700&family=Roboto+Mono:wght@400;700&family=JetBrains+Mono:wght@400;700&display=swap" />
      <PageHeader title="Print Barcode Labels" subtitle="Search for SKUs, choose Single or Master, and print — A4 sheet or thermal roll." />
      <div className="mb-3 flex flex-wrap gap-4">
        <Link href="/erp/labels/design" className="text-sm font-semibold text-[var(--accent)]">🎨 Design labels (new visual designer) →</Link>
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
