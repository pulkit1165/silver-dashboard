import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import PoGenerator from "@/components/erp/PoGenerator";
import { getPurchaseOrders, getVendors } from "@/lib/erp/queries";
import { getCurrentUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { aiAvailable } from "@/lib/erp/ai";
import { getRawSql } from "@/lib/erp/db";

export const dynamic = "force-dynamic";

type OracleRow = Record<string, unknown>;

export default async function PurchasePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const tab = sp.tab === "oracle" ? "oracle" : "live";

  const [user, orders, vendors] = await Promise.all([
    getCurrentUser(),
    getPurchaseOrders(),
    getVendors(),
  ]);

  const pos = orders.map((p) => ({
    id: p.id, po_no: p.po_no,
    vendor_name: (p as { vendor_name?: string }).vendor_name ?? null,
    order_date: p.order_date, status: p.status,
  }));
  const vendorList = vendors.map((v) => ({ id: v.id, code: v.code, name: v.name, status: v.status }));

  let oracleRows: OracleRow[] = [];
  let oracleNote: string | null = null;
  if (tab === "oracle") {
    try {
      const db = getRawSql();
      const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - 18);
      oracleRows = await db`
        SELECT
          data->>'TRMID' AS "TRMID",
          ((data->>'TRDATE')::timestamptz AT TIME ZONE 'Asia/Kolkata')::date::text AS "TRDATE",
          (data->>'BILLAMOUNT')::numeric AS "BILLAMOUNT",
          data->>'PARTYID' AS "PARTYID"
        FROM oracle_raw
        WHERE source_table = 'DTC201'
          AND (data->>'TRDATE')::timestamptz >= ${cutoff.toISOString().slice(0, 10)}::date::timestamp AT TIME ZONE 'Asia/Kolkata'
        ORDER BY (data->>'TRDATE')::timestamptz DESC
      ` as OracleRow[];
    } catch (e) {
      oracleNote = `Query failed: ${(e as Error).message}`;
    }
  }

  const tabUrl = (t: string) => `/erp/purchase?tab=${t}`;

  return (
    <>
      <PageHeader title="Purchase Orders" subtitle="Generate POs · Track vendors · Monitor stock health" />

      <div className="mb-4 flex gap-0 border-b border-[var(--border)]">
        <Link href={tabUrl("live")} className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors -mb-px ${tab === "live" ? "border-[var(--accent)] text-[var(--accent)]" : "border-transparent text-[var(--muted)] hover:text-[var(--fg)]"}`}>
          ERP Orders
        </Link>
        <Link href={tabUrl("oracle")} className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors -mb-px ${tab === "oracle" ? "border-[var(--accent)] text-[var(--accent)]" : "border-transparent text-[var(--muted)] hover:text-[var(--fg)]"}`}>
          Oracle Purchase History (18 mo)
        </Link>
      </div>

      {tab === "live" ? (
        <PoGenerator
          pos={pos}
          vendors={vendorList}
          canWrite={canWrite(user.role, "purchase")}
          aiEnabled={aiAvailable()}
        />
      ) : (
        <section className="panel">
          {oracleNote ? (
            <div className="p-6 text-center text-sm text-[var(--muted)]">{oracleNote}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="rtable">
                <thead>
                  <tr>
                    <th>MRN No.</th>
                    <th>Date</th>
                    <th>Party ID</th>
                    <th className="!text-right">Amount ₹</th>
                  </tr>
                </thead>
                <tbody>
                  {oracleRows.map((r, i) => (
                    <tr key={i}>
                      <td className="font-mono text-sm">{String(r.TRMID ?? "")}</td>
                      <td className="text-[var(--muted)]">{String(r.TRDATE ?? "")}</td>
                      <td className="text-[var(--muted)]">{String(r.PARTYID ?? "—")}</td>
                      <td className="num-cell tabular-nums">{Number(r.BILLAMOUNT || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}</td>
                    </tr>
                  ))}
                  {oracleRows.length === 0 && (
                    <tr><td colSpan={4} className="py-8 text-center text-[var(--muted)]">No Oracle purchase records found for this period.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </>
  );
}
