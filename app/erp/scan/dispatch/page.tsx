import PageHeader from "@/components/PageHeader";
import CasePacking from "@/components/erp/CasePacking";
import { getPackableOrders, getOrderPacking } from "@/lib/erp/queries";

export const dynamic = "force-dynamic";

export default async function DispatchScanPage() {
  const orders = await getPackableOrders();
  const initial = orders[0] ? await getOrderPacking(orders[0].id) : null;
  return (
    <>
      <PageHeader
        title="Pack & Dispatch"
        subtitle="Pick a sales order, set a case number, then scan each item and enter how many you packed. Packed items move to the case; only the quantity left stays to pack."
      />
      <CasePacking
        orders={orders.map((o) => ({ id: o.id, so_no: o.so_no, customer_name: o.customer_name, status: o.status }))}
        initial={initial ?? null}
      />
    </>
  );
}
