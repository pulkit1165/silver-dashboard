import { getPackingExportRows } from "@/lib/erp/queries";

export const dynamic = "force-dynamic";

// Read-only CSV of every item packed into a case — for a Google Sheet IMPORTDATA
// mirror. Public but guarded by ?token=PACKING_EXPORT_TOKEN (see proxy.ts bypass).
const COLS = ["Packed At", "Sales Order", "Customer", "Case No", "Item Code", "Item Name", "Qty Packed", "Packed By", "Order Status"] as const;

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(req: Request) {
  const expected = process.env.PACKING_EXPORT_TOKEN;
  const token = new URL(req.url).searchParams.get("token");
  if (!expected || token !== expected) {
    return new Response("Forbidden", { status: 403 });
  }

  const rows = await getPackingExportRows();
  const body = [
    COLS.join(","),
    ...rows.map((r) =>
      [r.created_at, r.so_no, r.customer, r.case_no, r.sku_code, r.item_name, r.qty_packed, r.packed_by, r.order_status]
        .map(csvCell)
        .join(","),
    ),
  ].join("\n");

  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
