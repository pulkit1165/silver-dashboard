import PageHeader from "@/components/PageHeader";
import PartyItemNetRateMaster from "@/components/erp/PartyItemNetRateMaster";
import { getPartyItemRates } from "@/lib/erp/party-masters";
import { getCustomers } from "@/lib/erp/queries";
import { getCurrentUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";

export const dynamic = "force-dynamic";

// Party × item net rate: the most specific rate. Per party, per item. Supersedes
// the global item net rate for that party on new sales orders. Versioned.
export default async function PartyItemNetRatePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  const editable = canWrite(user.role, "rates");
  const customers = await getCustomers();
  const partyId = sp.party ? Number(sp.party) : undefined;
  const rows = partyId ? await getPartyItemRates({ partyId, itemSearch: sp.q, cap: 1500 }) : [];
  return (
    <>
      <PageHeader
        title="Party-wise Item Net Rate"
        subtitle="A fixed net rate for a specific party + item. This is the MOST specific rate — on a sales order it supersedes the global item net rate and the party discount for that line. Versioned: latest value is live, every prior value kept."
      />
      <PartyItemNetRateMaster
        customers={customers.map((c) => ({ id: c.id, code: c.code ?? "", name: c.name ?? "" }))}
        rows={rows}
        partyId={partyId}
        itemSearch={sp.q ?? ""}
        editable={editable}
      />
    </>
  );
}
