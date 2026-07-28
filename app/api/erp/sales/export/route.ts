import { getSessionUser } from "@/lib/erp/session";
import { getUnifiedOrdersForExport } from "@/lib/erp/ordersUnified";
import { STATUS_META } from "@/lib/erp/orderStatus";

export const dynamic = "force-dynamic";

const esc = (v: unknown) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// CSV export of the current Orders view (respects the same filters).
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const sp = new URL(req.url).searchParams;
  const rows = await getUnifiedOrdersForExport({
    party: sp.get("party") ?? undefined, salesman: sp.get("salesman") ?? undefined,
    status: sp.get("status") ?? undefined, from: sp.get("from") ?? undefined, to: sp.get("to") ?? undefined,
  });

  const head = ["Order No", "Date", "Customer", "Salesman", "Transporter", "State", "Value", "Status", "Source"];
  const lines = [head.join(",")];
  for (const r of rows) {
    lines.push([
      r.order_no, r.dt, r.customer, r.salesman, r.transporter, r.state,
      r.value, STATUS_META[r.status_key]?.label ?? r.status_key, r.source,
    ].map(esc).join(","));
  }
  const csv = "﻿" + lines.join("\n"); // BOM so Excel reads UTF-8

  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="sales-orders.csv"`,
    },
  });
}
