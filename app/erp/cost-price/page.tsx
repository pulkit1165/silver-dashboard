import PageHeader from "@/components/PageHeader";
import ListFilters from "@/components/erp/ListFilters";
import { runQuery, isConfigured } from "@/lib/oracle";

export const dynamic = "force-dynamic";

const COST_PRICE_SQL = (search: string | undefined, vehicle: string | undefined) => {
  const searchCond = search?.trim()
    ? `AND (UPPER(m.ITEMCODE) LIKE UPPER('%${search.trim().replace(/'/g, "''")}%') OR UPPER(m.ITEMDESCRIPTION) LIKE UPPER('%${search.trim().replace(/'/g, "''")}%'))`
    : "";
  const vehicleCond = vehicle?.trim()
    ? `AND UPPER(m.VEHICLE) = UPPER('${vehicle.trim().replace(/'/g, "''")}')`
    : "";
  return `
    SELECT m.ITEMCODE, m.ITEMDESCRIPTION, m.VEHICLE, m.STDPACK,
           m.MRP, c.RATE AS COST_PRICE, c.VENDOR,
           TO_CHAR(c.TRDATE) AS COST_DATE
    FROM (
      SELECT ITEMID, ITEMCODE, ITEMDESCRIPTION, VEHICLE, STDPACK, MRP
      FROM (
        SELECT ITEMID, ITEMCODE, ITEMDESCRIPTION, VEHICLE, STDPACK, MRP,
               ROW_NUMBER() OVER (PARTITION BY ITEMID ORDER BY TRDATE DESC) rn
        FROM VW_MRPLIST
      ) WHERE rn = 1
    ) m
    LEFT JOIN (
      SELECT ITEMID, RATE, VENDOR, TRDATE
      FROM (
        SELECT ITEMID, RATE, VENDOR, TRDATE,
               ROW_NUMBER() OVER (PARTITION BY ITEMID ORDER BY TRDATE DESC) rn
        FROM A_CURRCPM
      ) WHERE rn = 1
    ) c ON c.ITEMID = m.ITEMID
    WHERE 1=1 ${searchCond} ${vehicleCond}
    ORDER BY m.ITEMCODE`;
};

type Row = {
  ITEMCODE: string;
  ITEMDESCRIPTION: string;
  VEHICLE: string;
  STDPACK: string;
  MRP: string;
  COST_PRICE: string;
  VENDOR: string;
  COST_DATE: string;
};

function margin(mrp: string, cp: string) {
  const m = parseFloat(mrp), c = parseFloat(cp);
  if (!m || !c || c <= 0) return null;
  return (((m - c) / m) * 100).toFixed(1);
}

export default async function CostPricePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const configured = isConfigured();

  let rows: Row[] = [];
  let error: string | null = null;
  let vehicles: string[] = [];

  if (configured) {
    const [dataRes, vehRes] = await Promise.all([
      runQuery(COST_PRICE_SQL(sp.q, sp.vehicle)).catch((e: Error) => {
        error = e.message;
        return { rows: [] };
      }),
      runQuery(`SELECT DISTINCT VEHICLE FROM VW_MRPLIST WHERE VEHICLE IS NOT NULL ORDER BY VEHICLE`)
        .catch(() => ({ rows: [] })),
    ]);
    rows = dataRes.rows as Row[];
    vehicles = (vehRes.rows as { VEHICLE: string }[]).map((r) => r.VEHICLE);
  } else {
    error = "Oracle connector not configured.";
  }

  const exportUrl = `/api/erp/cost-price?${sp.q ? `q=${encodeURIComponent(sp.q)}&` : ""}${sp.vehicle ? `vehicle=${encodeURIComponent(sp.vehicle)}` : ""}`;

  return (
    <>
      <PageHeader
        title="Cost Price Sheet"
        subtitle={`Live from Oracle — ${rows.length} items. Cost price = latest purchase rate from A_CURRCPM. Margin = (MRP − CP) / MRP.`}
        right={
          configured ? (
            <a
              href={exportUrl}
              download="cost-price-sheet.csv"
              className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-semibold hover:bg-[var(--surface-hover)]"
            >
              ↓ Download CSV
            </a>
          ) : undefined
        }
      />

      <ListFilters
        fields={[
          { key: "q", label: "Search", placeholder: "Item code or description…" },
          {
            key: "vehicle",
            label: "Vehicle",
            placeholder: "e.g. HERO, BAJAJ, HONDA…",
          },
        ]}
      />

      {error && (
        <div className="panel p-6 text-center text-sm text-[var(--muted)]">{error}</div>
      )}

      {!error && (
        <section className="panel">
          <div className="overflow-x-auto">
            <table className="rtable">
              <thead>
                <tr>
                  <th>Item Code</th>
                  <th>Description</th>
                  <th>Vehicle</th>
                  <th className="!text-right">Std Pack</th>
                  <th className="!text-right">MRP ₹</th>
                  <th className="!text-right">Cost ₹</th>
                  <th className="!text-right">Margin %</th>
                  <th>Vendor</th>
                  <th>Cost Date</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const mgn = margin(r.MRP, r.COST_PRICE);
                  const mgClass = mgn === null ? "" : parseFloat(mgn) < 20 ? "text-[var(--danger)]" : parseFloat(mgn) > 40 ? "text-[color:var(--success,#16a34a)]" : "";
                  return (
                    <tr key={i}>
                      <td className="font-mono text-sm font-semibold">{r.ITEMCODE}</td>
                      <td>{r.ITEMDESCRIPTION}</td>
                      <td className="text-[var(--muted)]">{r.VEHICLE}</td>
                      <td className="num-cell tabular-nums">{r.STDPACK}</td>
                      <td className="num-cell tabular-nums">
                        {r.MRP ? Number(r.MRP).toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "—"}
                      </td>
                      <td className="num-cell tabular-nums">
                        {r.COST_PRICE ? Number(r.COST_PRICE).toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "—"}
                      </td>
                      <td className={`num-cell tabular-nums font-semibold ${mgClass}`}>
                        {mgn !== null ? `${mgn}%` : "—"}
                      </td>
                      <td className="text-[var(--muted)] text-sm">{r.VENDOR || "—"}</td>
                      <td className="text-[var(--muted)] text-sm">{r.COST_DATE || "—"}</td>
                    </tr>
                  );
                })}
                {rows.length === 0 && !error && (
                  <tr>
                    <td colSpan={9} className="py-8 text-center text-[var(--muted)]">
                      No items found{sp.q ? ` for "${sp.q}"` : ""}.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {rows.length > 0 && (
            <p className="mt-3 text-xs text-[var(--muted)]">{rows.length} items shown</p>
          )}
        </section>
      )}
    </>
  );
}
