import { NextResponse } from "next/server";
import { getScans } from "@/lib/erp/queries";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const u = new URL(req.url);
  const num = (k: string) => (u.searchParams.get(k) ? Number(u.searchParams.get(k)) : undefined);
  const str = (k: string) => u.searchParams.get(k) ?? undefined;
  const scans = await getScans({
    skuId: num("skuId"),
    userId: num("userId"),
    warehouseId: num("warehouseId"),
    action: str("action"),
    refDoc: str("refDoc"),
    from: str("from"),
    to: str("to"),
    limit: num("limit"),
  });
  return NextResponse.json({ scans });
}
