import PageHeader from "@/components/PageHeader";
import RuleBook from "@/components/erp/RuleBook";
import { getCurrentUser } from "@/lib/erp/session";
import { runRuleBook } from "@/lib/erp/rulebook";

export const dynamic = "force-dynamic";

export default async function RuleBookPage() {
  await getCurrentUser();
  const modules = await runRuleBook();
  return (
    <>
      <PageHeader
        title="Rule Book"
        subtitle="Every business rule the ERP enforces, module by module, each with a live self-test. Green = the rule is verified working right now. Grey = enforced in code but needs a live transaction to prove. Open a module to see its rules; re-verify any time."
      />
      <RuleBook initial={modules} />
    </>
  );
}
