import Link from "next/link";
import { notFound } from "next/navigation";
import DownloadOrderExcel from "@/components/erp/DownloadOrderExcel";
import GenerateInvoiceButton from "@/components/erp/GenerateInvoiceButton";
import ConfirmOrderButton from "@/components/erp/ConfirmOrderButton";
import CancelLineButton from "@/components/erp/CancelLineButton";
import OrderMetaEditor from "@/components/erp/OrderMetaEditor";
import { PrintButton, WhatsappButton } from "@/components/erp/OrderActions";
import { getSalesOrder } from "@/lib/erp/queries";
import { getCurrentUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { orderDisplayStatus, TONE_STYLE } from "@/lib/erp/orderStatus";

export const dynamic = "force-dynamic";
const inr = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const inr0 = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

export default async function SalesOrderDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const so = await getSalesOrder(Number(id));
  if (!so) notFound();
  const user = await getCurrentUser();
  const editable = canWrite(user.role, "sales");

  // Totals + discount breakdown.
  const gross = so.lines.reduce((a, l) => a + l.qty * (l.mrp || 0), 0); // subtotal at MRP
  const netTotal = so.lines.reduce((a, l) => a + l.qty * l.price, 0);   // after all discounts
  const discountAmt = Math.max(gross - netTotal, 0);
  const focValue = so.lines.reduce((a, l) => a + (l.foc_qty || 0) * l.price, 0);
  const ordered = so.lines.reduce((a, l) => a + l.qty, 0);
  const packed = so.lines.reduce((a, l) => a + l.packed_qty, 0);
  const dispatched = so.lines.reduce((a, l) => a + l.dispatched_qty, 0);
  const billable = so.lines.reduce((a, l) => a + Math.max((l.dispatched_qty ?? 0) - ((l as { invoiced_qty?: number }).invoiced_qty ?? 0), 0), 0);

  const disp = orderDisplayStatus({ status: so.status, ordered_qty: ordered, packed_qty: packed, dispatched_qty: dispatched });
  const tone = TONE_STYLE[disp.tone];

  const address = [so.customer_billing, so.customer_shipping && so.customer_shipping !== so.customer_billing ? `Ship: ${so.customer_shipping}` : ""].filter(Boolean).join("\n");

  const waMessage =
    `*${so.so_no}* — ${so.customer_name}\n${so.order_date}\n\n` +
    so.lines.map((l) => `${l.sku_code} ${l.sku_name} ×${l.qty} @ ${inr(l.price)} = ${inr(l.qty * l.price)}`).join("\n") +
    `\n\n*Total: ${inr(netTotal)}*` +
    (so.transporter ? `\nTransporter: ${so.transporter}` : "") +
    (so.tracking_id ? `\nTracking: ${so.tracking_id}` : "");

  return (
    <div className="mx-auto max-w-6xl">
      {/* ── Action bar ─────────────────────────────────────────── */}
      <div className="mb-4 flex flex-wrap items-center gap-2 no-print">
        <Link href="/erp/sales" className="mr-1 text-sm font-semibold text-[var(--accent)]">← Sales Orders</Link>
        <h1 className="text-xl font-extrabold">{so.so_no}</h1>
        <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold" style={{ background: tone.bg, color: tone.fg }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: tone.dot }} />{disp.label}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <PrintButton />
          <WhatsappButton phone={so.customer_phone ?? ""} message={waMessage} />
          <Link href="/erp/scan/dispatch" className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-bold hover:bg-[var(--surface-2)]">🚚 Dispatch</Link>
          {so.status === "draft" && <ConfirmOrderButton soId={so.id} />}
          {so.status === "open" && <ConfirmOrderButton soId={so.id} label="✓ Punch order" />}
          {billable > 0 && <GenerateInvoiceButton soId={so.id} />}
          <DownloadOrderExcel order={{
            so_no: so.so_no, customer_name: so.customer_name ?? "", order_date: so.order_date,
            status: so.status, bill_type: so.bill_type ?? "", disc_pct: so.disc_pct ?? 0, remarks: so.remarks ?? "",
            lines: so.lines.map((l) => ({
              sku_code: l.sku_code ?? "", sku_name: l.sku_name ?? "", gst_rate: l.gst_rate ?? null, mrp: l.mrp ?? null,
              price: l.price, discount_pct: l.discount_pct ?? null, rate_type: l.rate_type ?? null,
              std_pack: l.std_pack ?? null, bal_qty: l.bal_qty ?? null, qty: l.qty, foc_qty: l.foc_qty ?? null,
              picked_qty: l.picked_qty, packed_qty: l.packed_qty, dispatched_qty: l.dispatched_qty, cancelled_qty: l.cancelled_qty ?? null,
            })),
          }} />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        {/* ── LEFT: the printable order document ─────────────────── */}
        <div className="print-area flex flex-col gap-4">
          {/* Print-only header */}
          <div className="hidden print:block">
            <h1 className="text-2xl font-extrabold">Sales Order {so.so_no}</h1>
            <p className="text-sm">{so.customer_name} · {so.order_date} · {disp.label}</p>
          </div>

          {/* Items */}
          <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
            <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
              <span className="text-sm font-extrabold">Items ({so.lines.length})</span>
              <span className="text-xs font-semibold text-[var(--muted)]">Ordered {ordered} · Packed {packed} · Dispatched {dispatched}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="rtable">
                <thead>
                  <tr>
                    <th>Item</th><th className="!text-right">MRP</th><th className="!text-right">Disc%</th>
                    <th>Rate</th><th className="!text-right">Net rate</th><th className="!text-right">Qty</th>
                    <th className="!text-right">FOC</th><th className="!text-right">Packed</th><th className="!text-right">Disp.</th>
                    <th className="!text-right">Line total</th>
                  </tr>
                </thead>
                <tbody>
                  {so.lines.map((l) => {
                    const remaining = l.qty - l.packed_qty - (l.cancelled_qty ?? 0);
                    return (
                      <tr key={l.id}>
                        <td><span className="font-semibold">{l.sku_name}</span><div className="font-mono text-xs text-[var(--muted)]">{l.sku_code}</div></td>
                        <td className="num-cell text-[var(--muted)]">{l.mrp ? l.mrp.toFixed(2) : "—"}</td>
                        <td className="num-cell">{l.discount_pct ? `${l.discount_pct.toFixed(1)}%` : "—"}</td>
                        <td><span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${l.rate_type === "NET" ? "bg-[var(--accent-bg)] text-[var(--accent-strong)]" : "text-[var(--muted)]"}`}>{l.rate_type || "MRP"}</span></td>
                        <td className="num-cell font-semibold">{l.price.toFixed(2)}</td>
                        <td className="num-cell">{l.qty}</td>
                        <td className="num-cell text-[var(--muted)]">{l.foc_qty || "—"}</td>
                        <td className="num-cell text-[var(--muted)]">{l.packed_qty}</td>
                        <td className="num-cell text-[var(--muted)]">{l.dispatched_qty}</td>
                        <td className="num-cell font-semibold tabular-nums">
                          <div className="flex items-center justify-end gap-2">
                            {inr0(l.qty * l.price)}
                            <span className="no-print"><CancelLineButton soLineId={l.id} remaining={remaining} skuCode={l.sku_code ?? ""} /></span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* Summary — discount breakdown */}
          <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="mb-2 text-sm font-extrabold">Summary</div>
            <dl className="ml-auto flex max-w-md flex-col gap-1.5 text-sm">
              <Row k={`Subtotal (MRP · ${ordered} items)`} v={inr(gross)} />
              <Row k={`Discount${so.disc_pct ? ` · party ${so.disc_pct.toFixed(1)}%` : ""}${so.customer_ogl_pct ? ` + OGL ${so.customer_ogl_pct.toFixed(1)}%` : ""}`} v={`− ${inr(discountAmt)}`} accent />
              {focValue > 0 && <Row k="FOC (free goods, incl. above)" v={inr(focValue)} muted />}
              <div className="my-1 border-t border-[var(--border)]" />
              <Row k="Total (net)" v={inr(netTotal)} bold />
              {so.customer_foc_pct ? <p className="mt-1 text-[11px] text-[var(--muted-2)]">Party is FOC-eligible ({so.customer_foc_pct.toFixed(1)}%). GST added at invoicing.</p> : null}
            </dl>
          </section>

          {/* Logistics/notes shown on the printed slip (read-only) */}
          {(so.transporter || so.tracking_id || so.remarks) && (
            <section className="hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 print:block">
              {so.transporter && <p className="text-sm"><b>Transporter:</b> {so.transporter}</p>}
              {so.tracking_id && <p className="text-sm"><b>Tracking:</b> {so.tracking_id}</p>}
              {so.remarks && <p className="text-sm"><b>Notes:</b> {so.remarks}</p>}
            </section>
          )}
        </div>

        {/* ── RIGHT: sidebar (not printed) ───────────────────────── */}
        <div className="flex flex-col gap-4 no-print">
          <Card title="Customer">
            <div className="text-sm font-bold">{so.customer_name}</div>
            {so.customer_code && <div className="font-mono text-xs text-[var(--muted)]">{so.customer_code}</div>}
            {so.customer_phone && <div className="mt-1 text-sm">{so.customer_phone}</div>}
            {so.customer_gst && <div className="font-mono text-xs text-[var(--muted)]">GST {so.customer_gst}</div>}
            {address && <div className="mt-2 whitespace-pre-line text-xs text-[var(--muted)]">{address}</div>}
          </Card>

          <Card title="Logistics & notes">
            <OrderMetaEditor soId={so.id} transporter={so.transporter ?? ""} trackingId={so.tracking_id ?? ""} notes={so.remarks ?? ""} editable={editable} />
          </Card>

          <Card title="Order">
            <Meta k="Bill type" v={so.bill_type || "—"} />
            <Meta k="Salesman" v={so.salesman_name || "—"} />
            <Meta k="Source" v={so.source || "manual"} />
            <Meta k="Order date" v={so.order_date || "—"} />
            {so.invoice_no && <Meta k="Invoice" v={so.invoice_no} />}
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
  return (
    <div className="flex items-center justify-between py-1 text-sm">
      <span className="text-[var(--muted)]">{k}</span>
      <span className="font-semibold">{v}</span>
    </div>
  );
}
