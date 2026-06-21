import PageHeader from "@/components/PageHeader";
import PoGenerator from "@/components/erp/PoGenerator";
import { getPurchaseOrders, getVendors } from "@/lib/erp/queries";
import { getCurrentUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { aiAvailable } from "@/lib/erp/ai";

export const dynamic = "force-dynamic";

export default async function PurchasePage() {
  const [user, orders, vendors] = await Promise.all([
    getCurrentUser(),
    getPurchaseOrders(),
    getVendors(),
  ]);

  const pos = orders.map((p) => ({
    id: p.id,
    po_no: p.po_no,
    vendor_name: (p as { vendor_name?: string }).vendor_name ?? null,
    order_date: p.order_date,
    status: p.status,
  }));
  const vendorList = vendors.map((v) => ({ id: v.id, code: v.code, name: v.name, status: v.status }));

  return (
    <>
      <PageHeader
        title="Purchase Orders"
        subtitle="Generate POs · Track vendors · Monitor stock health"
      />
      <PoGenerator
        pos={pos}
        vendors={vendorList}
        canWrite={canWrite(user.role, "purchase")}
        aiEnabled={aiAvailable()}
      />
    </>
  );
}
