import PageHeader from "@/components/PageHeader";
import SalesDecoder from "@/components/erp/SalesDecoder";
import { getCustomers } from "@/lib/erp/queries";
import { aiAvailable } from "@/lib/erp/sales-decode";

export const dynamic = "force-dynamic";

export default async function SalesDecodePage() {
  const customers = (await getCustomers()).map((c) => ({ id: c.id, code: c.code, name: c.name }));
  return (
    <>
      <PageHeader
        title="Upload / Decode Order"
        subtitle="Upload a Sales Order as Excel/CSV (reads instantly, no AI), or a photo of a handwritten slip (AI reads it). Verify the lines, then punch it into a real sales order — then pack it in the Packing Slip."
      />
      <SalesDecoder customers={customers} aiReady={aiAvailable()} />
    </>
  );
}
