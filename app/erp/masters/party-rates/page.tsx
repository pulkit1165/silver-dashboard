import PageHeader from "@/components/PageHeader";
import UploadMasterLink from "@/components/erp/UploadMasterLink";
import ListFilters from "@/components/erp/ListFilters";
import PartyPctMaster from "@/components/erp/PartyPctMaster";
import { getCustomersWithPct } from "@/lib/erp/party-masters";
import { getCurrentUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";

export const dynamic = "force-dynamic";
const PAGE_CAP = 600;

// Party-wise Disc% (formerly "Party-wise Net Rate"): each customer's standing
// discount % off MRP. Versioned — most recent value is live, every prior value kept.
export default async function PartyDiscMasterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  const rows = await getCustomersWithPct("disc", sp.q, PAGE_CAP);
  const editable = canWrite(user.role, "rates");
  return (
    <>
      <PageHeader
        title="Party-wise Disc%"
        subtitle="Each customer's standing discount % off MRP — applied on the sales order unless an item net rate supersedes it. Versioned: the latest value is live everywhere, every prior value is kept."
        right={editable ? <UploadMasterLink master="party-rates" /> : undefined}
      />
      <ListFilters fields={[{ key: "q", label: "Search", placeholder: "Name, code, or GST…" }]} />
      <PartyPctMaster rows={rows} kind="disc" label="Disc%" editable={editable} />
    </>
  );
}
