import { redirect } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import NewSalesOrder from "@/components/erp/NewSalesOrder";
import { getCustomers, stockLevels } from "@/lib/erp/queries";
import { getCurrentUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";

export const dynamic = "force-dynamic";

export default async function NewSalesOrderPage() {
  const user = await getCurrentUser();
  if (!canWrite(user.role, "sales")) redirect("/erp/sales");

  const [customers, skus] = await Promise.all([getCustomers(), stockLevels()]);

  return (
    <>
      <PageHeader
        title="New Sales Order"
        subtitle="Rate suggestions are pulled live from Oracle sales history (read-only) — nothing is ever written back to Oracle."
      />
      <NewSalesOrder
        customers={customers.map((c) => ({
          id: c.id, code: c.code, name: c.name,
          discount_pct_18: c.discount_pct_18 ?? 0, discount_pct_28: c.discount_pct_28 ?? 0,
        }))}
        skus={skus.map((s) => ({
          id: s.id, sku_code: s.sku_code, name: s.name, price: s.price, unit: s.unit,
          gst_rate: s.gst_rate ?? 18, master_qty: s.master_qty ?? 0, bal_qty: s.qty ?? 0,
        }))}
      />
    </>
  );
}
