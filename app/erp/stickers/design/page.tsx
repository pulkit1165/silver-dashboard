import PageHeader from "@/components/PageHeader";
import StickerDesigner from "@/components/erp/StickerDesigner";

export const dynamic = "force-dynamic";

// Same bundled web fonts as the Label Designer, so the print image renders with the
// same fonts on every ERP PC.
const FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Roboto:wght@400;700&family=Open+Sans:wght@400;700&family=Lato:wght@400;700&family=Montserrat:wght@400;700&family=Poppins:wght@400;700&family=Inter:wght@400;700&family=Work+Sans:wght@400;700&family=Rubik:wght@400;700&family=PT+Sans:wght@400;700&family=Barlow:wght@400;700&family=Archivo:wght@400;700&family=Roboto+Condensed:wght@400;700&family=Barlow+Condensed:wght@400;700&family=Archivo+Narrow:wght@400;700&family=Oswald:wght@400;700&family=Bebas+Neue&family=Anton&family=Merriweather:wght@400;700&family=Roboto+Slab:wght@400;700&family=PT+Serif:wght@400;700&family=Roboto+Mono:wght@400;700&family=JetBrains+Mono:wght@400;700&display=swap";

export default function StickerDesignPage() {
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link rel="stylesheet" href={FONTS_HREF} />
      <PageHeader
        title="Sticker Designer (abbreviation)"
        subtitle="Design the abbreviation stickers — trade-name Line 1 / size Line 2 from the ITEMS MASTER, with QR. Separate from the normal Label Designer; save a draft, test-print, then Approve to go live."
      />
      <StickerDesigner />
    </>
  );
}
