import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import ListFilters from "@/components/erp/ListFilters";
import { getUnifiedOrders } from "@/lib/erp/ordersUnified";
import { getCurrentUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { STATUS_FILTERS, STATUS_META, TONE_STYLE } from "@/lib/erp/orderStatus";

export const dynamic = "force-dynamic";
const inr = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const SIZES = ["60", "100", "200"];

export default async function SalesOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  const canCreate = canWrite(user.role, "sales");

  const size = SIZES.includes(sp.size ?? "") ? Number(sp.size) : 60;
  const page = Math.max(1, Number(sp.page) || 1);
  const filter = { party: sp.party, salesman: sp.salesman, status: sp.status, from: sp.from, to: sp.to };
  const { rows, total } = await getUnifiedOrders(filter, page, size);
  const totalPages = Math.max(1, Math.ceil(total / size));
  const start = total === 0 ? 0 : (page - 1) * size + 1;
  const end = Math.min(page * size, total);

  // Build a URL preserving filters (+ optional page override).
  const url = (overrides: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    const merged = { party: sp.party, salesman: sp.salesman, status: sp.status, from: sp.from, to: sp.to, size: String(size), page: String(page), ...overrides };
    for (const [k, v] of Object.entries(merged)) if (v != null && v !== "") p.set(k, String(v));
    return `/erp/sales?${p}`;
  };
  const exportUrl = () => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(filter)) if (v) p.set(k, v);
    return `/api/erp/sales/export?${p}`;
  };

  return (
    <>
      <PageHeader
        title="Sales Orders"
        subtitle="Every order — live ERP and legacy — newest first. Filter, page through, and export."
        right={
          <div className="flex flex-wrap items-center gap-2">
            <a href={exportUrl()} className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-bold hover:bg-[var(--surface-2)]">↓ Export</a>
            {canCreate && <Link href="/erp/sales/decode" className="rounded-lg border border-[var(--accent)] bg-[var(--accent-bg)] px-4 py-2 text-sm font-bold text-[var(--accent-strong)] hover:bg-[var(--accent)] hover:text-white">⬆ Upload / Decode</Link>}
            {canCreate && <Link href="/erp/sales/new" className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white hover:bg-[var(--accent-strong)]">+ New Sales Order</Link>}
          </div>
        }
      />

      <ListFilters fields={[
        { key: "party", label: "Customer", placeholder: "Customer name…" },
        { key: "salesman", label: "Salesman", placeholder: "e.g. SID" },
        { key: "status", label: "Status", type: "select", options: STATUS_FILTERS },
        { key: "from", label: "From date", type: "date" },
        { key: "to", label: "To date", type: "date" },
        { key: "size", label: "Per page", type: "select", options: SIZES.map((s) => ({ value: s, label: `${s} / page` })) },
      ]} />

      <div className="mb-2 flex items-center justify-between text-xs font-semibold text-[var(--muted)]">
        <span>{total.toLocaleString("en-IN")} orders · showing {start}–{end}</span>
      </div>

      <section className="panel overflow-hidden">
        <div className="overflow-x-auto">
          <table className="rtable">
            <thead>
              <tr>
                <th>Order</th><th>Date</th><th>Customer</th><th>Salesman</th>
                <th>Transporter</th><th>State</th><th className="!text-right">Value</th><th>Status</th><th>Source</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={9} className="!py-10 text-center text-[var(--muted)]">No orders match these filters.</td></tr>}
              {rows.map((o) => {
                const meta = STATUS_META[o.status_key] ?? { label: o.status_key, tone: "neutral" as const };
                const c = TONE_STYLE[meta.tone];
                const href = o.source === "erp" ? `/erp/sales/${o.ref}` : `/erp/sales/o/${o.order_no}`;
                return (
                  <tr key={`${o.source}-${o.ref}`} className="hover:bg-[var(--surface-2)]">
                    <td><Link href={href} className="font-bold text-[var(--accent)] hover:underline">{o.order_no}</Link></td>
                    <td className="whitespace-nowrap text-[var(--muted)]">{o.dt || "—"}</td>
                    <td className="font-semibold">{o.customer}</td>
                    <td className="text-xs text-[var(--muted)]">{o.salesman || "—"}</td>
                    <td className="text-xs text-[var(--muted)]">{o.transporter || "—"}</td>
                    <td className="text-xs text-[var(--muted)]">{o.state || "—"}</td>
                    <td className="num-cell font-semibold tabular-nums">{inr(o.value)}</td>
                    <td>
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold" style={{ background: c.bg, color: c.fg }}>
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: c.dot }} />{meta.label}
                      </span>
                    </td>
                    <td><span className="rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-[10px] font-bold uppercase text-[var(--muted)]">{o.source}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] p-3 text-sm">
          <span className="font-semibold text-[var(--muted)]">Page {page} of {totalPages}</span>
          <div className="flex items-center gap-1.5">
            <PageLink href={url({ page: 1 })} disabled={page <= 1} label="« First" />
            <PageLink href={url({ page: page - 1 })} disabled={page <= 1} label="‹ Prev" />
            <PageLink href={url({ page: page + 1 })} disabled={page >= totalPages} label="Next ›" />
            <PageLink href={url({ page: totalPages })} disabled={page >= totalPages} label="Last »" />
          </div>
        </div>
      </section>
    </>
  );
}

function PageLink({ href, disabled, label }: { href: string; disabled: boolean; label: string }) {
  if (disabled) return <span className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-bold text-[var(--muted-2)] opacity-50">{label}</span>;
  return <Link href={href} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-bold hover:bg-[var(--surface-2)]">{label}</Link>;
}
