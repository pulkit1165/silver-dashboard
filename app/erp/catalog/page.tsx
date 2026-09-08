import PageHeader from "@/components/PageHeader";
import ProductCatalog, { type CatalogCompany } from "@/components/erp/ProductCatalog";
import { getCatalogGrouped } from "@/lib/erp/catalog";
import { getCatalogExtras } from "@/lib/erp/catalogExtras";
import { getCompanySettings } from "@/lib/erp/invoices";
import { getCurrentUser } from "@/lib/erp/session";

export const dynamic = "force-dynamic";

const ALLOWED = new Set(["admin", "sales", "inventory", "purchase", "accounts", "warehouse", "viewer"]);
const EDITORS = new Set(["admin", "inventory", "sales", "accounts", "purchase"]);

export default async function CatalogPage() {
  const user = await getCurrentUser();
  if (!ALLOWED.has(user.role))
    return (<><PageHeader title="Product Catalogue" /><p className="text-sm text-[var(--muted)]">No access.</p></>);

  const [groups, cs, extras] = await Promise.all([getCatalogGrouped(), getCompanySettings(), getCatalogExtras()]);
  const company: CatalogCompany = {
    name: (cs.trade_name || cs.legal_name || "SILVER INDUSTRIES").toUpperCase(),
    address: cs.address || "", city: cs.city || "", pincode: cs.pincode || "",
    phone: cs.phone || "", email: cs.email || "", gstin: cs.gstin || "",
  };
  const totalItems = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <>
      <PageHeader
        title="Product Catalogue"
        subtitle={`Your price-list products, grouped by category — ${totalItems.toLocaleString("en-IN")} items in ${groups.length} categories. Filter by category or item, and export a branded PDF or Word price list.`}
      />
      <ProductCatalog groups={groups} company={company} canEdit={EDITORS.has(user.role)}
        topNote={extras.topNote} logo={extras.logo} />
    </>
  );
}
