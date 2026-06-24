import PageHeader from "@/components/PageHeader";
import PackingSlipLive from "@/components/erp/PackingSlipLive";
import { getCurrentUser } from "@/lib/erp/session";

export const dynamic = "force-dynamic";

export default async function PackingSlipLivePage() {
  await getCurrentUser(); // gate to signed-in users
  return (
    <>
      <PageHeader
        title="Packing Slip — Live View"
        subtitle="Read-only big-screen mirror. Open this on a laptop/TV and scan from a phone — every scan appears here within about a second."
      />
      <PackingSlipLive />
    </>
  );
}
