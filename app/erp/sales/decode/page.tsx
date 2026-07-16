import PageHeader from "@/components/PageHeader";
import SalesDecoder from "@/components/erp/SalesDecoder";
import { getCustomers, getSalesmen } from "@/lib/erp/queries";
import { aiAvailable } from "@/lib/erp/sales-decode";

export const dynamic = "force-dynamic";

export default async function SalesDecodePage() {
  const [customers, salesmen] = await Promise.all([getCustomers(), getSalesmen()]);
  return (
    <>
      <PageHeader
        title="Upload / Decode Order"
        subtitle="Photo of a handwritten slip, type the order in text, or upload an Excel/CSV — AI reads it, you verify, then punch as a real sales order."
      />
      <SalesDecoder
        customers={customers.map((c) => ({ id: c.id, code: c.code, name: c.name }))}
        salesmen={salesmen}
        aiReady={aiAvailable()}
      />
    </>
  );
}
