import { NextResponse } from "next/server";
import { getOrderPacking } from "@/lib/erp/queries";

export const dynamic = "force-dynamic";

// Live packing state for one sales order (lines + cases). Used by the packing screen to refresh.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  // Guard non-numeric ids: Number("abc") = NaN would reach Postgres as an invalid integer
  // and throw a 500 instead of the intended clean 404.
  const idNum = Number(id);
  if (!Number.isInteger(idNum) || idNum <= 0) return NextResponse.json({ ok: false, error: "Order not found." }, { status: 404 });
  const packing = await getOrderPacking(idNum);
  if (!packing) return NextResponse.json({ ok: false, error: "Order not found." }, { status: 404 });
  return NextResponse.json({ ok: true, packing });
}
