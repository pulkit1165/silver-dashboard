import * as XLSX from "xlsx";
import { getSql } from "@/lib/erp/db";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";

export const dynamic = "force-dynamic";

// Download a ready-to-fill Std Packing template: every catalogue item pre-listed
// (Item Code + Name) with a blank "Std Pack" column. Fill it, then upload via
// Backfill Barcode Info — the "Std Pack" header maps to skus.master_qty.
export async function GET() {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (!canWrite(user.role, "skus")) return new Response("Forbidden", { status: 403 });

  const rows = (await getSql()`
    SELECT sku_code, name, COALESCE(master_qty,0) AS master_qty
    FROM skus ORDER BY sku_code`) as unknown as Array<{ sku_code: string; name: string; master_qty: number }>;

  const data = [
    ["Item Code", "Item Name", "Std Pack"],
    ...rows.map((s) => [s.sku_code, s.name, s.master_qty > 0 ? s.master_qty : ""]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws["!cols"] = [{ wch: 14 }, { wch: 48 }, { wch: 12 }];

  const info = XLSX.utils.aoa_to_sheet([
    ["STD PACKING UPLOAD — INSTRUCTIONS"],
    [],
    ["1. Fill the 'Std Pack' column with the standard packing qty per item."],
    ["2. Do NOT change 'Item Code' — it is the match key."],
    ["3. Blank Std Pack rows are left untouched on upload."],
    ["4. Upload this file here under 'Backfill Barcode / Master Qty'."],
    ["Recognised pack headers: Std Pack / Master Qty / Pack Size / Carton Qty."],
    [`Generated from ${rows.length} live items.`],
  ]);
  info["!cols"] = [{ wch: 90 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Std Packing");
  XLSX.utils.book_append_sheet(wb, info, "Instructions");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  return new Response(new Uint8Array(buf), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="STD-PACKING-template.xlsx"`,
      "cache-control": "no-store",
    },
  });
}
