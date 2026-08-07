import PageHeader from "@/components/PageHeader";
import PrintBridge from "@/components/erp/PrintBridge";
import { getCurrentUser } from "@/lib/erp/session";

export const dynamic = "force-dynamic";

export default async function PrintBridgePage() {
  const user = await getCurrentUser();
  return (
    <>
      <PageHeader
        title="Print Bridge"
        subtitle="Your own label-printing service (like PrintNode). See which PCs are connected, generate install tokens, and download the agent installer to share with the shop."
      />
      <PrintBridge isAdmin={user.role === "admin"} />
    </>
  );
}
