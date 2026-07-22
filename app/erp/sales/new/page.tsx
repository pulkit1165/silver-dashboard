import { redirect } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import NewSalesOrder from "@/components/erp/NewSalesOrder";
import { getCustomers, stockLevels } from "@/lib/erp/queries";
import { ensurePricingTables } from "@/lib/erp/pricing-masters";
import { getCurrentUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";

export const dynamic = "force-dynamic";

export default async function NewSalesOrderPage() {
  const user = await getCurrentUser();
  if (!canWrite(user.role, "sales")) redirect("/erp/sales");

  await ensurePricingTables(); // make sure skus.item_net_rate / foc_pct exist before we read s.*
  const [customers, skus] = await Promise.all([getCustomers(), stockLevels()]);

  return (
    <>
      <PageHeader
        title="New Sales Order"
        subtitle="Rate suggestions are pulled live from Oracle sales history (read-only) — nothing is ever written back to Oracle."
      />
      <NewSalesOrder
        customers={customers.map((c) => ({ id: c.id, code: c.code, name: c.name, discount_pct: c.discount_pct ?? 0 }))}
        skus={skus.map((s) => ({
          id: s.id, sku_code: s.sku_code, name: s.name, price: s.price, unit: s.unit,
          gst_rate: s.gst_rate ?? 18, master_qty: s.master_qty ?? 0, bal_qty: s.qty ?? 0,
          item_net_rate: s.item_net_rate ?? 0,
          foc_pct: s.foc_pct ?? 0,
        }))}
      />
    </>
  );
}
