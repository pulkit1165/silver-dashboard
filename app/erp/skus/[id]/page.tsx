import Link from "next/link";
import { notFound } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import PrintButton from "@/components/erp/PrintButton";
import EditLabelInfo from "@/components/erp/EditLabelInfo";
import { getSku, totalQty, inventoryForSku, stockStatus, getScans } from "@/lib/erp/queries";
import { qrSvg } from "@/lib/erp/qr";
import { getCurrentUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";

export const dynamic = "force-dynamic";

const TAG: Record<string, string> = { out: "r", low: "r", reorder: "n", ok: "g" };

export default async function SkuDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sku = await getSku(Number(id));
  if (!sku) notFound();
  const [qty, locations, svg, scans, user] = await Promise.all([
    totalQty(sku.id),
    inventoryForSku(sku.id),
    qrSvg(sku.qr_token, 200),
    getScans({ skuId: sku.id, limit: 12 }),
    getCurrentUser(),
  ]);
  const status = stockStatus(sku, qty);

  return (
    <>
      <PageHeader title={sku.name} subtitle={`${sku.sku_code} · ${sku.category} · ${sku.brand}`} />
      <div className="mb-4">
        <Link href="/erp/skus" className="text-sm font-semibold text-[var(--accent)]">← Back to SKU Master</Link>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* QR label */}
        <section className="panel">
          <div className="panel-hd">SKU QR Label</div>
          <div className="p-4">
            <div className="print-area">
              <div className="qr-label" style={{ width: "fit-content" }}>
                <div dangerouslySetInnerHTML={{ __html: svg }} />
                <div className="text-[11px] leading-tight">
                  <div className="font-extrabold">Silver Industries</div>
                  <div className="font-mono font-bold">{sku.sku_code}</div>
                  <div>{sku.name}</div>
                  <div className="text-[10px] opacity-70">{sku.category}</div>
                  <div className="mt-1 font-mono text-[9px] opacity-60">{sku.qr_token}</div>
                </div>
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <PrintButton />
              <Link href="/erp/qr" className="no-print rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-bold hover:bg-[var(--surface-2)]">Bulk QR labels</Link>
              <Link href="/erp/labels" className="no-print rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-bold hover:bg-[var(--surface-2)]">Barcode labels</Link>
            </div>
          </div>
        </section>

        {/* details */}
        <section className="panel lg:col-span-2">
          <div className="panel-hd">Details &amp; Stock</div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 p-4 text-sm sm:grid-cols-3">
            <Info label="On hand"><b className="tabular-nums">{qty}</b> {sku.unit} <span className={`tag ${TAG[status]} ml-1`}>{status}</span></Info>
            <Info label="Unit price">{sku.price.toFixed(2)}</Info>
            <Info label="Min stock">{sku.min_stock}</Info>
            <Info label="Reorder level">{sku.reorder_level}</Info>
            <Info label="Batch tracked">{sku.batch_tracked ? "Yes" : "No"}</Info>
            <Info label="Serial tracked">{sku.serial_tracked ? "Yes" : "No"}</Info>
          </div>
          <div className="border-t border-[var(--border)] p-4">
            <div className="mb-2 text-xs font-extrabold uppercase tracking-wide text-[var(--muted)]">Barcode label info</div>
            <EditLabelInfo skuId={sku.id} masterQty={sku.master_qty} barcodeCode={sku.barcode_code} canEdit={canWrite(user.role, "skus")} />
          </div>
          <div className="border-t border-[var(--border)] p-4">
            <div className="mb-2 text-xs font-extrabold uppercase tracking-wide text-[var(--muted)]">Stock by location</div>
            <table className="rtable">
              <thead><tr><th>Warehouse</th><th>Bin</th><th className="!text-right">Qty</th></tr></thead>
              <tbody>
                {locations.length === 0 && <tr><td colSpan={3} className="text-[var(--muted)]">No stock on hand.</td></tr>}
                {locations.map((l, i) => (
                  <tr key={i}><td>{l.warehouse_code}</td><td>{l.bin_code}</td><td className="num-cell">{l.qty}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="panel mt-5">
        <div className="panel-hd">Scan history for this SKU</div>
        <div className="overflow-x-auto">
          <table className="rtable">
            <thead><tr><th>When</th><th>User</th><th>Action</th><th className="!text-right">Qty</th><th>Doc</th><th>Status</th></tr></thead>
            <tbody>
              {scans.length === 0 && <tr><td colSpan={6} className="!py-6 text-center text-[var(--muted)]">No scans recorded for this SKU.</td></tr>}
              {scans.map((s) => (
                <tr key={s.id}>
                  <td className="whitespace-nowrap text-xs text-[var(--muted)]">{s.created_at}</td>
                  <td>{s.user_name}</td><td><span className="tag n">{s.action}</span></td>
                  <td className="num-cell">{s.qty || ""}</td><td>{s.ref_doc ?? "—"}</td>
                  <td>{s.status === "success" ? <span className="tag g">ok</span> : <span className="tag r">fail</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-extrabold uppercase tracking-wider text-[var(--muted-2)]">{label}</div>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}
