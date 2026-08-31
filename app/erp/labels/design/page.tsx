import PageHeader from "@/components/PageHeader";
import LabelDesigner from "@/components/erp/LabelDesigner";

export const dynamic = "force-dynamic";

// Bundled web fonts for the designer — loaded here so every ERP PC renders the
// print image with the SAME fonts, regardless of what's installed locally.
const FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Roboto:wght@400;700&family=Open+Sans:wght@400;700&family=Lato:wght@400;700&family=Montserrat:wght@400;700&family=Poppins:wght@400;700&family=Inter:wght@400;700&family=Work+Sans:wght@400;700&family=Rubik:wght@400;700&family=PT+Sans:wght@400;700&family=Barlow:wght@400;700&family=Archivo:wght@400;700&family=Roboto+Condensed:wght@400;700&family=Barlow+Condensed:wght@400;700&family=Archivo+Narrow:wght@400;700&family=Oswald:wght@400;700&family=Bebas+Neue&family=Anton&family=Merriweather:wght@400;700&family=Roboto+Slab:wght@400;700&family=PT+Serif:wght@400;700&family=Roboto+Mono:wght@400;700&family=JetBrains+Mono:wght@400;700&display=swap";

export default function LabelDesignPage() {
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link rel="stylesheet" href={FONTS_HREF} />
      <PageHeader
        title="Label Designer"
        subtitle="Design each label at its real size — drag, resize, choose fonts. Save a draft, test-print, then Approve to go live. The current design keeps printing until you approve a new one."
      />
      <LabelDesigner />
    </>
  );
}
