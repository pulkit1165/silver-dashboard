import PageHeader from "@/components/PageHeader";
import DiscountMaster from "@/components/erp/DiscountMaster";
import { getCustomers } from "@/lib/erp/queries";
import { getCurrentUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";

export const dynamic = "force-dynamic";

// Customers have no city column — derive a short place from the billing address.
function cityOf(billing?: string | null): string {
  const parts = String(billing ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return "";
  let last = parts[parts.length - 1];
  if (/^[A-Za-z]{2,3}$/.test(last) && parts.length >= 2) last = parts[parts.length - 2];
  return last.replace(/\bPIN\s*\d+\b/i, "").replace(/\b\d{6}\b/, "").trim();
}

// Discount Master — one hub for every discount: pick a party to see & edit its
// party Disc% / OGL% / FOC% on top, and per-item Item Net Rate / FOC / K below.
// A second tab manages the global Item Net Rate that applies to ALL parties.
export default async function DiscountMasterPage() {
  const [customers, user] = await Promise.all([getCustomers(), getCurrentUser()]);
  const editable = canWrite(user, "rates");
  return (
    <>
      <PageHeader
        title="Discount Master"
        subtitle="All discounts in one place. Pick a party to set its Disc% / OGL% / FOC%, and per-item Net Rate, FOC and K (retailer network). A K item auto-applies OGL and makes the order O/K. The global Item Net Rate (all parties) is on its own tab."
      />
      <DiscountMaster
        customers={customers.map((c) => ({
          id: c.id,
          code: c.code ?? "",
          name: c.name ?? "",
          city: cityOf((c as { billing?: string }).billing),
          disc_pct: Number((c as { discount_pct?: number }).discount_pct ?? 0),
        }))}
        editable={editable}
      />
    </>
  );
}
