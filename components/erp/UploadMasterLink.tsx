import Link from "next/link";
import type { MasterKey } from "@/lib/erp/masterImport";

/** Header shortcut to the bulk Excel uploader, preset to a specific master. */
export default function UploadMasterLink({ master }: { master: MasterKey }) {
  return (
    <Link
      href={`/erp/masters/import?master=${master}`}
      className="rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm font-bold text-[var(--accent)] hover:bg-[var(--surface-2)]"
    >
      ⬆ Upload Excel
    </Link>
  );
}
