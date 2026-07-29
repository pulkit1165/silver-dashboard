import Link from "next/link";
import { notFound } from "next/navigation";
import { getOracleOrder } from "@/lib/erp/ordersUnified";
import { getCurrentUser } from "@/lib/erp/session";
import { PrintButton } from "@/components/erp/OrderActions";

export const dynamic = "force-dynamic";
const inr = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const inr0 = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

// Legacy Oracle order detail — same Shopify-style layout, read-only.
export default async function OracleOrderDetail({ params }: { params: Promise<{ doc: string[] }> }) {
  const { doc } = await params;
  await getCurrentUser();
  const docNo = (doc ?? []).map(decodeURIComponent).join("/");
  const o = await getOracleOrder(docNo);
  if (!o) notFound();

  const lineTotal = o.lines.reduce((a, l) => a + l.amount, 0);
  const discTotal = o.lines.reduce((a, l) => a + l.disc, 0);
  const qtyTotal = o.lines.reduce((a, l) => a + l.qty, 0);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-4 flex flex-wrap items-center gap-2 no-print">
        <Link href="/erp/sales" className="mr-1 text-sm font-semibold text-[var(--accent)]">← Sales Orders</Link>
        <h1 className="text-xl font-extrabold">{o.order_no}</h1>
        <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold" style={{ background: "#ecfdf5", color: "#047857" }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: "#10b981" }} />Delivered
        </span>
        <span className="rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-[10px] font-bold uppercase text-[var(--muted)]">legacy</span>
        <div className="ml-auto"><PrintButton /></div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="print-area flex flex-col gap-4">
          <div className="hidden print:block">
            <h1 className="text-2xl font-extrabold">Sales Order {o.order_no}</h1>
            <p className="text-sm">{o.customer} · {o.date} · Delivered</p>
          </div>

          <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
            <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
              <span className="text-sm font-extrabold">Items ({o.lines.length})</span>
              <span className="text-xs font-semibold text-[var(--muted)]">Qty {qtyTotal.toLocaleString("en-IN")}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="rtable">
                <thead>
                  <tr><th>Item</th><th>HSN</th><th className="!text-right">Qty</th><th className="!text-right">Rate</th><th className="!text-right">Disc</th><th className="!text-right">Amount</th></tr>
                </thead>
                <tbody>
                  {o.lines.map((l, i) => (
                    <tr key={i}>
                      <td><span className="font-semibold">{l.name}</span><div className="font-mono text-xs text-[var(--muted)]">{l.code}</div></td>
                      <td className="font-mono text-xs text-[var(--muted)]">{l.hsn || "—"}</td>
                      <td className="num-cell">{l.qty}</td>
                      <td className="num-cell text-[var(--muted)]">{l.rate.toFixed(2)}</td>
                      <td className="num-cell text-[var(--muted)]">{l.disc ? l.disc.toFixed(2) : "—"}</td>
                      <td className="num-cell font-semibold tabular-nums">{inr0(l.amount)}</td>
                    </tr>
                  ))}
                  {o.lines.length === 0 && <tr><td colSpan={6} className="!py-6 text-center text-[var(--muted)]">No line detail found for this order.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="mb-2 text-sm font-extrabold">Summary</div>
            <dl className="ml-auto flex max-w-md flex-col gap-1.5 text-sm">
              <Row k={`Line total (${o.lines.length} items)`} v={inr(lineTotal)} />
              {discTotal > 0 && <Row k="Discount" v={`− ${inr(discTotal)}`} accent />}
              <Row k="Sale amount" v={inr(o.sale_amount)} muted />
              <div className="my-1 border-t border-[var(--border)]" />
              <Row k="Bill amount (incl. GST)" v={inr(o.bill_amount)} bold />
            </dl>
          </section>
        </div>

        <div className="flex flex-col gap-4 no-print">
          <Card title="Customer">
            <div className="text-sm font-bold">{o.customer}</div>
            {o.customer_code && <div className="font-mono text-xs text-[var(--muted)]">{o.customer_code}</div>}
            {(o.city || o.state) && <div className="mt-2 text-xs text-[var(--muted)]">{[o.city, o.state].filter(Boolean).join(", ")}</div>}
          </Card>
          <Card title="Order">
            <Meta k="Salesman" v={o.salesman || "—"} />
            <Meta k="Transporter" v={o.transporter || "—"} />
            <Meta k="State" v={o.state || "—"} />
            <Meta k="Order date" v={o.date || "—"} />
            <Meta k="Source" v="Legacy (Oracle)" />
          </Card>
        </div>
      </div>
    </div>
  );
}

function Row({ k, v, bold, accent, muted }: { k: string; v: string; bold?: boolean; accent?: boolean; muted?: boolean }) {
  return (
    <div className={`flex items-center justify-between ${bold ? "text-base font-extrabold" : ""}`}>
      <dt className={muted ? "text-[var(--muted)]" : ""}>{k}</dt>
      <dd className={`tabular-nums ${accent ? "font-semibold text-[var(--accent-2)]" : muted ? "text-[var(--muted)]" : ""}`}>{v}</dd>
    </div>
  );
}
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
      <div className="border-b border-[var(--border)] px-4 py-2.5 text-sm font-extrabold">{title}</div>
      <div className="p-4">{children}</div>
    </section>
  );
}
function Meta({ k, v }: { k: string; v: string }) {
  return <div className="flex items-center justify-between py-1 text-sm"><span className="text-[var(--muted)]">{k}</span><span className="font-semibold">{v}</span></div>;
}
