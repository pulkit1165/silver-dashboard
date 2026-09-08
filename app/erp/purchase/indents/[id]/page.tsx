import Link from "next/link";
import { notFound } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import IndentActions from "@/components/erp/IndentActions";
import { getIndent } from "@/lib/erp/purchaseQuotations";
import { getCurrentUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";

export const dynamic = "force-dynamic";
const ALLOWED = new Set(["admin", "purchase", "accounts"]);
const inr = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export default async function IndentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!ALLOWED.has(user.role)) return (<><PageHeader title="Indent" /><p className="text-sm text-[var(--muted)]">No access.</p></>);
  const data = await getIndent(Number(id));
  if (!data) notFound();

  // group by vendor for display
  const byVendor = new Map<number, typeof data.lines>();
  for (const l of data.lines) (byVendor.get(l.vendor_id) ?? byVendor.set(l.vendor_id, []).get(l.vendor_id)!).push(l);
  const pending = data.lines.filter((l) => !l.po_id).length;
  const canOrder = (canWrite(user.role, "purchase") || user.role === "admin");

  return (
    <>
      <PageHeader
        title={`Indent ${data.ind.indent_no}`}
        subtitle={`from ${data.ind.quo_no || "—"} · status: ${data.ind.status}`}
        right={<Link href="/erp/purchase/indents" className="text-sm font-semibold text-[var(--accent)]">← All indents</Link>}
      />

      {canOrder && pending > 0 && <IndentActions indentId={data.ind.id} pending={pending} vendors={byVendor.size} />}

      {[...byVendor.entries()].map(([vid, ls]) => {
        const total = ls.reduce((s, l) => s + l.qty * l.unit_price, 0);
        return (
          <section key={vid} className="panel mb-4 !p-0 overflow-hidden">
            <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-2">
              <h3 className="text-sm font-extrabold">{ls[0].vendor_name}</h3>
              <span className="text-xs text-[var(--muted)]">{ls.length} line(s) · {inr(total)} · credit {ls[0].credit_days}d · lead {ls[0].lead_days}d</span>
            </div>
            <div className="overflow-x-auto">
              <table className="rtable">
                <thead><tr><th>SKU</th><th>Item</th><th className="!text-right">Qty</th><th className="!text-right">Rate</th><th className="!text-right">Amount</th><th>PO</th></tr></thead>
                <tbody>
                  {ls.map((l) => (
                    <tr key={l.id}>
                      <td className="font-mono text-xs font-bold text-[var(--muted)]">{l.sku_code || "—"}</td>
                      <td>{l.item_name}</td>
                      <td className="num-cell">{l.qty}</td>
                      <td className="num-cell">{inr(l.unit_price)}</td>
                      <td className="num-cell font-semibold">{inr(l.qty * l.unit_price)}</td>
                      <td>{l.po_no ? <span className="rounded bg-teal-100 px-2 py-0.5 text-[11px] font-bold text-teal-800">{l.po_no}</span> : <span className="text-xs text-[var(--muted-2)]">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </>
  );
}
