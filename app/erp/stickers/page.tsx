import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import StickerPrint, { type AbbrevItem } from "@/components/erp/StickerPrint";
import { getAbbrevMasters } from "@/lib/erp/skuAbbrev";
import { getCompanySettings } from "@/lib/erp/invoices";
import { getCurrentUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";

export const dynamic = "force-dynamic";

// Same web fonts as the designers, so the rendered print image uses them.
const FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Roboto:wght@400;700&family=Open+Sans:wght@400;700&family=Lato:wght@400;700&family=Montserrat:wght@400;700&family=Poppins:wght@400;700&family=Inter:wght@400;700&family=Work+Sans:wght@400;700&family=Rubik:wght@400;700&family=PT+Sans:wght@400;700&family=Barlow:wght@400;700&family=Archivo:wght@400;700&family=Roboto+Condensed:wght@400;700&family=Barlow+Condensed:wght@400;700&family=Archivo+Narrow:wght@400;700&family=Oswald:wght@400;700&family=Bebas+Neue&family=Anton&family=Merriweather:wght@400;700&family=Roboto+Slab:wght@400;700&family=PT+Serif:wght@400;700&family=Roboto+Mono:wght@400;700&family=JetBrains+Mono:wght@400;700&display=swap";

export default async function StickerPrintPage() {
  const user = await getCurrentUser();
  if (!canWrite(user, "labels")) {
    return (
      <>
        <PageHeader title="Abbreviation Stickers" />
        <p className="text-sm text-[var(--muted)]">Your role ({user.role}) can&apos;t print labels. Ask an admin.</p>
        <Link href="/erp" className="text-sm font-semibold text-[var(--accent)]">← ERP Dashboard</Link>
      </>
    );
  }

  const [abbrev, company] = await Promise.all([getAbbrevMasters(), getCompanySettings().catch(() => null)]);
  const items: AbbrevItem[] = Object.entries(abbrev)
    .filter(([, r]) => r.line1)
    .map(([code, r]) => ({ sku_code: code, line1: r.line1, line2: r.line2, unit: r.unit, masterPack: r.masterPack, singlePack: r.singlePack }))
    .sort((a, b) => a.sku_code.localeCompare(b.sku_code));

  const companyAddress = company
    ? [company.legal_name, [company.address, company.city, company.pincode].filter(Boolean).join(", "), company.gstin ? `GSTIN ${company.gstin}` : ""].filter(Boolean).join("\n")
    : "";

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link rel="stylesheet" href={FONTS_HREF} />
      <PageHeader
        title="Abbreviation Stickers"
        subtitle="Print stickers with the short trade names (Line 1 / Line 2) + unit from the ITEMS MASTER, with QR — separate from the normal labels. Pick items, size, Single/Master, and print."
      />
      {items.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">
          No abbreviation data yet. Upload your ITEMS MASTER under{" "}
          <Link href="/erp/masters/import?master=sku-abbrev" className="font-semibold text-[var(--accent)]">Master Files → Item Abbreviation (Sticker)</Link>, then design the layout in the{" "}
          <Link href="/erp/stickers/design" className="font-semibold text-[var(--accent)]">Sticker Designer</Link>.
        </p>
      ) : (
        <StickerPrint items={items} companyAddress={companyAddress} />
      )}
    </>
  );
}
