import { NextRequest, NextResponse } from "next/server";
import { runQuery, isConfigured } from "@/lib/oracle";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!isConfigured()) {
    return NextResponse.json({ error: "Oracle not configured" }, { status: 503 });
  }

  const { searchParams } = req.nextUrl;
  const q = searchParams.get("q")?.trim() ?? "";
  const vehicle = searchParams.get("vehicle")?.trim() ?? "";

  const searchCond = q
    ? `AND (UPPER(m.ITEMCODE) LIKE UPPER('%${q.replace(/'/g, "''")}%') OR UPPER(m.ITEMDESCRIPTION) LIKE UPPER('%${q.replace(/'/g, "''")}%'))`
    : "";
  const vehicleCond = vehicle
    ? `AND UPPER(m.VEHICLE) = UPPER('${vehicle.replace(/'/g, "''")}')`
    : "";

  const sql = `
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

  const result = await runQuery(sql);
  const rows = result.rows as Record<string, string>[];

  const headers = ["Item Code", "Description", "Vehicle", "Std Pack", "MRP", "Cost Price", "Margin %", "Vendor", "Cost Date"];
  const csvLines = [
    headers.join(","),
    ...rows.map((r) => {
      const mrp = parseFloat(r.MRP || "0");
      const cp = parseFloat(r.COST_PRICE || "0");
      const margin = mrp && cp ? (((mrp - cp) / mrp) * 100).toFixed(1) : "";
      return [
        r.ITEMCODE ?? "",
        `"${(r.ITEMDESCRIPTION ?? "").replace(/"/g, '""')}"`,
        r.VEHICLE ?? "",
        r.STDPACK ?? "",
        r.MRP ?? "",
        r.COST_PRICE ?? "",
        margin,
        `"${(r.VENDOR ?? "").replace(/"/g, '""')}"`,
        r.COST_DATE ?? "",
      ].join(",");
    }),
  ];

  return new NextResponse(csvLines.join("\n"), {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="cost-price-sheet.csv"`,
    },
  });
}
