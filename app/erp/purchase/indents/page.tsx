import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import GenerateIndentButton from "@/components/erp/GenerateIndentButton";
import { listIndents } from "@/lib/erp/purchaseQuotations";
import { getCurrentUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";

export const dynamic = "force-dynamic";
const ALLOWED = new Set(["admin", "purchase", "accounts"]);
const badge: Record<string, string> = {
  draft: "bg-gray-100 text-gray-600", quoting: "bg-amber-100 text-amber-800",
  pending: "bg-amber-100 text-amber-800", approved: "bg-teal-100 text-teal-800",
  partial: "bg-blue-100 text-blue-800", ordered: "bg-blue-100 text-blue-800", rejected: "bg-rose-100 text-rose-700",
};

export default async function IndentsPage() {
  const user = await getCurrentUser();
  if (!ALLOWED.has(user.role)) return (<><PageHeader title="Purchase Indents" /><p className="text-sm text-[var(--muted)]">No access.</p></>);
  const rows = await listIndents();
  return (
    <>
      <PageHeader title="Purchase Indents" subtitle="What to buy, decided by sales velocity + stock cover — raise a quotation, get admin approval, then generate PO(s), all from one indent." />
      {canWrite(user, "purchase") && <GenerateIndentButton />}
      <section className="panel">
        <div className="overflow-x-auto">
          <table className="rtable">
            <thead><tr><th>Indent</th><th>Quotation</th><th className="!text-right">Lines</th><th className="!text-right">Vendors</th><th className="!text-right">Ordered</th><th>Status</th><th>Created</th></tr></thead>
            <tbody>
              {rows.map((i) => (
                <tr key={i.id}>
                  <td><Link href={`/erp/purchase/indents/${i.id}`} className="font-mono font-bold text-[var(--accent)] hover:underline">{i.indent_no}</Link></td>
                  <td className="font-mono text-xs">{i.quo_no || "—"}</td>
                  <td className="num-cell">{i.lines}</td>
                  <td className="num-cell">{i.vendors}</td>
                  <td className="num-cell">{i.ordered}/{i.lines}</td>
                  <td><span className={`rounded px-2 py-0.5 text-[11px] font-bold ${badge[i.status] ?? ""}`}>{i.status}</span></td>
                  <td className="text-xs text-[var(--muted)]">{i.created_at} · {i.created_by}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-[var(--muted)]">No indents yet — generate one above.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
