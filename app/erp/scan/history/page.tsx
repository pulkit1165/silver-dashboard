import PageHeader from "@/components/PageHeader";
import { getScans } from "@/lib/erp/queries";
import { SCAN_ACTIONS } from "@/lib/erp/types";

export const dynamic = "force-dynamic";

export default async function ScanHistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const scans = await getScans({
    action: sp.action || undefined,
    refDoc: sp.refDoc || undefined,
    from: sp.from || undefined,
    to: sp.to || undefined,
    limit: 500,
  });

  return (
    <>
      <PageHeader
        title="Scan History"
        subtitle="Full audit trail — every scan with user, action, quantity, location, document, and result."
      />

      <form className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
        <Field label="Action">
          <select name="action" defaultValue={sp.action ?? ""} className={inp}>
            <option value="">All</option>
            {SCAN_ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </Field>
        <Field label="Document (SO/PO)"><input name="refDoc" defaultValue={sp.refDoc ?? ""} className={inp} placeholder="SO-1001" /></Field>
        <Field label="From"><input type="date" name="from" defaultValue={sp.from ?? ""} className={inp} /></Field>
        <Field label="To"><input type="date" name="to" defaultValue={sp.to ?? ""} className={inp} /></Field>
        <button className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white hover:bg-[var(--accent-strong)]">Filter</button>
        <a href="/erp/scan/history" className="text-sm font-semibold text-[var(--muted)] underline">Reset</a>
        <span className="ml-auto text-sm text-[var(--muted)]">{scans.length} events</span>
      </form>

      <section className="panel">
        <div className="overflow-x-auto">
          <table className="rtable">
            <thead>
              <tr>
                <th>When</th><th>User</th><th>Action</th><th>SKU</th>
                <th className="!text-right">Qty</th><th>Document</th><th>Device</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {scans.length === 0 && (
                <tr><td colSpan={8} className="!py-8 text-center text-[var(--muted)]">No scan events yet.</td></tr>
              )}
              {scans.map((s) => (
                <tr key={s.id}>
                  <td className="whitespace-nowrap text-xs text-[var(--muted)]">{s.created_at}</td>
                  <td className="font-semibold">{s.user_name}</td>
                  <td><span className="tag n">{s.action}</span></td>
                  <td>{s.sku_code ? <><span className="font-mono text-xs">{s.sku_code}</span></> : <span className="text-[var(--muted)]">—</span>}</td>
                  <td className="num-cell">{s.qty || ""}</td>
                  <td>{s.ref_doc ?? <span className="text-[var(--muted)]">—</span>}</td>
                  <td className="text-xs text-[var(--muted)]">{s.device}</td>
                  <td>
                    {s.status === "success"
                      ? <span className="tag g">success</span>
                      : <span className="tag r" title={s.error ?? ""}>failed</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

const inp = "rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]";
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--muted)]">{label}{children}</label>;
}
