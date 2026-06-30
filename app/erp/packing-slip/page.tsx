import PageHeader from "@/components/PageHeader";
import PackingSlip from "@/components/erp/PackingSlip";
import { getCurrentUser } from "@/lib/erp/session";
import { getPackableOrders } from "@/lib/erp/queries";

export const dynamic = "force-dynamic";

export default async function PackingSlipPage() {
  await getCurrentUser(); // gate to signed-in users
  const orders = await getPackableOrders();
  return (
    <>
      <PageHeader
        title="Packing Slip"
        subtitle="Pick an unpacked Sales Order, pack it case-by-case (scans items for real — deducts stock, creates a Delivery Order), then export to Excel."
      />
      <PackingSlip orders={orders.map((o) => ({ id: o.id, so_no: o.so_no, customer_name: o.customer_name, status: o.status }))} />
    </>
  );
}
