import PageHeader from "@/components/PageHeader";
import ListFilters from "@/components/erp/ListFilters";
import PartyPctMaster from "@/components/erp/PartyPctMaster";
import { getCustomersWithPct } from "@/lib/erp/party-masters";
import { getCurrentUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";

export const dynamic = "force-dynamic";
const PAGE_CAP = 600;

// FOC Disc%: a party-level free-of-cost discount % applied LAST — on top of
// party Disc% / OGL / any item net rate. Above and beyond every other discount.
export default async function FocMasterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  const rows = await getCustomersWithPct("foc", sp.q, PAGE_CAP);
  const editable = canWrite(user.role, "rates");
  return (
    <>
      <PageHeader
        title="FOC Disc%"
        subtitle="Party-level free-of-cost discount % — applied LAST, on top of every other discount (party Disc%, OGL, and any item net rate). Versioned: latest value is live, every prior value kept."
      />
      <ListFilters fields={[{ key: "q", label: "Search", placeholder: "Name, code, or GST…" }]} />
      <PartyPctMaster rows={rows} kind="foc" label="FOC%" editable={editable} />
    </>
  );
}
