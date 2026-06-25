import PageHeader from "@/components/PageHeader";
import Assistant from "@/components/erp/Assistant";
import { getCurrentUser } from "@/lib/erp/session";
import { aiAvailable } from "@/lib/erp/ai";

export const dynamic = "force-dynamic";

export default async function AssistantPage() {
  await getCurrentUser(); // gate to signed-in users
  return (
    <>
      <PageHeader
        title="Ask AI"
        subtitle="Ask questions about your business in plain English — sales, customers, stock, purchases. The AI reads the live ERP and answers with real numbers. Read-only: it never changes anything."
      />
      <Assistant configured={aiAvailable()} />
    </>
  );
}
