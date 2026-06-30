import { NextResponse } from "next/server";
import { nextPackingSlipNo, nextBillNo } from "@/lib/erp/queries";

export const dynamic = "force-dynamic";

export async function GET() {
  const [slipNo, billNo] = await Promise.all([nextPackingSlipNo(), nextBillNo()]);
  return NextResponse.json({ ok: true, slipNo, billNo });
}
