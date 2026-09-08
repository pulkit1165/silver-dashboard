import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import NewQuotation from "@/components/erp/NewQuotation";
import { listQuotations } from "@/lib/erp/purchaseQuotations";
import { getCurrentUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";

export const dynamic = "force-dynamic";

const ALLOWED = new Set(["admin", "purchase", "accounts"]);
const STATUS_TABS = [
  { k: "all", label: "All" }, { k: "draft", label: "Draft" }, { k: "pending", label: "Awaiting approval" },
  { k: "approved", label: "Approved" }, { k: "ordered", label: "Ordered" }, { k: "rejected", label: "Rejected" },
];
const badge: Record<string, string> = {
  draft: "bg-gray-100 text-gray-600", pending: "bg-amber-100 text-amber-800",
  approved: "bg-teal-100 text-teal-800", ordered: "bg-blue-100 text-blue-800", rejected: "bg-rose-100 text-rose-700",
};

export default async function QuotationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const status = sp.status ?? "all";
  const user = await getCurrentUser();
  if (!ALLOWED.has(user.role)) return (<><PageHeader title="Purchase Quotations" /><p className="text-sm text-[var(--muted)]">No access.</p></>);
  const rows = await listQuotations(status);
  const canEdit = canWrite(user.role, "purchase");

  return (
    <>
      <PageHeader title="Purchase Quotations" subtitle="Raise a quotation, enter each vendor's price / credit / delivery, pick the best per item, and send to admin for approval → indent → PO." />
      {canEdit && <NewQuotation />}

      <div className="mb-3 flex flex-wrap gap-1">
        {STATUS_TABS.map((t) => (
          <Link key={t.k} href={`/erp/purchase/quotations${t.k === "all" ? "" : `?status=${t.k}`}`}
            className={`rounded-full px-3 py-1 text-xs font-bold ${status === t.k ? "bg-[var(--accent)] text-white" : "border border-[var(--border)] hover:bg-[var(--surface-2)]"}`}>
            {t.label}
          </Link>
        ))}
      </div>

      <section className="panel">
        <div className="overflow-x-auto">
          <table className="rtable">
            <thead><tr><th>Quotation</th><th>Department</th><th>Title</th><th className="!text-right">Items</th><th className="!text-right">Vendors</th><th>Status</th><th>Raised</th></tr></thead>
            <tbody>
              {rows.map((q) => (
                <tr key={q.id}>
                  <td><Link href={`/erp/purchase/quotations/${q.id}`} className="font-mono font-bold text-[var(--accent)] hover:underline">{q.quo_no}</Link></td>
                  <td>{q.department || <span className="text-[var(--muted-2)]">—</span>}</td>
                  <td>{q.title || <span className="text-[var(--muted-2)]">—</span>}</td>
                  <td className="num-cell">{q.lines}</td>
                  <td className="num-cell">{q.vendors}</td>
                  <td><span className={`rounded px-2 py-0.5 text-[11px] font-bold ${badge[q.status] ?? ""}`}>{q.status}</span></td>
                  <td className="text-xs text-[var(--muted)]">{q.created_at} · {q.created_by}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-[var(--muted)]">No quotations{status !== "all" ? ` in '${status}'` : ""} yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
