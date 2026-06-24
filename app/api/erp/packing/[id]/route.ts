import { NextResponse } from "next/server";
import { getOrderPacking } from "@/lib/erp/queries";

export const dynamic = "force-dynamic";

// Live packing state for one sales order (lines + cases). Used by the packing screen to refresh.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const packing = await getOrderPacking(Number(id));
  if (!packing) return NextResponse.json({ ok: false, error: "Order not found." }, { status: 404 });
  return NextResponse.json({ ok: true, packing });
}
