import PageHeader from "@/components/PageHeader";
import CustomListBuilder from "@/components/erp/CustomListBuilder";
import { type CatalogCompany } from "@/components/erp/ProductCatalog";
import { getCatalogExtras } from "@/lib/erp/catalogExtras";
import { getCompanySettings } from "@/lib/erp/invoices";
import { getCurrentUser } from "@/lib/erp/session";

export const dynamic = "force-dynamic";

const ALLOWED = new Set(["admin", "sales", "inventory", "purchase", "accounts", "warehouse", "viewer"]);

export default async function CustomListPage() {
  const user = await getCurrentUser();
  if (!ALLOWED.has(user.role))
    return (<><PageHeader title="Custom List" /><p className="text-sm text-[var(--muted)]">No access.</p></>);

  const [cs, extras] = await Promise.all([getCompanySettings(), getCatalogExtras()]);
  const company: CatalogCompany = {
    name: (cs.trade_name || cs.legal_name || "SILVER INDUSTRIES").toUpperCase(),
    address: cs.address || "", city: cs.city || "", pincode: cs.pincode || "",
    phone: cs.phone || "", email: cs.email || "", gstin: cs.gstin || "",
  };

  return (
    <>
      <PageHeader
        title="Custom List → Branded PDF"
        subtitle="Upload any Excel (e.g. CODE · ITEM · NEW MRP · OLD MRP · DIFF), add an optional headline, and export a PDF or Word in your Silver format — logo and header pulled from the catalogue settings."
      />
      <CustomListBuilder company={company} logo={extras.logo} />
    </>
  );
}
