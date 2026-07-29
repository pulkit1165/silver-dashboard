import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/erp/session";
import { getSkusWithMrp } from "@/lib/erp/mrp";

export const dynamic = "force-dynamic";

// Search-as-you-type for the MRP master — server-side across the WHOLE catalogue
// (not just the loaded page), so any code/name is found regardless of the cap.
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const q = (new URL(req.url).searchParams.get("q") || "").trim();
  if (q.length < 1) return NextResponse.json({ ok: true, results: [] });
  const rows = await getSkusWithMrp(q, 25);
  return NextResponse.json({
    ok: true,
    results: rows.map((r) => ({ id: r.id, sku_code: r.sku_code, name: r.name, price: r.price, change_count: r.change_count })),
  });
}
