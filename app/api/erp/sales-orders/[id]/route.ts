import { NextResponse } from "next/server";
import { getSalesOrder } from "@/lib/erp/queries";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const so = await getSalesOrder(Number(id));
  if (!so) return NextResponse.json({ ok: false, error: "Order not found." }, { status: 404 });
  return NextResponse.json({ ok: true, order: so });
}
