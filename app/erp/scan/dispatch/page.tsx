import PageHeader from "@/components/PageHeader";
import DispatchScan from "@/components/erp/DispatchScan";
import { getSalesOrders, getSalesOrder } from "@/lib/erp/queries";

export const dynamic = "force-dynamic";

export default async function DispatchScanPage() {
  const all = await getSalesOrders();
  const orders = (
    await Promise.all(
      all
        .filter((o) => ["confirmed", "picked", "packed", "partially dispatched"].includes(o.status))
        .map((o) => getSalesOrder(o.id)),
    )
  ).filter((o): o is NonNullable<typeof o> => Boolean(o));
  return (
    <>
      <PageHeader
        title="Dispatch Scanning"
        subtitle="Pick an order, then scan each item. Correct items are marked dispatched; wrong or excess items are rejected instantly."
      />
      <DispatchScan orders={orders} />
    </>
  );
}
