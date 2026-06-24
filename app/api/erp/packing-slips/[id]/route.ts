import { NextResponse } from "next/server";
import { getPackingSlip } from "@/lib/erp/packing-slips";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const slip = await getPackingSlip(id);
  if (!slip) return NextResponse.json({ ok: false, error: "Slip not found" }, { status: 404 });
  return NextResponse.json({ ok: true, slip });
}
