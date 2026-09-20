import PageHeader from "@/components/PageHeader";
import PackingSlip from "@/components/erp/PackingSlip";
import { getCurrentUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { getPackableOrders, getCustomers } from "@/lib/erp/queries";

export const dynamic = "force-dynamic";

export default async function PackingSlipPage() {
  const user = await getCurrentUser(); // gate to signed-in users
  const canBill = canWrite(user.role, "invoices");
  const [orders, customers] = await Promise.all([getPackableOrders(), getCustomers()]);
  return (
    <>
      <PageHeader title="Pack & Dispatch" />
      <PackingSlip
        orders={orders.map((o) => ({ id: o.id, so_no: o.so_no, customer_name: o.customer_name, status: o.status }))}
        parties={customers.map((c) => c.name).filter((n): n is string => Boolean(n))}
        canBill={canBill}
      />
    </>
  );
}
