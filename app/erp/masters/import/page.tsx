import PageHeader from "@/components/PageHeader";
import MasterUpload from "@/components/erp/MasterUpload";
import Link from "next/link";
import { getCurrentUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { MASTER_LIST, MASTERS, type MasterKey } from "@/lib/erp/masterImport";

export const dynamic = "force-dynamic";

export default async function MasterImportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const user = await getCurrentUser();

  // Only offer the masters this role may write.
  const allowed = MASTER_LIST.filter((m) => canWrite(user.role, m.permission));
  if (allowed.length === 0) {
    return (
      <>
        <PageHeader title="Upload / Overwrite Master Files" />
        <p className="text-sm text-[var(--muted)]">
          Your role ({user.role}) can&apos;t edit any master files. Ask an admin.
        </p>
        <Link href="/erp" className="text-sm font-semibold text-[var(--accent)]">
          ← ERP Dashboard
        </Link>
      </>
    );
  }

  const requested = sp.master as MasterKey | undefined;
  const initialMaster =
    requested && MASTERS[requested] && allowed.some((m) => m.key === requested) ? requested : undefined;

  return (
    <>
      <PageHeader
        title="Upload / Overwrite Master Files"
        subtitle="Import an Excel/CSV into a master. Choose Partial to add & update only the rows in your file, or Full overwrite to make the master exactly match the file."
      />
      <MasterUpload masters={allowed} initialMaster={initialMaster} />
    </>
  );
}
